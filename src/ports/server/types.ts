import { IBaseComponent } from '@well-known-components/interfaces'
import { AuthIdentity } from '@dcl/crypto'
import { AuthChain } from '@dcl/schemas'

export type IServerComponent = IBaseComponent

export enum MessageType {
  REQUEST = 'request',
  RECOVER = 'recover',
  OUTCOME = 'outcome',
  INVALID = 'invalid',
  REQUEST_VALIDATION_STATUS = 'request-validation-status'
}

export type Request = {
  method: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  params: any[]
}

export type RequestMessage = Request & {
  authChain?: AuthChain
}

export type LiveResponseMessage = {
  timestamp: number
}

export type RequestResponseMessage = {
  requestId: string
  expiration: Date
  code: number
}

export type RecoverMessage = {
  requestId: string
}

export type RecoverResponseMessage = Request & {
  expiration: Date
  code: number
  sender?: string
}

export type OutcomeError = {
  code: number
  message: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data?: any
}

export type Outcome = {
  sender: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  result?: any
  error?: OutcomeError
}

export type OutcomeMessage = Outcome & {
  requestId: string
}

export type RequestValidationMessage = {
  requestId: string
}

export type RequestValidationStatusMessage = {
  requiresValidation: boolean
}

export type HttpOutcomeMessage = Outcome

export type OutcomeResponseMessage = OutcomeMessage

export type InvalidResponseMessage = {
  error: string
}

export type IdentityRequest = {
  identity: AuthIdentity
}

export type IdentityResponse = {
  identityId: string
  expiration: Date
}

export type IdentityIdValidationResponse = {
  identity: AuthIdentity
}

export type InputMessage = RequestMessage | RecoverMessage | OutcomeMessage | IdentityRequest

export type ResponseMessage = RequestResponseMessage | RecoverResponseMessage | OutcomeResponseMessage | InvalidResponseMessage
