import { isIPv4, isIPv6 } from 'net'
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
  const lowercased = ip.trim().toLowerCase()
  if (lowercased.startsWith('::ffff:')) {
    return lowercased.substring(7)
  }
  return lowercased
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

// Checks if two IPs match, considering subnet/region matching.
// IPv4 matches by /24 subnet and IPv6 by /64 prefix; an IPv4 never matches an IPv6.
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

  // IPv6 /64 matching: hosts rotate temporary (privacy) addresses inside the same /64 prefix
  const hextets1 = expandIpv6(normalizedIp1)
  const hextets2 = expandIpv6(normalizedIp2)

  if (hextets1 && hextets2 && !isSharedIpv6Prefix(hextets1)) {
    return hextets1.slice(0, 4).every((hextet, i) => hextet === hextets2[i])
  }

  return false
}

// Whether the /64 is shared by unrelated hosts: the zero prefix (::, ::1, IPv4-mapped/compatible) or NAT64 (64:ff9b::/32).
function isSharedIpv6Prefix(hextets: number[]): boolean {
  return hextets.slice(0, 4).every(hextet => hextet === 0) || (hextets[0] === 0x64 && hextets[1] === 0xff9b)
}

// Expands an IPv6 address into its 8 hextets as numbers, or returns null if it is not IPv6.
export function expandIpv6(ip: string): number[] | null {
  const address = ip.split('%')[0]
  if (!isIPv6(address)) {
    return null
  }

  const [head, tail] = address.includes('::') ? address.split('::') : [address, undefined]
  const toHextets = (part: string): number[] =>
    part
      ? part.split(':').flatMap(group => {
          if (isIPv4(group)) {
            const [a, b, c, d] = group.split('.').map(Number)
            return [(a << 8) | b, (c << 8) | d]
          }
          return [parseInt(group, 16)]
        })
      : []

  const headHextets = toHextets(head)
  if (tail === undefined) {
    return headHextets
  }

  const tailHextets = toHextets(tail)
  return [...headHextets, ...new Array(8 - headHextets.length - tailHextets.length).fill(0), ...tailHextets]
}

// Formats IP-related headers for logging.
export function formatIpHeaders(headers: Headers): string {
  return `true-client-ip=${headers.get('true-client-ip')}, x-real-ip=${headers.get('x-real-ip')}, cf-connecting-ip=${headers.get(
    'cf-connecting-ip'
  )}, x-forwarded-for=${headers.get('x-forwarded-for')}`
}
