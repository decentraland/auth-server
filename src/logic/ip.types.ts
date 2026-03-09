export type IpHeaders = Record<string, string | string[] | undefined>

export type GetClientIpInput = {
  headers: IpHeaders
  ip?: string
  remoteAddress?: string
}
