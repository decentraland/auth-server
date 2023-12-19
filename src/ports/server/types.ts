import { IBaseComponent } from '@well-known-components/interfaces'

export type IServerComponent = IBaseComponent

export enum MessageType {
  REQUEST = 'request',
  RECOVER = 'recover',
  OUTCOME = 'outcome',
  INVALID = 'invalid'
}

export type RequestMessage = {
  type: MessageType.REQUEST
  method: string
  params: string[]
}

export type RequestResponseMessage = {
  type: MessageType.REQUEST
  requestId: string
}

export type RecoverMessage = {
  type: MessageType.RECOVER
  requestId: string
}

export type RecoverResponseMessage = {
  type: MessageType.RECOVER
  requestId: string
  method: string
  params: string[]
}

export type OutcomeMessage = {
  type: MessageType.OUTCOME
  requestId: string
  result: string
}

export type OutcomeResponseMessage = OutcomeMessage

export type InvalidResponseMessage = {
  type: MessageType.INVALID
  requestId: string
  error: string
}

export type InputMessage = RequestMessage | RecoverMessage | OutcomeMessage

export type ResponseMessage = RequestResponseMessage | RecoverResponseMessage | OutcomeResponseMessage | InvalidResponseMessage
