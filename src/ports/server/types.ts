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
  params: string[]
}

export type RequestMessage = Request & {
  type: MessageType.REQUEST
}

export type RequestResponseMessage = {
  type: MessageType.REQUEST
  requestId: string
}

export type RecoverMessage = {
  type: MessageType.RECOVER
  requestId: string
}

export type RecoverResponseMessage = Request & {
  type: MessageType.RECOVER
  requestId: string
}

export type OutcomeMessage = {
  type: MessageType.OUTCOME
  requestId: string
  sender: string
  result: string | number | boolean | (string | number | boolean)[]
}

export type OutcomeResponseMessage = OutcomeMessage

export type InvalidResponseMessage = {
  type: MessageType.INVALID
  requestId: string
  error: string
}

export type InputMessage = RequestMessage | RecoverMessage | OutcomeMessage

export type ResponseMessage = RequestResponseMessage | RecoverResponseMessage | OutcomeResponseMessage | InvalidResponseMessage
