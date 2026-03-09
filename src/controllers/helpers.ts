import type { IHttpServerComponent } from '@well-known-components/interfaces'
import type { IpHeaders } from '../utils/ip.types'
import type { HandlerContext } from './types'

export function getPathParam(value: string | string[]): string | undefined {
  const pathParam = Array.isArray(value) ? value[0] : value
  return pathParam && pathParam.length > 0 ? pathParam : undefined
}

const IP_HEADER_KEYS = new Set(['true-client-ip', 'x-real-ip', 'cf-connecting-ip', 'x-forwarded-for'])

export function getIpHeaders(request: IHttpServerComponent.IRequest): IpHeaders {
  const headers: IpHeaders = {}

  request.headers.forEach((value, key) => {
    if (IP_HEADER_KEYS.has(key)) {
      headers[key] = value
    }
  })

  return headers
}

export function getJsonBody(ctx: HandlerContext): Promise<unknown> {
  return ctx.request.json()
}
