import Ajv, { JSONSchemaType } from 'ajv'
import { Message, MessageType, RecoverMessage, RequestMessage, RequestType, SubmitSignatureMessage } from './types'
const ajv = new Ajv()

// Schemas

const messageSchema: JSONSchemaType<Pick<Message, 'type'>> = {
  type: 'object',
  properties: {
    type: {
      type: 'string',
      enum: Object.values(MessageType).filter(value => !value.endsWith('-response'))
    }
  },
  required: ['type']
}

const requestMessageSchema: JSONSchemaType<RequestMessage> = {
  type: 'object',
  properties: {
    type: {
      type: 'string',
      const: MessageType.REQUEST
    },
    payload: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          enum: Object.values(RequestType)
        },
        data: {
          type: 'string'
        }
      },
      required: ['type', 'data'],
      additionalProperties: false
    }
  },
  required: ['type', 'payload'],
  additionalProperties: false
}

const recoverMessageSchema: JSONSchemaType<RecoverMessage> = {
  type: 'object',
  properties: {
    type: {
      type: 'string',
      const: MessageType.RECOVER
    },
    payload: {
      type: 'object',
      properties: {
        requestId: {
          type: 'string'
        }
      },
      required: ['requestId'],
      additionalProperties: false
    }
  },
  required: ['type', 'payload'],
  additionalProperties: false
}

const submitSignatureMessageSchema: JSONSchemaType<SubmitSignatureMessage> = {
  type: 'object',
  properties: {
    type: {
      type: 'string',
      const: MessageType.SUBMIT_SIGNATURE
    },
    payload: {
      type: 'object',
      properties: {
        requestId: {
          type: 'string'
        },
        signer: {
          type: 'string'
        },
        signature: {
          type: 'string'
        }
      },
      required: ['requestId', 'signer', 'signature'],
      additionalProperties: false
    }
  },
  required: ['type', 'payload'],
  additionalProperties: false
}

// Compiled validators

const _validateMessage = ajv.compile(messageSchema)
const _validateRequestMessage = ajv.compile(requestMessageSchema)
const _validateRecoverMessage = ajv.compile(recoverMessageSchema)
const _validateSubmitSignatureMessage = ajv.compile(submitSignatureMessageSchema)

// API

export function validateMessage(message: unknown) {
  if (!_validateMessage(message)) {
    throw new Error(JSON.stringify(_validateMessage.errors))
  }
}

export function validateRequestMessage(message: unknown) {
  if (!_validateRequestMessage(message)) {
    throw new Error(JSON.stringify(_validateRequestMessage.errors))
  }
}

export function validateRecoverMessage(message: unknown) {
  if (!_validateRecoverMessage(message)) {
    throw new Error(JSON.stringify(_validateRecoverMessage.errors))
  }
}

export function validateSubmitSignatureMessage(message: unknown) {
  if (!_validateSubmitSignatureMessage(message)) {
    throw new Error(JSON.stringify(_validateSubmitSignatureMessage.errors))
  }
}
