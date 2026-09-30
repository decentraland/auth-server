import { BlockList, isIPv4, isIPv6 } from 'net'
import { InvalidRequestError } from '@dcl/http-commons'

/**
 * Header set by `main()` carrying the Node socket's remote address. The native
 * `Request` the http-server builds for handlers does not expose the underlying
 * socket, so the connection's remote address is stamped onto this header before
 * the http-server reads the incoming message. `getClientIp` consults it as the
 * lowest-priority fallback — preserving the previous express behavior of falling
 * back to `req.socket.remoteAddress` when no trusted proxy header is present.
 */
export const SOCKET_REMOTE_ADDRESS_HEADER = 'x-socket-remote-address'

/**
 * Reads and JSON-parses the request body, throwing InvalidRequestError (answered as a 400 by the route's
 * handler or by the shared errorHandler) when the body is missing or not valid JSON, instead of letting the
 * parse error surface as a 500.
 */
export async function parseJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json()
  } catch {
    throw new InvalidRequestError('Invalid JSON body')
  }
}

// Normalizes an IP address (converts IPv6-mapped IPv4 to IPv4).
export function normalizeIp(ip: string): string {
  // Convert IPv6-mapped IPv4 (::ffff:xxx.xxx.xxx.xxx) to IPv4
  if (ip.startsWith('::ffff:')) {
    return ip.substring(7)
  }
  return ip.trim()
}

/**
 * Gets the client IP address from request headers.
 *
 * Header priority reflects trustworthiness at our edge (Cloudflare). The headers are
 * consulted most-trusted first because the identity IP-binding check relies on this
 * value:
 *
 * 1. `CF-Connecting-IP` — set by Cloudflare on every proxied request and overwritten
 *    if the client tries to forge it; the only header a direct client cannot spoof
 *    through the edge.
 * 2. `True-Client-IP` / `X-Real-IP` — also set by proxies, but only on some plans /
 *    configurations, and NOT guaranteed to be stripped from inbound requests. They are
 *    lower priority so a forged value cannot override the genuine `CF-Connecting-IP`.
 * 3. `X-Forwarded-For` — a client-appendable list; only the first entry is taken.
 * 4. The Node socket remote address (stamped onto a header by `main()`).
 *
 * NOTE: the edge MUST strip inbound `True-Client-IP`/`X-Real-IP`/`X-Forwarded-For` from
 * untrusted clients for the lower-priority headers to be meaningful; the ordering here
 * only guarantees Cloudflare's value wins when present.
 */
export function getClientIp(headers: Headers): string {
  // Cloudflare's trusted header — set/overwritten by the edge, cannot be spoofed through it.
  const cfConnectingIp = headers.get('cf-connecting-ip')
  if (cfConnectingIp) {
    return normalizeIp(cfConnectingIp)
  }

  // True-Client-IP (set by some proxy plans, e.g. Cloudflare Enterprise).
  const trueClientIp = headers.get('true-client-ip')
  if (trueClientIp) {
    return normalizeIp(trueClientIp)
  }

  // X-Real-IP (set by proxies when configured, more trustworthy than X-Forwarded-For).
  const xRealIp = headers.get('x-real-ip')
  if (xRealIp) {
    return normalizeIp(xRealIp)
  }

  // Check X-Forwarded-For header (can be spoofed, use with caution)
  // Take the first IP in the chain (original client)
  const xForwardedFor = headers.get('x-forwarded-for')
  if (xForwardedFor) {
    return normalizeIp(xForwardedFor.split(',')[0])
  }

  // Fallback to the Node socket remote address (stamped onto a header by main()).
  const fallbackIp = headers.get(SOCKET_REMOTE_ADDRESS_HEADER) || 'unknown'
  return normalizeIp(fallbackIp)
}

/**
 * Cloudflare's published edge ranges, as listed at https://www.cloudflare.com/ips/ on 2026-09-30. A
 * request whose connecting hop falls outside them did not come through the edge, whatever its
 * headers say. Cloudflare rarely changes them, but when it does this list must follow: traffic from
 * a range missing here is keyed on the edge address, so the users behind one edge would share a
 * single client's share of the validation budget.
 */
const CLOUDFLARE_RANGES = {
  ipv4: [
    '173.245.48.0/20',
    '103.21.244.0/22',
    '103.22.200.0/22',
    '103.31.4.0/22',
    '141.101.64.0/18',
    '108.162.192.0/18',
    '190.93.240.0/20',
    '188.114.96.0/20',
    '197.234.240.0/22',
    '198.41.128.0/17',
    '162.158.0.0/15',
    '104.16.0.0/13',
    '104.24.0.0/14',
    '172.64.0.0/13',
    '131.0.72.0/22'
  ],
  ipv6: ['2400:cb00::/32', '2606:4700::/32', '2803:f800::/32', '2405:b500::/32', '2405:8100::/32', '2a06:98c0::/29', '2c0f:f248::/32']
}

