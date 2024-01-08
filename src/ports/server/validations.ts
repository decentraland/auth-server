import Ajv from 'ajv'
import { AuthChain } from '@dcl/schemas'
import { OutcomeMessage, RecoverMessage, RequestMessage } from './types'

const ajv = new Ajv({ allowUnionTypes: true })

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

const requestMessageValidator = ajv.compile(requestMessageSchema)
const recoverMessageValidator = ajv.compile(recoverMessageSchema)
const outcomeMessageValidator = ajv.compile(outcomeMessageSchema)

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
