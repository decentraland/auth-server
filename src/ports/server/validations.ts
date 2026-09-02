import Ajv from 'ajv'
import addFormats from 'ajv-formats'
import { InvalidRequestError } from '@dcl/http-commons'
import { AuthChain } from '@dcl/schemas'
import { isEphemeralMessage } from '../../logic/auth-chain'
import { SimulationRequestBody } from '../../logic/simulation/types'
import { DISALLOWED_METHODS, MAX_METHOD_LENGTH, MAX_PARAMS_ITEMS, MAX_ERROR_MESSAGE_LENGTH, MAX_REQUEST_ID_LENGTH } from './constants'
import {
  HttpOutcomeMessage,
  OutcomeMessage,
  RecoverMessage,
  RequestMessage,
  RequestValidationMessage,
  IdentityRequest,
  CheckpointRequest,
  AccountDeletionMetadata,
  ValidatedRequestMessage
} from './types'

const ajv = new Ajv({ allowUnionTypes: true })
addFormats(ajv)

const requestMessageSchema = {
  type: 'object',
  properties: {
    method: {
      type: 'string',
      maxLength: MAX_METHOD_LENGTH
    },
    params: {
      type: 'array',
      maxItems: MAX_PARAMS_ITEMS
    },
    authChain: AuthChain.schema,
    timestamp: {
      type: 'integer',
      minimum: 0
    }
  },
  // `authChain` is required on every request, but deliberately not listed here: presence is checked
  // right after this schema runs so a client gets `Auth chain is required` instead of an Ajv error
  // blob. `validateRequestMessage` is what guarantees the field, and it narrows its return type to
  // `ValidatedRequestMessage` to say so.
  required: ['method', 'params'],
  additionalProperties: false
}

const recoverMessageSchema = {
  type: 'object',
  properties: {
    requestId: {
      type: 'string',
      maxLength: MAX_REQUEST_ID_LENGTH
    }
  },
  required: ['requestId'],
  additionalProperties: false
}

const outcomeMessageSchema = {
  type: 'object',
  properties: {
    requestId: {
      type: 'string',
      maxLength: MAX_REQUEST_ID_LENGTH
    },
    sender: {
      type: 'string',
      pattern: '^0x[a-fA-F0-9]{40}$'
    },
    result: {},
    error: {
      type: 'object',
      properties: {
        code: {
          type: 'number'
        },
        message: {
          type: 'string',
          maxLength: MAX_ERROR_MESSAGE_LENGTH
        },
        data: {}
      },
      required: ['code', 'message'],
      additionalProperties: false
    }
  },
  required: ['requestId', 'sender'],
  oneOf: [
    {
      required: ['result']
    },
    {
      required: ['error']
    }
  ],
  additionalProperties: false
}

const httpOutcomeMessageSchema = {
  ...outcomeMessageSchema,
  required: ['sender']
}

const requestValidationMessageSchema = {
  type: 'object',
  properties: {
    requestId: { type: 'string', maxLength: MAX_REQUEST_ID_LENGTH }
  },
  required: ['requestId']
}

const identityRequestSchema = {
  type: 'object',
  properties: {
    identity: {
      type: 'object',
      properties: {
        expiration: { type: 'string', format: 'date-time' },
        ephemeralIdentity: {
          type: 'object',
          properties: {
            address: { type: 'string' },
            privateKey: { type: 'string' },
            publicKey: { type: 'string' }
          },
          required: ['address', 'privateKey', 'publicKey']
        },
        authChain: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              type: { type: 'string' },
              payload: { type: 'string' },
              signature: { type: 'string' }
            },
            required: ['type', 'payload', 'signature']
          }
        }
      },
      required: ['expiration', 'ephemeralIdentity', 'authChain']
    },
    isMobile: { type: 'boolean' }
  },
  required: ['identity'],
  additionalProperties: false
}

const checkpointRequestSchema = {
  type: 'object',
  properties: {
    checkpointId: {
      type: 'integer',
      minimum: 1,
      maximum: 7
    },
    userIdentifier: {
      type: 'string',
      minLength: 1,
      maxLength: 255
    },
    identifierType: {
      type: 'string',
      enum: ['email', 'wallet']
    },
    action: {
      type: 'string',
      enum: ['reached', 'completed']
    },
    email: {
      type: 'string',
      format: 'email',
      maxLength: 255
    },
    wallet: {
      type: 'string',
      maxLength: 255
    },
    source: {
      type: 'string',
      maxLength: 50
    },
    metadata: {
      type: 'object'
    }
  },
  required: ['checkpointId', 'userIdentifier', 'identifierType', 'action'],
  additionalProperties: false
}

const accountDeletionMetadataSchema = {
  type: 'object',
  properties: {
    didToken: {
      type: 'string',
      minLength: 1,
      maxLength: 4096
    }
  },
  required: ['didToken'],
  // Signed-fetch metadata may carry other fields (e.g. signer) alongside the token.
  additionalProperties: true
}

