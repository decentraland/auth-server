export type IIdentityVerifierComponent = {
  /**
   * Checks the verifier a client presents when retrieving an identity against the `authRequestId` the
   * identity was created with. The client derives that UUID v4 from SHA-256 of the verifier, so only the
   * client that started the login can present it.
   *
   * @param authRequestId - The `authRequestId` stored with the identity, if any.
   * @param verifier - The `x-identity-verifier` request header, if any. An empty value counts as missing.
   * @returns true when the verifier matches, so the caller can skip the IP check; false when no verifier
   *   applies (the identity has no `authRequestId`, or none was sent while not required), so the caller
   *   keeps the IP check.
   * @throws InvalidIdentityVerifierError when the verifier does not match, or is missing while
   *   `REQUIRE_IDENTITY_VERIFIER` is enabled.
   */
  verifyRetrieval(authRequestId: string | undefined, verifier: string | null): boolean
}
