import { IBaseComponent } from '@well-known-components/interfaces'

export type IServerComponent = IBaseComponent

export enum MessageType {
  INVALID_RESPONSE = 'invalid-response',
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

// Invalid Messages

export type InvalidResponseMessage = {
  type: MessageType.INVALID_RESPONSE
  payload: {
    requestId?: string
    error: string
  }
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
  payload:
    | ({
        ok: true
        requestId: string
      } & RequestMessage['payload'])
    | {
        ok: false
        requestId?: string
        error: string
      }
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
  payload:
    | {
        ok: true
        requestId: string
        signer: string
        signature: string
      }
    | {
        ok: false
        requestId?: string
        error: string
      }
}

export type Message =
  | InvalidResponseMessage
  | RequestMessage
  | RequestResponseMessage
  | RecoverMessage
  | RecoverResponseMessage
  | SubmitSignatureMessage
  | SubmitSignatureResponseMessage
