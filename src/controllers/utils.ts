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
 * Reads and JSON-parses the request body, throwing InvalidRequestError (mapped to a 400 by the
 * shared errorHandler) when the body is missing or not valid JSON — restoring the previous
 * body-parser behavior instead of letting the parse error surface as a 500.
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
