# AI Agent Context

**Service Purpose:**

Authentication broker between Decentraland clients (web apps, games) and the Decentraland auth dapp. Clients create authentication requests representing wallet actions they want the user to authorize. The auth dapp picks up those requests, executes the wallet action, and submits the outcome. Clients poll until the outcome is available. The service also manages short-lived `AuthIdentity` objects that allow clients to authenticate subsequent HTTP requests to other Decentraland services without repeated wallet interaction.

---

## Key Capabilities

- Create and manage authentication request lifecycle (create → recover → submit outcome → poll)
- Ephemeral identity creation and one-time retrieval
- Optional validation notification flow for flows requiring extra user confirmation before proceeding
- Auth chain signature validation via `@dcl/crypto`
- IP-based identity access control (prevents identity theft across different IPs)

---

## Communication Pattern

HTTP REST API only (polling-based). WebSocket/Socket.IO was removed in a previous version — see `docs/requests.md` for the migration guide and polling flow examples.

---

## Technology Stack

- Runtime: Node.js
- Language: TypeScript
- HTTP framework: `@dcl/http-server` (Well-Known Components / WKC)
- Architecture: WKC component factory pattern — all logic lives in `createXxxComponent` functions under `src/logic/`
- Cache: `@dcl/redis-component` (production), `@dcl/memory-cache-component` (tests/local)
- Auth middleware: `decentraland-crypto-middleware` — validates that HTTP requests are signed with a valid Decentraland auth chain
- Crypto: `@dcl/crypto` — `Authenticator.validateSignature`, `parseEmphemeralPayload`
- Validation: `ajv` + `ajv-formats`
- ID generation: `uuid` v4

---

## External Dependencies

- **Redis**: All request and identity storage. Keys are TTL-backed to match the entity's `expiration` field. No persistent database.

---

## Code Layout

```
src/
  controllers/
    handlers/
      identity-handlers/   # create-identity, get-identity, identity-error-handler
      request-handlers/    # create-request, get-request, get-request-outcome,
                           # get-validation-status, notify-validation, submit-outcome
    types.ts               # HandlerContextWithPath<ComponentNames, Path>
  logic/
    auth-chain.ts          # createAuthChainComponent — validateAuthChain
    errors.ts              # Domain error classes
    identity-operations.ts # createIdentityOperationsComponent
    ip.ts                  # createIpUtilsComponent
    request-operations.ts  # createRequestOperationsComponent
    validations.ts         # validateRequestMessage, validateHttpOutcomeMessage, validateIdentityRequest
  ports/
    server/
      types.ts             # HTTP message shapes (Request, Outcome, Identity, etc.)
      constants.ts         # METHOD_DCL_PERSONAL_SIGN, expiration limits, validation limits
    storage/
      types.ts             # IStorageComponent, StorageRequest, StorageIdentity
      component.ts         # createStorageComponent — cache-backed implementation
  types/
    components.ts          # BaseComponents, AppComponents, all component interfaces
```

---

## Key Concepts

### Request lifecycle

1. Client POSTs `POST /requests` with `{ method, params, authChain? }`.
2. Server validates the auth chain (unless `dcl_personal_sign` — see below), generates a UUID `requestId`, a random `code` (0–99), and stores a `StorageRequest` with a TTL matching `expiration`.
3. Server returns `{ requestId, expiration, code }`.
4. Auth dapp GETs `GET /v2/requests/:requestId` to recover the request details (`method`, `params`, `code`, `expiration`, `sender?`).
5. Auth dapp executes the wallet action and POSTs `POST /v2/requests/:requestId/outcome` with `{ sender, result?, error? }`.
6. Client polls `GET /requests/:requestId`:
   - `204` — outcome not yet available, keep polling
   - `200` — outcome is ready, body is `{ requestId, sender, result?, error? }`; request is marked as fulfilled
   - `404` — request not found or has expired
   - `410` — request expired or already fulfilled (consumed)

The `code` field is a random number shown in the auth dapp UI so the user can verify they are authorizing the exact request initiated by the client (anti-phishing display code).

### Fulfilled request pattern

When the client polls and receives `200`, the server immediately marks the request as `fulfilled: true` in storage (a tombstone record). Any subsequent poll returns `410`. This ensures outcomes are consumed exactly once and cannot be replayed.

`toFulfilledRequestRecord` builds the tombstone: `{ requestId, fulfilled: true, expiration, code: 0, method: '', params: [], requiresValidation: false }`.

### `dcl_personal_sign` flow

Special method where the auth chain is **not** pre-validated at request creation time. The request only carries an ephemeral wallet message (`params: [ephemeralMessage]`). The auth dapp signs it with the user's wallet and submits the outcome. The client uses `{ sender, result }` from the outcome to build an `AuthIdentity` locally. That identity can then be stored in the auth server via `POST /identities` to enable signed requests to other Decentraland services.

For `dcl_personal_sign` the request expiration is longer (configured via `DCL_PERSONAL_SIGN_REQUEST_EXPIRATION_IN_SECONDS`, distinct from `REQUEST_EXPIRATION_IN_SECONDS`).

### Identity lifecycle

An `AuthIdentity` allows a client to sign HTTP requests to other Decentraland services (via `decentraland-crypto-middleware`) without re-signing with the main wallet on every call. The auth server provides short-term storage and one-time retrieval of these identities.

