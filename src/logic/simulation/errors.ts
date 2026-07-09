/**
 * The requested `chainId` is not in the configured list of supported chains.
 * Maps to HTTP 400.
 */
export class UnsupportedChainError extends Error {
  constructor(chainId: number) {
    super(`Unsupported chain id: ${chainId}`)
    this.name = 'UnsupportedChainError'
  }
}

/**
 * The simulation parameters were malformed (e.g. `value` is not a valid hex or
 * decimal integer). Maps to HTTP 400.
 */
export class InvalidSimulationParamsError extends Error {
  constructor(message = 'Invalid simulation parameters') {
    super(message)
    this.name = 'InvalidSimulationParamsError'
  }
}
