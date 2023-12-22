import Ajv from 'ajv'
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
    sender: {
      type: 'string'
    },
    chainId: {
      type: 'number'
    }
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
    result: {}
  },
  required: ['requestId', 'sender', 'result'],
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