const simulationRequestSchema = {
  type: 'object',
  properties: {
    chainId: {
      type: 'integer'
    },
    from: {
      type: 'string',
      pattern: '^0x[a-fA-F0-9]{40}$'
    },
    to: {
      type: 'string',
      pattern: '^0x[a-fA-F0-9]{40}$'
    },
    data: {
      type: 'string',
      pattern: '^0x[a-fA-F0-9]*$',
      maxLength: 200000
    },
    value: {
      type: 'string',
      pattern: '^(0x[a-fA-F0-9]{1,64}|[0-9]{1,78})$'
    }
  },
  required: ['chainId', 'from', 'to'],
  additionalProperties: false
}

const requestMessageValidator = ajv.compile(requestMessageSchema)
const recoverMessageValidator = ajv.compile(recoverMessageSchema)
const outcomeMessageValidator = ajv.compile(outcomeMessageSchema)
const httpOutcomeMessageValidator = ajv.compile(httpOutcomeMessageSchema)
const requestValidationMessageValidator = ajv.compile(requestValidationMessageSchema)
const identityIdRequestValidator = ajv.compile(identityRequestSchema)
const checkpointRequestValidator = ajv.compile(checkpointRequestSchema)
const accountDeletionMetadataValidator = ajv.compile(accountDeletionMetadataSchema)
const simulationRequestValidator = ajv.compile(simulationRequestSchema)

/** Whether `method` is one this service refuses to create requests for. See `DISALLOWED_METHODS`. */
export function isDisallowedMethod(method: string): boolean {
  return DISALLOWED_METHODS.has(method.trim().toLowerCase())
}

export function validateRequestMessage(msg: unknown): ValidatedRequestMessage {
  if (!requestMessageValidator(msg)) {
    throw new Error(JSON.stringify(requestMessageValidator.errors))
  }

  const requestMessage = msg as RequestMessage

  // Every check below lives here rather than in either handler so the socket and HTTP entry points,
  // which share this validator, cannot drift apart on what they accept.
  if (isDisallowedMethod(requestMessage.method)) {
    // Normalised so the message is identical whatever casing the caller used.
    throw new Error(`The ${requestMessage.method.trim().toLowerCase()} method is not allowed`)
  }

  // Refuse any method used to sign a Decentraland ephemeral message, which would reproduce the
  // removed dcl_personal_sign flow under a different name.
  if (requestMessage.params.some(param => typeof param === 'string' && isEphemeralMessage(param))) {
    throw new Error('Signing a Decentraland ephemeral message is not allowed')
  }

  // Checked last so a caller on a retired flow is told which method to stop using, rather than being
  // sent to fix an auth chain on a request that would be refused regardless.
  if (!requestMessage.authChain) {
    throw new Error('Auth chain is required')
  }

  return requestMessage as ValidatedRequestMessage
}

export function validateRecoverMessage(msg: unknown) {
  if (!recoverMessageValidator(msg)) {
    throw new Error(JSON.stringify(recoverMessageValidator.errors))
  }

  return msg as RecoverMessage
}

export function validateOutcomeMessage(msg: unknown) {
  if (!outcomeMessageValidator(msg)) {
    throw new Error(JSON.stringify(outcomeMessageValidator.errors))
  }

  return msg as OutcomeMessage
}

export function validateRequestValidationMessage(msg: unknown) {
  if (!requestValidationMessageValidator(msg)) {
    throw new Error(JSON.stringify(requestValidationMessageValidator.errors))
  }

  return msg as RequestValidationMessage
}

export function validateIdentityRequest(msg: unknown) {
  if (!identityIdRequestValidator(msg)) {
    throw new Error(JSON.stringify(identityIdRequestValidator.errors))
  }

  return msg as IdentityRequest
}

export function validateIdentityId(identityId: string): boolean {
  if (!identityId || typeof identityId !== 'string') {
    return false
  }

  // Basic UUID v4 format validation
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
  return uuidRegex.test(identityId)
}

export function validateHttpOutcomeMessage(msg: unknown) {
  if (!httpOutcomeMessageValidator(msg)) {
    throw new Error(JSON.stringify(httpOutcomeMessageValidator.errors))
  }

  return msg as HttpOutcomeMessage
}

export function validateCheckpointRequest(msg: unknown) {
  if (!checkpointRequestValidator(msg)) {
    throw new Error(JSON.stringify(checkpointRequestValidator.errors))
  }

  return msg as CheckpointRequest
}

export function validateAccountDeletionMetadata(msg: unknown) {
  if (!accountDeletionMetadataValidator(msg)) {
    throw new Error(JSON.stringify(accountDeletionMetadataValidator.errors))
  }

  return msg as AccountDeletionMetadata
}

export function validateSimulationRequest(msg: unknown): SimulationRequestBody {
  if (!simulationRequestValidator(msg)) {
    // errorHandler maps InvalidRequestError to a 400.
    throw new InvalidRequestError(JSON.stringify(simulationRequestValidator.errors))
  }

  return msg as SimulationRequestBody
}
