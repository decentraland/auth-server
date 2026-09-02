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
// How old a signed request message may be before it is refused, matching the signed-fetch window.
export const REQUEST_SIGNATURE_MAX_AGE_MS = 60 * 1000
// Signed-fetch metadata key carrying the keccak256 of the raw request body; all lowercase so the payload folds to itself.
export const SIGNED_BODY_HASH_METADATA_KEY = 'bodyhash'
// Maximum allowed size, in bytes, of an incoming request body (16 KiB).
export const MAX_BODY_SIZE_BYTES = 16 * 1024
