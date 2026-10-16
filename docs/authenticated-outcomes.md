# Authenticated outcome submissions (v1)

Both `POST /v2/requests/:requestId/outcome` and the socket `outcome` event require
`sender`, exactly one of `result` or `error`, `expiresAt` (Unix milliseconds), and
`authChain`. Socket messages additionally require `requestId`. An HTTP body may
include it, but it must match the URL.

## Signing

1. Construct `{ requestId, sender, expiresAt, result }` or
   `{ requestId, sender, expiresAt, error }` using JSON-serializable values.
2. Serialize JSON recursively with object keys sorted lexicographically by UTF-16
   code units. Preserve array order, string case, and ECMAScript JSON primitive
   serialization. Do not lowercase the payload. Maximum nesting depth is 64.
3. Prefix the serialization with the literal `decentraland-auth-outcome-v1` and
   one newline.
4. Call `Authenticator.signPayload(identity, payload)` with the existing delegated
   identity. Send the returned public auth chain alongside the outcome fields.
   Never send `ephemeralIdentity` or private keys.

Use `expiresAt = Date.now() + 60000`. The server requires a future timestamp no
more than 65 seconds ahead (five seconds of clock tolerance), a currently valid
delegation, and an active, unexpired request. The chain owner and outcome sender
must both match the request's stored sender. Requests without a stored sender are
not eligible for outcome submission.

Protocol conformance vector (one newline after the prefix):

```text
decentraland-auth-outcome-v1
{"expiresAt":123,"requestId":"r","result":{"a":{"token":"Token"},"z":["CaseSensitive",2]},"sender":"s"}
```

The proof is consumed by Auth Server; outgoing outcome messages retain their
existing shape without `authChain` or `expiresAt`.
Polling an available outcome is now non-consuming: repeated reads return the same
answer until request expiration. A caller who knows the request ID cannot consume
the result before its intended requester reads it. This does not make request IDs
or result polling confidential.

## Concurrency and failure behavior

After signature verification, storage atomically claims a per-request outcome
key in the shared cache, with one attempt and a lifetime covering the request.
It rechecks request state/expiration, then persists the outcome in a separate
write-once cache entry **before** emitting it to the requester. Stale request
updates cannot erase the outcome. Configure shared Redis for multi-worker
deployments; the in-memory cache is only suitable for a single process.

The claim is intentionally never released, including on an uncertain storage
failure. A worker crash between claiming and persisting may leave the request
unanswered until it expires. Retrying cannot replace an answer whose first write
may have succeeded. This is single-writer reservation, not a database transaction
or a guarantee of exactly-once wallet execution.

The currently locked Redis component interprets its lock TTL as seconds despite
the interface naming milliseconds, so claim keys may live longer than requests.
Request/proof expiration is checked separately; this does not extend acceptance.
Account for this temporary-key retention when sizing Redis.

## Rollout and trust boundary

This is a breaking change for outcome **submitters**, including socket clients.
Deploy the Auth client and server in a coordinated rollout; old servers reject
the new fields and the new server rejects unsigned submissions. Let in-flight
requests drain or require clients to refresh during rollout. Do not add an
unsigned fallback. Request creation, recovery, and result consumers keep their
existing protocol.

Holders of the same delegated private key can also sign outcomes. These signatures
prove authorization by that identity, not that someone clicked Approve in Auth.
A signed transaction hash is not payment proof: consumers must independently
verify chain, transaction/receipt, destination, amounts, and execution success.

The outcome claim happens after wallet execution and does not prevent two browser
tabs from separately executing a request. Pre-execution idempotency is a separate
fix.
