import { IBaseComponent } from '@well-known-components/interfaces'

export type IServerComponent = IBaseComponent

export enum MessageType {
  REQUEST = 'request',
  REQUEST_RESPONSE = 'request-response',
  RECOVER = 'recover',
  RECOVER_RESPONSE = 'recover-response',
  SUBMIT_SIGNATURE = 'submit-signature',
  SUBMIT_SIGNATURE_RESPONSE = 'submit-signature-response'
}

export enum RequestType {
  SIGNATURE = 'signature'
}

// Request Messages

export type RequestMessage = {
  type: MessageType.REQUEST
  payload: {
    type: RequestType.SIGNATURE
    data: string
  }
}

export type RequestResponseMessage = {
  type: MessageType.REQUEST_RESPONSE
  payload:
    | {
        ok: true
        requestId: string
      }
    | {
        ok: false
        error: string
      }
}

// Recover Messages

export type RecoverMessage = {
  type: MessageType.RECOVER
  payload: {
    requestId: string
  }
}

export type RecoverResponseMessage = {
  type: MessageType.RECOVER_RESPONSE
  payload: {
    requestId: string
  } & (
    | ({
        ok: true
      } & RequestMessage['payload'])
    | {
        ok: false
        error: string
      }
  )
}

// Signature Submission Messages

export type SubmitSignatureMessage = {
  type: MessageType.SUBMIT_SIGNATURE
  payload: {
    requestId: string
    signer: string
    signature: string
  }
}

export type SubmitSignatureResponseMessage = {
  type: MessageType.SUBMIT_SIGNATURE_RESPONSE
  payload: {
    requestId: string
  } & (
    | {
        ok: true
        signer: string
        signature: string
      }
    | {
        ok: false
        error: string
      }
  )
}

export type Message =
  | RequestMessage
  | RequestResponseMessage
  | RecoverMessage
  | RecoverResponseMessage
  | SubmitSignatureMessage
  | SubmitSignatureResponseMessage
