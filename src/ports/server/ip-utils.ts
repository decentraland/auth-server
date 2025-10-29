import { Request } from 'express'
import { Socket } from 'socket.io'

/**
 * Extract ALL available client IPs from HTTP request or WebSocket connection
 * Uses deterministic priority order for consistency between HTTP and WebSocket
 * Returns array of all non-localhost IPs found - supports multiple IP scenarios
 */
export const extractAllClientIps = (req: Request | Socket): string[] => {
  const getIpSources = (): string[] => {
    if ('handshake' in req) {
      // WebSocket connection - consistent priority order
      const sources = [
        req.handshake.headers['cf-connecting-ip']?.toString()?.trim(),
        req.handshake.headers['x-real-ip']?.toString()?.trim(),
        req.handshake.address
      ].filter((ip): ip is string => Boolean(ip))

      // Add all IPs from X-Forwarded-For header
      const xForwardedFor = req.handshake.headers['x-forwarded-for']?.toString()
      if (xForwardedFor) {
        const forwardedIps = xForwardedFor
          .split(',')
          .map(ip => ip.trim())
          .filter(ip => Boolean(ip))
        sources.push(...forwardedIps)
      }

      return sources
    } else {
      // HTTP request - consistent priority order
      const sources = [
        req.headers['cf-connecting-ip']?.toString()?.trim(),
        req.headers['x-real-ip']?.toString()?.trim(),
        req.ip,
        req.connection.remoteAddress,
        req.socket.remoteAddress
      ].filter((ip): ip is string => Boolean(ip))

      // Add all IPs from X-Forwarded-For header
      const xForwardedFor = req.headers['x-forwarded-for']?.toString()
      if (xForwardedFor) {
        const forwardedIps = xForwardedFor
          .split(',')
          .map(ip => ip.trim())
          .filter(ip => Boolean(ip))
        sources.push(...forwardedIps)
      }

      return sources
    }
  }

  // Collect all non-localhost IPs following consistent priority order
  const sources = getIpSources()
  const validIps = sources.filter(ip => ip && ip !== '127.0.0.1' && ip !== '::1')

  return [...new Set(validIps)]
}

/**
 * Extract client IP from HTTP request or WebSocket connection
 * Uses deterministic priority order for consistency between HTTP and WebSocket
 * Returns 'unknown' if extraction fails - bulletproof approach
 */
export const extractClientIp = (req: Request | Socket): string => {
  const allIps = extractAllClientIps(req)
  return allIps[0] || 'unknown'
}

/**
 * Validate IP addresses - supports multiple IP scenarios by checking stored IP against all current IPs
 * Checks if the originally stored IP matches ANY of the currently available IPs
 */
export const validateIpAddress = (originalIp: string, currentIps: string[]): { valid: boolean; reason?: string; metricReason?: string } => {
  // Allow if original IP was unknown (first time setup)
  if (originalIp === 'unknown') {
    return { valid: true }
  }

  // Deny if no current IPs available (security risk)
  if (currentIps.length === 0) {
    return {
      valid: false,
      reason: 'Unable to verify IP address',
      metricReason: 'current_ip_unknown'
    }
  }

  // Allow if original IP matches ANY current IP
  const isMatch = currentIps.includes(originalIp)
  return isMatch
    ? { valid: true }
    : {
        valid: false,
        reason:
          'We detected a sign-in from a different network. Please connect using the same Wi-Fi or mobile network you used before and try again.',
        metricReason: 'ip_mismatch'
      }
}