1. Client POSTs `POST /identities` with `{ identity: AuthIdentity, isMobile?: boolean }`.
2. Server validates the auth chain inside the `AuthIdentity` (see Identity validation below).
3. Server stores a `StorageIdentity` (15-minute TTL) and returns `{ identityId, expiration }`.
4. The auth dapp (or any trusted consumer) GETs `GET /identities/:identityId` to retrieve the identity.
5. On successful retrieval, **the identity is deleted immediately** (one-time use). If retrieval fails (IP mismatch, expired), it is also deleted.

Identities are **one-time use** by design. The consumer must fetch them before expiration and must originate from the same IP (unless mobile).

### Identity validation during creation (`validateIdentityChain`)

When creating an identity, three assertions are made in sequence (all throw domain errors on failure):

1. **`assertEphemeralAddressMatchesFinalAuthority`** — the `ephemeralIdentity.address` inside the submitted `AuthIdentity` must match the `finalAuthority` derived from the auth chain's ephemeral link. Throws `EphemeralAddressMismatchError` → HTTP 403.
2. **`assertRequestSenderMatchesIdentityOwner`** — if the HTTP request was signed with `decentraland-crypto-middleware`, the `verification.auth` sender must match the auth chain owner. Throws `RequestSenderMismatchError` → HTTP 403.
3. **`assertEphemeralPrivateKeyMatchesAddress`** — derives the address from `ephemeralIdentity.privateKey` using `ethers.Wallet` and verifies it matches `ephemeralIdentity.address`. This prevents submitting a valid-looking identity with a mismatched private key. Throws `EphemeralPrivateKeyMismatchError` → HTTP 403.

### Auth chain validation (`validateAuthChain`)

Used in `createRequestHandler` (for all methods except `dcl_personal_sign`) and `createIdentityHandler`.

1. Extracts `sender` via `Authenticator.ownerAddress(authChain)`.
2. Finds the ephemeral link in the chain (type `ECDSA_PERSONAL_EPHEMERAL` or `ECDSA_EIP_1654_EPHEMERAL`).
3. Parses `finalAuthority` from the ephemeral link's payload via `parseEmphemeralPayload`.
4. Calls `Authenticator.validateSignature(finalAuthority, authChain, null)`.
5. If `validationResult.ok === false` and the message contains `'Ephemeral key expired'`, throws `EphemeralKeyExpiredError`. Otherwise throws a generic error with the validation message.
6. Returns `{ sender, finalAuthority }`.

> **Important**: `parseEmphemeralPayload` does NOT throw for expired keys. Expiration is only detected inside `validateSignature`'s result message. Do not add a try/catch around `parseEmphemeralPayload` expecting it to throw on expiry.

### Domain errors (`src/logic/errors.ts`)

All are plain `Error` subclasses with a `.name` property:

| Error                              | When                                                      | HTTP |
| ---------------------------------- | --------------------------------------------------------- | ---- |
| `EphemeralKeyExpiredError`         | Auth chain ephemeral key has expired                      | 401  |
| `EphemeralAddressMismatchError`    | `ephemeralIdentity.address` ≠ auth chain `finalAuthority` | 403  |
| `RequestSenderMismatchError`       | HTTP request signer ≠ auth chain owner                    | 403  |
| `EphemeralPrivateKeyMismatchError` | Private key doesn't derive to the provided address        | 403  |

These are mapped to HTTP responses in `identity-error-handler.ts` (`handleIdentityValidationError`).

### IP access control for identities

When `GET /identities/:identityId` is called:

- The request IP is extracted via `ipUtils.getIpHeaders` + `ipUtils.getClientIp`.
- It is compared to `identity.ipAddress` (stored at creation time) using `ipUtils.ipsMatch`.
- If `identity.isMobile === true`: IP mismatch is **allowed** (logged as a warning but proceeds). Mobile networks frequently change IPs.
- If `identity.isMobile === false`: IP mismatch → identity is deleted and HTTP 403 is returned.

IPv4 and IPv6 representations of the same address are treated as a match (normalized by `normalizeIp`).

### Validation notification flow

For flows where the auth dapp needs to signal the client that additional validation is required before proceeding:

1. Auth dapp POSTs `POST /v2/requests/:requestId/validation` → sets `request.requiresValidation = true` in storage.
2. Client polls `GET /v2/requests/:requestId/validation` → returns `{ requiresValidation: boolean }`.

### Storage pattern

- All storage uses a TTL-backed cache keyed by `request:<id>` and `identity:<id>`.
- TTL is computed as seconds until the entity's `expiration` field (minimum 1 second).
- **Explicit deletion** (`deleteRequest`, `deleteIdentity`) is used for early removal (expiration detected in handler logic, IP mismatch, fulfilled tombstone already stored).
- `setRequest` / `setIdentity` never accept `null` — use the delete methods instead.
- Dates are serialized as strings in Redis and deserialized back with `toDate()` in the component.

### WKC component pattern

- Components are created via `createXxxComponent({ dep1, dep2 }: Pick<AppComponents, ...>)`.
- All internal helpers live **inside** the factory function, not at module level.
- Component interfaces are defined in `src/types/components.ts`.
- Handlers declare their dependencies via `HandlerContextWithPath<'component1' | 'component2', '/path/:param'>`.
- Path params are typed as `string` (via `ParseUrlParams` from `typed-url-params`) — no runtime extraction helper needed.

### `decentraland-crypto-middleware`

Validates that incoming HTTP requests carry a valid Decentraland auth chain signature in the `x-identity-auth-chain-*` headers. When present and valid, it populates `context.verification.auth` with the signer's Ethereum address. Used in `createIdentityHandler` to enforce `assertRequestSenderMatchesIdentityOwner`.