import { Request } from 'express'
import { Socket } from 'socket.io'

/**
 * Extract client IP from HTTP request or WebSocket connection
 * Uses deterministic priority order for consistency between HTTP and WebSocket
 * Returns 'unknown' if extraction fails - bulletproof approach
 */
export const extractClientIp = (req: Request | Socket): string => {
  // Define consistent priority order for IP extraction
  const getIpSources = (): string[] => {
    if ('handshake' in req) {
      // WebSocket connection - consistent priority order
      return [
        req.handshake.headers['cf-connecting-ip']?.toString()?.trim(),
        req.handshake.headers['x-real-ip']?.toString()?.trim(),
        req.handshake.address
      ].filter((ip): ip is string => Boolean(ip))
    } else {
      // HTTP request - consistent priority order
      return [
        req.headers['cf-connecting-ip']?.toString()?.trim(),
        req.headers['x-real-ip']?.toString()?.trim(),
        req.ip,
        req.socket.remoteAddress
      ].filter((ip): ip is string => Boolean(ip))
    }
  }

  // Return first valid IP following consistent priority order
  const sources = getIpSources()
  return sources.find(ip => ip && ip !== '127.0.0.1' && ip !== '::1') || 'unknown'
}

/**
 * Validate IP addresses - bulletproof simple comparison
 */
export const validateIpAddress = (originalIp: string, currentIp: string): { valid: boolean; reason?: string; metricReason?: string } => {
  // Allow if original was unknown (first time setup)
  if (originalIp === 'unknown') {
    return { valid: true }
  }

  // Deny if current IP is unknown (security risk)
  if (currentIp === 'unknown') {
    return {
      valid: false,
      reason: 'Unable to verify IP address',
      metricReason: 'current_ip_unknown'
    }
  }

  // Allow if IPs match, deny if different
  const isMatch = originalIp === currentIp
  return isMatch
    ? { valid: true }
    : {
        valid: false,
        reason:
          'We detected a sign-in from a different network. Please connect using the same Wi-Fi or mobile network you used before and try again.',
        metricReason: 'ip_mismatch'
      }
}
