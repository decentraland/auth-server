import { IBaseComponent } from '@well-known-components/interfaces'

export type IServerComponent = IBaseComponent

export enum MessageType {
  REQUEST = 'request',
  RECOVER = 'recover',
  OUTCOME = 'outcome',
  INVALID = 'invalid'
}

export type Request = {
  method: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  params: any[]
  sender?: string
  chainId?: number
}

export type RequestMessage = Request & {
  type: MessageType.REQUEST
}

export type RequestResponseMessage = {
  type: MessageType.REQUEST
  requestId: string
  expiration: Date
  code: number
}

export type RecoverMessage = {
  type: MessageType.RECOVER
  requestId: string
}

export type RecoverResponseMessage = Request & {
  type: MessageType.RECOVER
  requestId: string
  expiration: Date
  code: number
}

export type OutcomeMessage = {
  type: MessageType.OUTCOME
  requestId: string
  sender: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  result: any
}

export type OutcomeResponseMessage = OutcomeMessage

export type OutcomeResponseMessageForInput = Pick<OutcomeMessage, 'type' | 'requestId'>

export type InvalidResponseMessage = {
  type: MessageType.INVALID
  requestId: string
  error: string
}

export type InputMessage = RequestMessage | RecoverMessage | OutcomeMessage

export type ResponseMessage =
  | RequestResponseMessage
  | RecoverResponseMessage
  | OutcomeResponseMessage
  | OutcomeResponseMessageForInput
  | InvalidResponseMessage
