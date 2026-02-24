import { METHOD_DCL_PERSONAL_SIGN } from '../ports/server/constants'
import type { HttpOutcomeMessage, OutcomeResponseMessage, RecoverResponseMessage } from '../ports/server/types'
import type { StorageRequest } from '../ports/storage/types'
import type { AppComponents, IRequestOperationsComponent } from '../types/components'
import type { BuildRequestRecordParams, ComputeRequestExpirationParams, ToFulfilledRequestRecordParams } from './request-operations.types'

export async function createRequestOperationsComponent(_components: Pick<AppComponents, 'config'>): Promise<IRequestOperationsComponent> {
  const computeRequestExpiration = (params: ComputeRequestExpirationParams): Date => {
    const now = params.now ?? Date.now()
    const expirationInSeconds =
      params.method !== METHOD_DCL_PERSONAL_SIGN ? params.requestExpirationInSeconds : params.dclPersonalSignExpirationInSeconds

    return new Date(now + expirationInSeconds * 1000)
  }

  const buildRequestRecord = (params: BuildRequestRecordParams): StorageRequest => {
    return {
      requestId: params.requestId,
      requiresValidation: false,
      expiration: params.expiration,
      code: params.code,
      method: params.method,
      params: params.params,
      sender: params.sender?.toLowerCase()
    }
  }

  const isRequestExpired = (request: Pick<StorageRequest, 'expiration'>, now: Date = new Date()): boolean => {
    return request.expiration < now
  }

  const toRecoverResponse = (
    request: Pick<StorageRequest, 'expiration' | 'code' | 'method' | 'params' | 'sender'>
  ): RecoverResponseMessage => {
    return {
      expiration: request.expiration,
      code: request.code,
      method: request.method,
      params: request.params,
      sender: request.sender
    }
  }

  const toOutcomeResponse = (requestId: string, outcome: HttpOutcomeMessage): OutcomeResponseMessage => {
    return {
      ...outcome,
      requestId
    }
  }

  const toFulfilledRequestRecord = (params: ToFulfilledRequestRecordParams): StorageRequest => {
    return {
      requestId: params.requestId,
      fulfilled: true,
      expiration: params.expiration,
      code: 0,
      method: '',
      params: [],
      requiresValidation: false
    }
  }

  const toPollingOutcomeRecord = (request: StorageRequest, outcome: OutcomeResponseMessage): StorageRequest => {
    return {
      ...request,
      response: outcome
    }
  }

  return {
    computeRequestExpiration,
    buildRequestRecord,
    isRequestExpired,
    toRecoverResponse,
    toOutcomeResponse,
    toFulfilledRequestRecord,
    toPollingOutcomeRecord
  }
}
