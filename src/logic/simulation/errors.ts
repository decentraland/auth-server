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

/**
 * A log the simulator returned carries the signature of an effect this service reports (an approval, an
 * ERC721 transfer, an ERC1155 movement) but could not be decoded as one, so the effects cannot be reported
 * completely. Maps to HTTP 502, like an unusable upstream answer.
 */
export class UnreadableSimulationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UnreadableSimulationError'
  }
}
