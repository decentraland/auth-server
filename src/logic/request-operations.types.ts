export type ComputeRequestExpirationParams = {
  method: string
  requestExpirationInSeconds: number
  dclPersonalSignExpirationInSeconds: number
  now?: number
}

export type BuildRequestRecordParams = {
  requestId: string
  method: string
  params: unknown[]
  expiration: Date
  code: number
  sender?: string
}

export type ToFulfilledRequestRecordParams = {
  requestId: string
  expiration: Date
}
