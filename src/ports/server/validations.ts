import Ajv from 'ajv'
import addFormats from 'ajv-formats'
import { AuthChain } from '@dcl/schemas'
import { HttpOutcomeMessage, OutcomeMessage, RecoverMessage, RequestMessage, RequestValidationMessage } from './types'

const ajv = new Ajv({ allowUnionTypes: true })
addFormats(ajv)

const requestMessageSchema = {
  type: 'object',
  properties: {
    method: {
      type: 'string'
    },
    params: {
      type: 'array'
    },
    authChain: AuthChain.schema
  },
  required: ['method', 'params'],
  additionalProperties: false
}

const recoverMessageSchema = {
  type: 'object',
  properties: {
    requestId: {
      type: 'string'
    }
  },
  required: ['requestId'],
  additionalProperties: false
}

const outcomeMessageSchema = {
  type: 'object',
  properties: {
    requestId: {
      type: 'string'
    },
    sender: {
      type: 'string'
    },
    result: {},
    error: {
      type: 'object',
      properties: {
        code: {
          type: 'number'
        },
        message: {
          type: 'string'
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
    requestId: { type: 'string' }
  },
  required: ['requestId']
}

const requestMessageValidator = ajv.compile(requestMessageSchema)
const recoverMessageValidator = ajv.compile(recoverMessageSchema)
const outcomeMessageValidator = ajv.compile(outcomeMessageSchema)
const httpOutcomeMessageValidator = ajv.compile(httpOutcomeMessageSchema)
const requestValidationMessageValidator = ajv.compile(requestValidationMessageSchema)

export function validateRequestMessage(msg: unknown) {
  if (!requestMessageValidator(msg)) {
    throw new Error(JSON.stringify(requestMessageValidator.errors))
  }

  return msg as RequestMessage
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