const cloudflareEdges = new BlockList()
for (const [type, ranges] of Object.entries(CLOUDFLARE_RANGES) as ['ipv4' | 'ipv6', string[]][]) {
  for (const range of ranges) {
    const [network, prefix] = range.split('/')
    cloudflareEdges.addSubnet(network, Number(prefix), type)
  }
}

function isCloudflareEdge(ip: string): boolean {
  if (isIPv4(ip)) return cloudflareEdges.check(ip, 'ipv4')
  if (isIPv6(ip)) return cloudflareEdges.check(ip, 'ipv6')
  return false
}

/**
 * The key per-client limits are counted against: an IPv4 address as is, and an IPv6 address by its
 * /64. A single host is routinely handed a whole /64, so keying on the full address would let one
 * machine be a new client on every request. Anything that is not an address is keyed as given, so
 * nothing escapes the limit by being unparseable.
 */
function toClientKey(ip: string): string {
  if (isIPv4(ip) || !isIPv6(ip)) return ip

  const [head, tail = ''] = ip.toLowerCase().split('::')
  const headGroups = head ? head.split(':') : []
  const tailGroups = ip.includes('::') ? (tail ? tail.split(':') : []) : []
  const groups = ip.includes('::')
    ? [...headGroups, ...Array(8 - headGroups.length - tailGroups.length).fill('0'), ...tailGroups]
    : headGroups
  return `${groups
    .slice(0, 4)
    .map(group => group.replace(/^0+(?=.)/, ''))
    .join(':')}::/64`
}

/**
 * The client address to count per-client limits against, taken only from what this service's own
 * infrastructure vouches for. Unlike `getClientIp`, it never believes a header on the client's say-so.
 *
 * The load balancer in front of auth-server appends the address that connected to it as the LAST
 * `X-Forwarded-For` entry; a client can prepend entries but not add one after it. Traffic cannot be
 * assumed to have come through Cloudflare, so `cf-connecting-ip` is only Cloudflare's word when
 * that last hop is a Cloudflare edge. Otherwise every proxy header is the client's own invention
 * and the connecting hop itself is the client. A Cloudflare hop that names no client is keyed on
 * the edge address rather than left unlimited.
 *
 * Returns `undefined` only when there is no `X-Forwarded-For` at all, as when nothing sits in front
 * of the process. Callers then skip the per-client limit rather than count every client against one
 * shared address; the pool cap still applies.
 */
export function getTrustedClientIp(headers: Headers): string | undefined {
  const forwardedFor = headers.get('x-forwarded-for')
  if (!forwardedFor) {
    return undefined
  }

  // Lowercased first: `normalizeIp` only recognises the IPv4-mapped prefix in lowercase.
  const hops = forwardedFor.split(',')
  const connectingHop = normalizeIp(hops[hops.length - 1].trim().toLowerCase())

  if (isCloudflareEdge(connectingHop)) {
    const cfConnectingIp = headers.get('cf-connecting-ip')?.trim().toLowerCase()
    return toClientKey(cfConnectingIp ? normalizeIp(cfConnectingIp) : connectingHop)
  }

  return toClientKey(connectingHop)
}

/**
 * `getTrustedClientIp` for a socket.io connection, read from its handshake headers.
 */
export function getSocketTrustedClientIp(handshake: { headers: Record<string, string | string[] | undefined> }): string | undefined {
  const headers = new Headers()
  for (const [name, value] of Object.entries(handshake.headers)) {
    if (value !== undefined) {
      headers.set(name, Array.isArray(value) ? value.join(', ') : value)
    }
  }
  return getTrustedClientIp(headers)
}

// Checks if two IPs match, considering subnet/region matching.
// For IPv4, this can match by subnet (e.g., 10.0.16.* matches 10.0.16.*).
export function ipsMatch(ip1: string, ip2: string): boolean {
  if (!ip1 || !ip2 || ip1 === 'unknown' || ip2 === 'unknown') {
    return false
  }

  // Exact match
  if (ip1 === ip2) {
    return true
  }

  // Normalize both IPs
  const normalizedIp1 = normalizeIp(ip1)
  const normalizedIp2 = normalizeIp(ip2)

  // Exact match after normalization
  if (normalizedIp1 === normalizedIp2) {
    return true
  }

  // IPv4 subnet matching: check if they're in the same /24 subnet (first 3 octets)
  // This helps with VPNs that might use different edge servers but same region
  const ipv4Regex = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/
  const match1 = normalizedIp1.match(ipv4Regex)
  const match2 = normalizedIp2.match(ipv4Regex)

  if (match1 && match2) {
    // Match by /24 subnet (first 3 octets)
    if (match1[1] === match2[1] && match1[2] === match2[2] && match1[3] === match2[3]) {
      return true
    }
  }

  return false
}

// Formats IP-related headers for logging.
export function formatIpHeaders(headers: Headers): string {
  return `true-client-ip=${headers.get('true-client-ip')}, x-real-ip=${headers.get('x-real-ip')}, cf-connecting-ip=${headers.get(
    'cf-connecting-ip'
  )}, x-forwarded-for=${headers.get('x-forwarded-for')}`
}
