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
  additionalProperties: false,
  if: {
    properties: {
      method: {
        const: 'dcl_personal_sign'
      }
    },
    required: ['method']
  },
  then: {
    properties: {
      params: {
        type: 'array',
        items: [
          {
            type: 'string'
          },
          {
            type: 'integer',
            minimum: 0,
            maximum: 99
          }
        ],
        additionalItems: false,
        minItems: 2,
        maxItems: 2
      }
    }
  }
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
