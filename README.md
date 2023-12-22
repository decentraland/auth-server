# Auth Server

[![Coverage Status](https://coveralls.io/repos/github/decentraland/auth-server/badge.svg?branch=main)](https://coveralls.io/github/decentraland/auth-server?branch=main)

Server in charge of communication between the decentraland desktop client and the auth dapp on the browser.

Allows the desktop client to execute wallet methods (eth_sendTransaction, personal_sign, etc.) using the wallet the user has on their browser by leveraging the auth dapp.

## Requests

Requests are the main entity this server handles. Requests contain the wallet methods that the desktop client want to execute.

They are created on the auth server on demand by the desktop client. The server then provides a request id, which can then be used to recover that request on a browser (which in this case it is intended to be opened on the auth dapp).

On the auth dapp, the user can execute said request by using the connected wallet, and communicate the result back to the auth server, which in turn will communicate it back to the desktop client.

For example, if the desktop client need to send a transaction, it would create a transaction for the eth_sendTransaction method, and await for the result, which would be a transaction hash, to be returned after the flow is complete.

Some charactistics of requests are:

1. Only one request can exist at a time per connected socket. A new request will invalidate a previous one if it existed.
2. Requests have an expiration, and cannot be consumed after it.
3. If the socket disconnects, any request made by that socket will be deleted.

## Usage

This section will explain the ways in which the service can be used.

Use the web socket library of your choice to connect to this server (https://auth-api.decentraland.org). This one currently uses [Socket.IO](https://socket.io/) which can also be used in a JS client to connect.

The next example will show how a `personal_sign` can be requested by the desktop client.

1. The desktop client has to connect to the auth server through web sockets.

```ts
const socket = io('https://auth-api.decentraland.org')
```

2. The desktop client has to send a request message with the method information to the auth server, at the same time, start listening for the response.

```ts
const { requestId, expiration, code } = await socket.emitWithAck('request', {
  method: 'personal_sign',
  params: ['message to sign', 'signer address']
})
```

The expiration can be used to know when the request will become unnavailable if not consumed before a certain time.

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

### Authentication Flow

For the sign in flow in the desktop client. we will need to request a special method called `dcl_personal_sign`.

This methods works similarly to `personal_sign` but with a little difference.

For this example we'll be using `ethers v6` and `@dcl/crypto`

1. The desktop client will need to generate and store an epheremeral wallet.

```ts
const ephemeralAccount = ethers.Wallet.createRandom()
```

2. The desktop client has to set a date in which the identity that will be created, expires.

```ts
const expiration = new Date(Date.now() + 24 * 60 * 60 * 1000) // 1 day in the future as an example.
```

3. Generate the ephemeral message to be signed using the address of the ephemeral account and the expiration.

```ts
const ephemeralMessage = Authenticator.getEphemeralMessage(ephemeralAccount.address, expiration)
```

4. Follow the steps decribed on the [Usage](#usage) section, initializing the flow with the following message.

```ts
socket.emitWithAck('request', {
  method: 'dcl_personal_sign',
  params: [ephemeralMessage, code]
})
```

As you can see, there is a simple difference with the previous example. That is that personal_sign requires a second parameter that is the address that will sign the message. But we don't know it yet, so only the ephemeral message is sent. The auth dapp will fill the signing address for us.

If the signer is sent as a param in the request, the auth dapp will use that instead of using the one of the connected wallet, and execute it as a normal personal_sign.

5. Once the flow is complete, and the desktop client receives the outcome message. The `sender` and the `result` that come with it are necessary to create an auth identity, which will be used to authorize the user into the platform.

```ts
const signer = outcome.sender
const signature = outcome.result

const identity = {
  expiration,
  ephemeralIdentity: {
    address: ephemeralAccount.address,
    privateKey: ephemeralAccount.privateKey,
    publicKey: ephemeralAccount.publicKey
  },
  authChain: [
    {
      type: AuthLinkType.SIGNER,
      payload: signer,
      signature: ''
    },
    {
      type: signature.length === 132 ? AuthLinkType.ECDSA_PERSONAL_EPHEMERAL : AuthLinkType.ECDSA_EIP_1654_EPHEMERAL,
      payload: ephemeralMessage,
      signature: signature
    }
  ]
}
```
