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

      if (response.status === 204) {
        return undefined
      }

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
