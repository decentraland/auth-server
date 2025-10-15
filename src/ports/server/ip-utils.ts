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
        req.handshake.headers['x-forwarded-for']?.toString().split(',')[0]?.trim(),
        req.handshake.headers['x-real-ip']?.toString(),
        req.handshake.address
      ].filter((ip): ip is string => Boolean(ip))
    } else {
      // HTTP request - consistent priority order
      return [
        req.headers['x-forwarded-for']?.toString().split(',')[0]?.trim(),
        req.headers['x-real-ip']?.toString(),
        req.ip,
        req.connection.remoteAddress,
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
  // Allow if original was unknown (first time setup) or both are unknown (fallback)
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
  return originalIp === currentIp
    ? { valid: true }
    : {
        valid: false,
        reason: `IP address mismatch. Original: ${originalIp}, Current: ${currentIp}`,
        metricReason: 'ip_mismatch'
      }
}
