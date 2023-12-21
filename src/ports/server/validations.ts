import Ajv, { JSONSchemaType } from 'ajv'
import { MessageType, OutcomeMessage, RecoverMessage, RequestMessage } from './types'
const ajv = new Ajv({ allowUnionTypes: true })

const requestMessageSchema: JSONSchemaType<RequestMessage> = {
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
      type: 'array',
      items: {
        type: 'string'
      }
    },
    sender: {
      type: 'string',
      nullable: true
    },
    chainId: {
      type: 'number',
      nullable: true
    }
  },
  required: ['type', 'method', 'params'],
  additionalProperties: false
}

const recoverMessageSchema: JSONSchemaType<RecoverMessage> = {
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

const outcomeMessageSchema: JSONSchemaType<OutcomeMessage> = {
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
    result: {
      oneOf: [
        {
          type: ['number', 'string', 'boolean']
        },
        {
          type: 'array',
          items: {
            type: ['number', 'string', 'boolean']
          }
        }
      ]
    }
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
