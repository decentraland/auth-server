# Requests

Requests are the main entity this server handles. Requests contain the wallet methods that the desktop client want to execute.

They are created on the auth server on demand by the desktop client. The server then provides a request id, which can then be used to recover that request on a browser (which in this case it is intended to be opened on the auth dapp).

On the auth dapp, the user can execute said request by using the connected wallet, and communicate the result back to the auth server, which in turn will communicate it back to the desktop client.

For example, if the desktop client needs to send a transaction, it would create a transaction for the `eth_sendTransaction` method, and await for the result, which would be a transaction hash, to be returned after the flow is complete.

Requests have the following characteristics:

1. Only one request can exist at a time per connected socket. A new request will invalidate a previous one if it existed.
2. Requests have an expiration, and cannot be consumed after it.
3. If the socket disconnects, any request made by that socket will be deleted.

# Usage

This section will explain the ways in which the service can be used.

[Socket.IO](https://socket.io/) is required to connect to the auth server (https://auth-api.decentraland.org).

The next example will show how a `personal_sign` can be requested by the desktop client.

1. The desktop client has to connect to the auth server through web sockets.

```ts
const socket = io('https://auth-api.decentraland.org')
```

2. The desktop client has to send a request message with the method information to the auth server, and wait for the response.

```ts
const { requestId, expiration, code } = await socket.emitWithAck('request', {
  method: 'personal_sign',
  params: ['message to sign', 'signer address'],
  authChain: identity.authChain
})
```

The expiration shows when the request will become unavailable. The request must be consumed before it expires.

The code can be used as an easy visual help to be displayed on both the desktop client and the auth dapp for the user to see that if they match, they have a really high chance of being for the same request.

The request id is necessary for the next step.

4. Once the request id is obtained, the client has to listen for the corresponding outcome message that will provide the result of the request that will be executed on the auth dapp.

```ts
const outcome = await new Promise((resolve, reject) => {
  socket.on('outcome', msg => {
    if (msg.requestId === requestId) {
      socket.off('message', onMessage)
      if (msg.error) {
        reject(msg.error)
      } else {
        resolve(msg)
      }
    }
  })
})
```

5. Get the `result` and the `sender` from the outcome message and do with them whatever is necessary.

#### Using http-polling without Socket.IO

It is possible avoid using `SocketIO` as a request maker (client-side). In the next example, the same flow as below is presented but using http-polling:

1. The desktop client has to send a request message with the method information to the auth server by directly sending a http POST to the `/requests` path.

```ts
const authServerUrl = 'https://auth-api.decentraland.org'
const response = await fetch(`${authServerUrl}/requests`, {
  method: 'POST',
  headers: [['Content-type', 'application/json']],
  body: JSON.stringify({
    method: 'personal_sign',
    params: ['message to sign', 'signer address'],
    authChain: identity.authChain
  })
})
const { requestId, expiration, code } = await response.json()
```

2. Once the request id is obtained, the client has to polling periodically for the corresponding outcome message that will provide the result of the request that will be executed on the auth dapp.

```ts
async function getResponse(requestId: string) {
  while (true) {
    const response = await fetch(`${authServerUrl}/requests/${requestId}`)
    if (response.statusCode === 204) {
      // Result is not ready yet, wait a second
      await new Promise(resolve => setTimeout(resolve, 1000))
      continue
    }
    return await response.json()
  }
}
const outcome = await getResponse(requestId)
```

3. Get the `result` and the `sender` from the outcome message and do with them whatever is necessary.

### Authentication

Every request requires an `authChain` belonging to the wallet owner. The server validates its
signature and stores the recovered owner address as the request `sender`, which is returned on the
recover response. Requests without an `authChain` are rejected with `Auth chain is required`.

### What cannot be requested

Two things are refused, both when creating a request over the socket and over `POST /requests`:

1. **The `dcl_personal_sign` method**, in any casing — rejected with
   `The dcl_personal_sign method is not allowed`.
2. **Signing a Decentraland ephemeral message under any other method** — rejected with
   `Signing a Decentraland ephemeral message is not allowed`.

The second rule exists because blocking the method name alone would not be enough: the ephemeral
message is what actually mints an auth identity, so passing it to `personal_sign` or `eth_sign`
would reproduce the removed sign-in flow exactly. A request is refused when any of its string
params parses as an ephemeral message — that is, when it carries `Ephemeral address:` and
`Expiration:` lines — whether sent as plain text or hex-encoded. The greeting on the first line is
irrelevant, since any greeting yields a usable ephemeral auth link.

**Ordinary signing still works.** `personal_sign`, `eth_sign` and the `eth_signTypedData*` family
are all accepted for messages that are not ephemeral messages, alongside non-signing methods such
as `eth_sendTransaction`, `eth_call` and the `wallet_*` methods.
