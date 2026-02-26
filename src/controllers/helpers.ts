import type { IHttpServerComponent } from '@well-known-components/interfaces'
import type { IpHeaders } from '../utils/ip.types'
import type { HandlerContext } from './types'

export function getPathParam(value: string | string[]): string | undefined {
  const pathParam = Array.isArray(value) ? value[0] : value
  return pathParam && pathParam.length > 0 ? pathParam : undefined
}

export function getIpHeaders(request: IHttpServerComponent.IRequest): IpHeaders {
  const headers: IpHeaders = {}

  request.headers.forEach((value, key) => {
    headers[key] = value
  })

  return headers
}

export function getJsonBody(ctx: HandlerContext): Promise<unknown> {
  return ctx.request.json()
}

export function redactIp(ip: string): string {
  if (!ip || ip === 'unknown') {
    return 'unknown'
  }

  if (ip.includes('.')) {
    const parts = ip.split('.')
    if (parts.length === 4) {
      return `${parts[0]}.${parts[1]}.${parts[2]}.x`
    }
  }

  if (ip.includes(':')) {
    const parts = ip.split(':')
    return `${parts.slice(0, 4).join(':')}:x`
  }

  return `${ip.slice(0, 6)}***`
}
