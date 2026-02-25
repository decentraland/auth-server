import type { IHttpServerComponent } from '@well-known-components/interfaces'
import type { IpHeaders } from '../utils/ip.types'
import type { HandlerContext } from './types'

export function getPathParam(value: string | string[]): string {
  return Array.isArray(value) ? value[0] : value
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
