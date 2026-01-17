import Ajv from 'ajv'
import addFormats from 'ajv-formats'
import { ethers } from 'ethers'
import { AuthChain } from '@dcl/schemas'
import { MAX_METHOD_LENGTH, MAX_PARAMS_ITEMS, MAX_ERROR_MESSAGE_LENGTH, MAX_REQUEST_ID_LENGTH } from './constants'
import {
  HttpOutcomeMessage,
  OutcomeMessage,
  RecoverMessage,
  RequestMessage,
  RequestValidationMessage,
  IdentityRequest,
  TipTransactionValidationParams,
  TipTransactionValidationResult,
  TipValidationConfigLike
} from './types'

// Re-export types for backwards compatibility
export type { TipTransactionValidationParams, TipTransactionValidationResult, TipValidationConfigLike }

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
    authChain: AuthChain.schema
  },
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
    }
  },
  required: ['identity'],
  additionalProperties: false
}

const requestMessageValidator = ajv.compile(requestMessageSchema)
const recoverMessageValidator = ajv.compile(recoverMessageSchema)
const outcomeMessageValidator = ajv.compile(outcomeMessageSchema)
const httpOutcomeMessageValidator = ajv.compile(httpOutcomeMessageSchema)
const requestValidationMessageValidator = ajv.compile(requestValidationMessageSchema)
const identityIdRequestValidator = ajv.compile(identityRequestSchema)

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

export function isTxHash(value: unknown): value is string {
  return typeof value === 'string' && /^0x[a-fA-F0-9]{64}$/.test(value)
}

export function validateHttpOutcomeMessage(msg: unknown) {
  if (!httpOutcomeMessageValidator(msg)) {
    throw new Error(JSON.stringify(httpOutcomeMessageValidator.errors))
  }

  return msg as HttpOutcomeMessage
}

// Helper to create error results
function fail(status: number, error: string): TipTransactionValidationResult {
  return { ok: false, status, error }
}

// ERC20 Transfer event interface (created once)
const ERC20_TRANSFER_INTERFACE = new ethers.Interface(['event Transfer(address indexed from, address indexed to, uint256 value)'])
const ERC20_TRANSFER_EVENT = ERC20_TRANSFER_INTERFACE.getEvent('Transfer')
const ERC20_TRANSFER_TOPIC = ERC20_TRANSFER_EVENT?.topicHash ?? ''

type ERC20TransferParams = {
  logs: readonly ethers.Log[]
  tokenAddress: string
  sender: string
  receiver: string
  amount: bigint
}

function findMatchingERC20Transfer(params: ERC20TransferParams): boolean {
  return params.logs.some(log => {
    if (log.address.toLowerCase() !== params.tokenAddress) return false
    if (!log.topics.length || log.topics[0] !== ERC20_TRANSFER_TOPIC) return false

    try {
      const parsed = ERC20_TRANSFER_INTERFACE.parseLog({ topics: log.topics as string[], data: log.data })
      if (!parsed) return false

      const from = String(parsed.args.from).toLowerCase()
      const to = String(parsed.args.to).toLowerCase()
      const value = BigInt(parsed.args.value.toString())

      return from === params.sender && to === params.receiver && value === params.amount
    } catch {
      return false
    }
  })
}

export function createTipTransactionValidator(config: TipValidationConfigLike) {
  let provider: ethers.JsonRpcProvider | null = null

  async function getProvider(): Promise<ethers.JsonRpcProvider | null> {
    if (provider) return provider

    const rpcUrl = await config.getString('TIP_VALIDATION_RPC_URL')
    if (!rpcUrl) return null

    provider = new ethers.JsonRpcProvider(rpcUrl)
    return provider
  }

  async function validateChainId(p: ethers.JsonRpcProvider): Promise<TipTransactionValidationResult | null> {
    const expectedChainId = await config.getString('TIP_VALIDATION_CHAIN_ID')
    if (!expectedChainId) return null

    const network = await p.getNetwork()
    if (network.chainId !== BigInt(expectedChainId)) {
      return fail(500, 'Tip validation provider chain mismatch')
    }
    return null
  }

  async function validateConfirmations(
    p: ethers.JsonRpcProvider,
    receiptBlockNumber: number
  ): Promise<TipTransactionValidationResult | null> {
    const minConfirmations = Number((await config.getString('TIP_VALIDATION_MIN_CONFIRMATIONS')) || '1')
    if (!Number.isFinite(minConfirmations) || minConfirmations <= 1) return null

    const latestBlock = await p.getBlockNumber()
    const confirmations = latestBlock - receiptBlockNumber + 1

    if (confirmations < minConfirmations) {
      return fail(409, 'Transaction not confirmed yet')
    }
    return null
  }

  return async (params: TipTransactionValidationParams): Promise<TipTransactionValidationResult> => {
    const p = await getProvider()
    if (!p) {
      // Backwards compatibility: skip validation if RPC isn't configured
      return { ok: true }
    }

    // Normalize addresses once
    const sender = params.senderAddress.toLowerCase()
    const receiver = params.receiverAddress.toLowerCase()

    // Validate chain
    const chainError = await validateChainId(p)
    if (chainError) return chainError

    // Validate receipt
    const receipt = await p.getTransactionReceipt(params.transactionHash)
    if (!receipt) return fail(409, 'Transaction not mined yet')
    if (receipt.status !== 1) return fail(400, 'Transaction reverted')

    // Validate confirmations
    const confirmationsError = await validateConfirmations(p, receipt.blockNumber)
    if (confirmationsError) return confirmationsError

    // Validate transaction
    const tx = await p.getTransaction(params.transactionHash)
    if (!tx) return fail(400, 'Transaction not found')
    if (!tx.from || tx.from.toLowerCase() !== sender) return fail(403, 'Transaction sender mismatch')

    // Parse expected amount
    const amountDecimals = Number((await config.getString('TIP_VALIDATION_AMOUNT_DECIMALS')) || '18')
    let expectedAmount: bigint
    try {
      expectedAmount = ethers.parseUnits(params.amount, amountDecimals)
    } catch {
      return fail(400, 'Invalid amount format')
    }

    // ERC20 or native transfer?
    const tokenAddress = await config.getString('TIP_VALIDATION_ERC20_TOKEN_ADDRESS')

    if (tokenAddress) {
      // ERC20 transfer validation
      const hasMatchingTransfer = findMatchingERC20Transfer({
        logs: receipt.logs,
        tokenAddress: tokenAddress.toLowerCase(),
        sender,
        receiver,
        amount: expectedAmount
      })

      if (!hasMatchingTransfer) {
        return fail(400, 'Transaction does not match expected ERC20 transfer')
      }
    } else {
      // Native transfer validation
      if (!tx.to || tx.to.toLowerCase() !== receiver) {
        return fail(400, 'Transaction receiver mismatch')
      }
      if (BigInt(tx.value?.toString() || '0') !== expectedAmount) {
        return fail(400, 'Transaction amount mismatch')
      }
    }

    return { ok: true }
  }
}
