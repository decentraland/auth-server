export function isErrorWithMessage(error: unknown): error is { message: string } {
  return (
    error !== undefined &&
    error !== null &&
    typeof error === 'object' &&
    'message' in error &&
    typeof (error as { message: unknown }).message === 'string'
  )
}
