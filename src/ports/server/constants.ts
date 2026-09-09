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
// Maximum allowed size, in bytes, of an incoming request body. Sized for `POST /simulations`: the auth
// dapp accepts calldata up to 96 KiB (196,608 hex characters) plus the appended meta-transaction sender
// and the JSON envelope, about 197 KB, and refuses to review anything larger precisely so that every
// request it forwards here can be previewed. A cap below that turned legitimate large calls, such as a
// batch transfer of a few hundred tokens, into a 413 the dapp read as "preview unavailable". Every other
// route carries its own, much smaller, schema limits.
export const MAX_BODY_SIZE_BYTES = 256 * 1024
