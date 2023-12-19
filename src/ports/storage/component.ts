import { IStorageComponent, Request } from './types'

export function createStorageComponent(): IStorageComponent {
  const requests: Record<string, Request> = {}

  const getRequest = (requestId: string) => {
    return requests[requestId] ?? null
  }

  const setRequest = (requestId: string, message: Request) => {
    requests[requestId] = message
  }

  return {
    getRequest,
    setRequest
  }
}
