import type { IHttpServerComponent } from '@well-known-components/interfaces'
import type { AppComponents, IIpUtilsComponent } from '../types/components'
import type { GetClientIpInput, IpHeaders } from './ip.types'

export async function createIpUtilsComponent({ logs }: Pick<AppComponents, 'logs'>): Promise<IIpUtilsComponent> {
  const logger = logs.getLogger('ip-utils-component')

  const IP_HEADER_KEYS = new Set(['true-client-ip', 'x-real-ip', 'cf-connecting-ip', 'x-forwarded-for'])

  const getIpHeaders = (request: IHttpServerComponent.IRequest): IpHeaders => {
    const headers: IpHeaders = {}

    request.headers.forEach((value, key) => {
      if (IP_HEADER_KEYS.has(key)) {
        headers[key] = value
      }
    })

    return headers
  }

  const normalizeIp = (ip: string): string => {
    if (ip.startsWith('::ffff:')) {
      return ip.substring(7)
    }

    return ip.trim()
  }

  const getClientIp = (input: GetClientIpInput): string => {
    const trueClientIp = input.headers['true-client-ip']
    if (trueClientIp) {
      const ip = Array.isArray(trueClientIp) ? trueClientIp[0] : trueClientIp
      return normalizeIp(ip)
    }

    const xRealIp = input.headers['x-real-ip']
    if (xRealIp) {
      const ip = Array.isArray(xRealIp) ? xRealIp[0] : xRealIp
      return normalizeIp(ip)
    }

    const cfConnectingIp = input.headers['cf-connecting-ip']
    if (cfConnectingIp) {
      const ip = Array.isArray(cfConnectingIp) ? cfConnectingIp[0] : cfConnectingIp
      return normalizeIp(ip)
    }

    const xForwardedFor = input.headers['x-forwarded-for']
    if (xForwardedFor) {
      const ips = Array.isArray(xForwardedFor) ? xForwardedFor[0] : xForwardedFor.split(',')[0]
      return normalizeIp(ips)
    }

    const fallbackIp = input.ip || input.remoteAddress || 'unknown'

    const clientIp = normalizeIp(fallbackIp)

    if (clientIp === 'unknown') {
      logger.log('Could not resolve client IP from request headers and socket info')
    }

    return clientIp
  }

  const ipsMatch = (ip1: string, ip2: string): boolean => {
    if (!ip1 || !ip2 || ip1 === 'unknown' || ip2 === 'unknown') {
      return false
    }

    if (ip1 === ip2) {
      return true
    }

    const normalizedIp1 = normalizeIp(ip1)
    const normalizedIp2 = normalizeIp(ip2)

    if (normalizedIp1 === normalizedIp2) {
      return true
    }

    const ipv4Regex = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/
    const match1 = normalizedIp1.match(ipv4Regex)
    const match2 = normalizedIp2.match(ipv4Regex)

    if (match1 && match2) {
      if (match1[1] === match2[1] && match1[2] === match2[2] && match1[3] === match2[3]) {
        return true
      }
    }

    return false
  }

  const formatIpHeaders = (headers: IpHeaders): string => {
    return `true-client-ip=${headers['true-client-ip']}, x-real-ip=${headers['x-real-ip']}, cf-connecting-ip=${headers['cf-connecting-ip']}, x-forwarded-for=${headers['x-forwarded-for']}`
  }

  return {
    getIpHeaders,
    normalizeIp,
    getClientIp,
    ipsMatch,
    formatIpHeaders
  }
}
