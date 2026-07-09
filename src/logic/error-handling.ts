export function isErrorWithMessage(error: unknown): error is Error {
  return (
    error !== undefined &&
    error !== null &&
    typeof error === 'object' &&
    'message' in error &&
    typeof (error as { message: unknown }).message === 'string'
  )
}
