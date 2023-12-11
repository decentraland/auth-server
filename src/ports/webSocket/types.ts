import { IBaseComponent } from '@well-known-components/interfaces'

export type IWebSocketComponent = IBaseComponent

export enum MessageType {
  INIT = 'init',
  SIGN_IN = 'sign-in'
}

export type Message = {
  type: MessageType
}

export type InitServerMessage = Message & {
  type: MessageType.INIT
  payload: {
    requestId: string
  }
}

export type SignInClientMessage = Message & {
  type: MessageType.SIGN_IN
  payload: {
    requestId: string
    address: string
    signature: string
    expiration: Date
  }
}
