import { DefaultEventsMap } from 'socket.io/dist/typed-events'
import { io, Socket } from 'socket.io-client'
import {
  OutcomeResponseMessage,
  RecoverResponseMessage,
  RequestResponseMessage,
  RequestValidationStatusMessage
} from '../src/ports/server/types'

export type HttpPollingClient = {
  request(data: unknown): Promise<RequestResponseMessage | { error: string }>
  sendSuccessfulOutcome(requestId: string, sender: string, result: unknown): Promise<{ error: string } | undefined>
  sendFailedOutcome(requestId: string, sender: string, error: { code: number; message: string }): Promise<{ error: string } | undefined>
  notifyRequestValidation(requestId: string): Promise<{ error: string } | undefined>
  getRequestValidationStatus(requestId: string): Promise<RequestValidationStatusMessage | { error: string } | undefined>
  getOutcome(requestId: string): Promise<OutcomeResponseMessage | undefined>
  recover(requestId: string): Promise<RecoverResponseMessage>
}

export async function createHttpClient(port: number | string): Promise<HttpPollingClient> {
  const url = `http://localhost:${port}`

  return {
    async request(data: unknown): Promise<RequestResponseMessage | { error: string }> {
      // Make a post request
      const response = await fetch(`${url}/requests`, {
        method: 'POST',
        body: JSON.stringify(data),
        headers: [
          ['Content-Type', 'application/json'],
          ['Origin', 'http://localhost:3000']
        ]
      })

      return response.json()
    },
    async sendSuccessfulOutcome(requestId: string, sender: string, result: unknown): Promise<{ error: string } | undefined> {
      const response = await fetch(`${url}/v2/requests/${requestId}/outcome`, {
        method: 'POST',
        body: JSON.stringify({ sender, result }),
        headers: [['Content-Type', 'application/json']]
      })
      let body: { error: string } | undefined

      try {
        body = await response.json()
      } catch (e) {
        return undefined
      }

      return body
    },
    async sendFailedOutcome(
      requestId: string,
      sender: string,
      error: { code: number; message: string }
    ): Promise<{ error: string } | undefined> {
      const response = await fetch(`${url}/v2/requests/${requestId}/outcome`, {
        method: 'POST',
        body: JSON.stringify({ sender, error }),
        headers: [['Content-Type', 'application/json']]
      })
      let body: { error: string } | undefined

      try {
        body = await response.json()
      } catch (e) {
        return undefined
      }

      return body
    },
    async recover(requestId: string): Promise<RecoverResponseMessage> {
      const response = await fetch(`${url}/v2/requests/${requestId}`, {
        method: 'GET',
        headers: [['Origin', 'http://localhost:3000']]
      })

      return response.json()
    },
    async getOutcome(requestId: string): Promise<OutcomeResponseMessage | undefined> {
      const response = await fetch(`${url}/requests/${requestId}`, {
        method: 'GET',
        headers: [['Origin', 'http://localhost:3000']]
      })

      return response.json()
    },
    async notifyRequestValidation(requestId: string): Promise<{ error: string } | undefined> {
      const result = await fetch(`${url}/v2/requests/${requestId}/validation`, {
        method: 'POST'
      })

      if (result.ok) {
        return undefined
      }

      return result.json()
    },
    async getRequestValidationStatus(requestId: string): Promise<RequestValidationStatusMessage | { error: string } | undefined> {
      const result = await fetch(`${url}/v2/requests/${requestId}/validation`, {
        method: 'GET'
      })

      return result.json()
    }
  }
}

export async function createAuthWsClient(port: number | string): Promise<Socket<DefaultEventsMap, DefaultEventsMap>> {
  const ioClient = io(`http://localhost:${port}`)
  return new Promise(resolve => {
    const handleOnConnect = () => {
      resolve(ioClient)
    }

    ioClient.on('connect', handleOnConnect)
  })
}

/**
 * The typed data of a CreditsManager meta-transaction whose `functionData` is `calldataHexLength`
 * hex characters long, as the Explorer sends it in an `eth_signTypedData_v4` request. The typed data
 * of a NAME claim paid with Credits measured 16,573 characters, nearly all of it the `useCredits`
 * calldata wrapping the bridge route: about 16,000 hex characters.
 */
export function metaTransactionTypedData(calldataHexLength: number): string {
  return JSON.stringify({
    // EIP-712 names its types in PascalCase.
    types: {
      // eslint-disable-next-line @typescript-eslint/naming-convention
      EIP712Domain: [
        { name: 'name', type: 'string' },
        { name: 'version', type: 'string' },
        { name: 'verifyingContract', type: 'address' },
        { name: 'salt', type: 'bytes32' }
      ],
      // eslint-disable-next-line @typescript-eslint/naming-convention
      MetaTransaction: [
        { name: 'nonce', type: 'uint256' },
        { name: 'from', type: 'address' },
        { name: 'functionData', type: 'bytes' }
      ]
    },
    domain: {
      name: 'Decentraland Credits',
      version: '1',
      verifyingContract: '0x1234567890123456789012345678901234567890',
      salt: '0x0000000000000000000000000000000000000000000000000000000000000089'
    },
    primaryType: 'MetaTransaction',
    message: {
      nonce: '0',
      from: '0x1234567890123456789012345678901234567890',
      functionData: `0x${'ab'.repeat(calldataHexLength / 2)}`
    }
  })
}

/**
 * The init of a fetch whose body is `text` sent as a stream, in two chunks, so the request declares
 * no `Content-Length` and the server only learns its size by reading it.
 */
export function streamedBodyInit(text: string): RequestInit {
  const bytes = new TextEncoder().encode(text)
  const half = Math.floor(bytes.byteLength / 2)
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes.slice(0, half))
      controller.enqueue(bytes.slice(half))
      controller.close()
    }
  })
  // `duplex` is required by fetch for a streamed body and missing from the DOM typings.
  return { body, duplex: 'half' } as RequestInit
}
