export const ONE_HOUR_IN_MILLISECONDS = 60 * 60 * 1000

/**
 * Methods that can never be requested. `dcl_personal_sign` drove the sign-in flow this service no
 * longer supports. Ordinary signing methods stay available — a request that tries to reproduce the
 * flow under one of those names is rejected by its payload instead, see `isEphemeralMessage`.
 */
export const DISALLOWED_METHODS = new Set(['dcl_personal_sign'])

// Max length constants for request/outcome validation
export const MAX_METHOD_LENGTH = 256
export const MAX_PARAMS_ITEMS = 10
export const MAX_ERROR_MESSAGE_LENGTH = 10024
export const MAX_REQUEST_ID_LENGTH = 36 // UUID length
// Maximum allowed size, in bytes, of an incoming request body (16 KiB).
export const MAX_BODY_SIZE_BYTES = 16 * 1024
