import { createSignatureRpcProvider } from '@dcl/crypto-middleware'
import type { AuthChainProvider } from '@dcl/crypto-middleware'
import type { IConfigComponent } from '@well-known-components/interfaces'

export type IL1Provider = AuthChainProvider

/**
 * Creates the shared RPC provider for the network selected by deployment configuration.
 * Header, identity-body and socket validation all use this provider.
 * @param components Configuration supplying ETH_RPC_URL.
 * @param options Optional per-RPC timeout override.
 * @returns A provider supporting bounded and cancellable signature checks.
 */
export async function createL1Provider(
  { config }: { config: IConfigComponent },
  options: { timeoutInMilliseconds?: number } = {}
): Promise<IL1Provider> {
  return createSignatureRpcProvider(await config.requireString('ETH_RPC_URL'), options)
}
