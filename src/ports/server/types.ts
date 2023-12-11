import { IBaseComponent } from '@well-known-components/interfaces'

export type IServerComponent = IBaseComponent

export enum MessageType {
  INIT = 'init',
  SIGNATURE = 'signature'
}

export type Message = {
  type: MessageType
}

// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace ClientMessage {
  export type Signature = Message & {
    type: MessageType.SIGNATURE
    payload: {
      requestId: string
      signer: string
      signature: string
    }
  }
}

// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace ServerMessage {
  export type Init = Message & {
    type: MessageType.INIT
    payload: {
      requestId: string
    }
  }

  export type Signature = ClientMessage.Signature
}
