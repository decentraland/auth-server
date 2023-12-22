import Ajv from 'ajv'
import { MessageType } from './types'
const ajv = new Ajv({ allowUnionTypes: true })

const requestMessageSchema = {
  type: 'object',
  properties: {
    type: {
      type: 'string',
      const: MessageType.REQUEST
    },
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
  required: ['type', 'method', 'params'],
  additionalProperties: false
}

const recoverMessageSchema = {
  type: 'object',
  properties: {
    type: {
      type: 'string',
      const: MessageType.RECOVER
    },
    requestId: {
      type: 'string'
    }
  },
  required: ['type', 'requestId'],
  additionalProperties: false
}

const outcomeMessageSchema = {
  type: 'object',
  properties: {
    type: {
      type: 'string',
      const: MessageType.OUTCOME
    },
    requestId: {
      type: 'string'
    },
    sender: {
      type: 'string'
    },
    result: {}
  },
  required: ['type', 'requestId', 'sender', 'result'],
  additionalProperties: false
}

const compiled = ajv.compile({
  oneOf: [requestMessageSchema, recoverMessageSchema, outcomeMessageSchema]
})

export function validateMessage(msg: unknown) {
  if (!compiled(msg)) {
    throw new Error(JSON.stringify(compiled.errors))
  }
}
