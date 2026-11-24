export const ONE_HOUR_IN_MILLISECONDS = 60 * 60 * 1000

/**
 * Methods that can never be requested. `dcl_personal_sign` drove the sign-in flow this service no
 * longer supports. Ordinary signing methods stay available — a request that tries to reproduce the
 * flow under one of those names is rejected by its payload instead, see `isEphemeralMessage`.
 *
 * Refusing it does not strand the explorers or the creator hub: sign-in now goes through the
 * identity endpoints instead of this relay. The auth dapp builds the whole auth identity itself and
 * `POST /identities` stores it (validating the chain and that the ephemeral address matches its
 * final authority), then the client collects it with `GET /identities/:id`. No ephemeral message is
 * relayed as a wallet method any more, so there is no `dcl_personal_sign` request left to serve.
 */
export const DISALLOWED_METHODS = new Set(['dcl_personal_sign'])

// Max length constants for request/outcome validation
export const MAX_METHOD_LENGTH = 256
export const MAX_PARAMS_ITEMS = 10
export const MAX_ERROR_MESSAGE_LENGTH = 10024
export const MAX_REQUEST_ID_LENGTH = 36 // UUID length
// Maximum allowed size, in bytes, of an incoming request body or socket message (16 KiB). Everything
// is held to it except a signing request, which gets MAX_REQUEST_MESSAGE_SIZE_BYTES.
export const MAX_BODY_SIZE_BYTES = 16 * 1024
/**
 * Maximum size, in bytes, of a signing request: the socket's `request` message or the body of
 * `POST /requests` (64 KiB). A typed-data request carries the transaction it signs, calldata
 * included, so it can be far larger than any other message this service takes: a NAME claim paid
 * with Credits wraps a bridge route of several KB and its `eth_signTypedData_v4` request is about
 * 17 KB. socket.io has one buffer for every message on a connection and closes the connection on a
 * larger one without running any handler, so this is also the socket's buffer size; every other
 * socket message is checked against MAX_BODY_SIZE_BYTES before its handler runs.
 */
export const MAX_REQUEST_MESSAGE_SIZE_BYTES = 64 * 1024
/**
 * Maximum size, in bytes, of a request's `params` once serialized to JSON (48 KiB). It sits below
 * MAX_REQUEST_MESSAGE_SIZE_BYTES, leaving room for the method, the auth chain and the transport's
 * framing, so a request that is too large but still reaches the handler is answered with an error
 * instead of being dropped.
 */
export const MAX_REQUEST_PARAMS_SIZE_BYTES = 48 * 1024
