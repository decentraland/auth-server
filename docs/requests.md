# Requests

Requests are the main entity handled by this service. A request contains a wallet method that the client wants to execute on the auth dapp.

This service is **polling-only**. WebSocket/Socket.IO is no longer supported.

## Request lifecycle

1. Client creates a request with `POST /requests`.
2. Server returns `{ requestId, expiration, code }`.
3. Auth dapp recovers request details with `GET /v2/requests/:requestId`.
4. Auth dapp executes the wallet action and submits outcome with `POST /v2/requests/:requestId/outcome`.
5. Original client polls `GET /requests/:requestId` until it gets the final outcome.

Key behavior:

1. Requests expire and cannot be consumed after expiration.
2. `GET /requests/:requestId` returns:
   - `204` while pending
   - `200` with outcome when completed
   - `404` if not found
   - `410` if expired or already fulfilled

## Polling flow example

```ts
const authServerUrl = 'https://auth-api.decentraland.org'

const createRequestResponse = await fetch(`${authServerUrl}/requests`, {
  method: 'POST',
  headers: [['Content-Type', 'application/json']],
  body: JSON.stringify({
    method: 'personal_sign',
    params: ['message to sign', '0xSignerAddress']
  })
})

const { requestId, expiration, code } = await createRequestResponse.json()

async function pollOutcome(requestId: string) {
  while (true) {
    const response = await fetch(`${authServerUrl}/requests/${requestId}`)

    if (response.status === 204) {
      await new Promise(resolve => setTimeout(resolve, 1000))
      continue
    }

    if (!response.ok) {
      throw await response.json()
    }

    return await response.json()
  }
}

const outcome = await pollOutcome(requestId)
```

## Validation status endpoints

For flows that require additional user validation:

1. Auth dapp notifies: `POST /v2/requests/:requestId/validation`
2. Client checks status: `GET /v2/requests/:requestId/validation`

Response shape:

```json
{
  "requiresValidation": true
}
```

## `dcl_personal_sign` authentication flow

`dcl_personal_sign` works like `personal_sign` with one difference: the initial request only includes the ephemeral message.

1. Create ephemeral wallet.
2. Build ephemeral message with expiration.
3. Create request:

```ts
await fetch(`${authServerUrl}/requests`, {
  method: 'POST',
  headers: [['Content-Type', 'application/json']],
  body: JSON.stringify({
    method: 'dcl_personal_sign',
    params: [ephemeralMessage]
  })
})
```

4. Poll outcome and use `{ sender, result }` to build the auth identity.

## Migration guide: WebSocket to polling

If your client used Socket.IO, migrate using this mapping:

1. `socket.emitWithAck('request', payload)` -> `POST /requests`
2. `socket.on('outcome')` -> poll `GET /requests/:requestId`
3. `socket.emitWithAck('request-validation-status')` -> `POST /v2/requests/:requestId/validation`
4. `socket.on('request-validation-status')` -> poll `GET /v2/requests/:requestId/validation`

Recommended client behavior:

1. Poll every 1 second while request is pending (`204`).
2. Stop polling immediately on `200`, `404`, or `410`.
3. Keep client-side timeout lower than request expiration.
