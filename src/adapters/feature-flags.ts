import { ApplicationName } from '@well-known-components/features-component'
import { IBaseComponent, START_COMPONENT, STOP_COMPONENT } from '@well-known-components/interfaces'
import { AppComponents } from '../types'

const REFRESH_INTERVAL_MS = 5 * 60 * 1000 // 5 minutes

// ---------------------------------------------------------------------------
// Feature flag names — add new flags here
// ---------------------------------------------------------------------------
const FF_NUDGE_EMAILS = 'nudge-emails'

// ---------------------------------------------------------------------------
// Cached state for each flag
// ---------------------------------------------------------------------------
type FlagState = {
  enabled: boolean
  variant?: string
}

export type IFeatureFlagsAdapter = IBaseComponent & {
  /** Check if a specific feature flag is enabled. */
  isEnabled(flag: string): boolean
  /** Get the raw variant string for a flag, or undefined if no variant / flag off. */
  getVariant(flag: string): string | undefined

  // Convenience methods for nudge-emails
  isNudgeEmailEnabled(): boolean
  /** Returns the whitelist of emails, or undefined if all emails are allowed. */
  getNudgeEmailWhitelist(): string[] | undefined
}

export function createFeatureFlagsAdapter({ logs, features }: Pick<AppComponents, 'logs' | 'features'>): IFeatureFlagsAdapter {
  const logger = logs.getLogger('feature-flags')

  /** All flags to fetch on each refresh cycle. Add new flags to this array. */
  const TRACKED_FLAGS = [FF_NUDGE_EMAILS]

  const state = new Map<string, FlagState>()

  async function refreshFlag(flag: string): Promise<void> {
    const enabled = await features.getIsFeatureEnabled(ApplicationName.CORE, flag)
    let variant: string | undefined

    if (enabled) {
      const v = await features.getFeatureVariant(ApplicationName.CORE, flag)
      variant = v?.payload?.value || undefined
    }

    state.set(flag, { enabled, variant })
  }

  async function refresh(): Promise<void> {
    try {
      await Promise.all(TRACKED_FLAGS.map(refreshFlag))
      logger.info('Feature flags refreshed', {
        flags: TRACKED_FLAGS.map(f => {
          const s = state.get(f)
          return `${f}=${s?.enabled ? 'ON' : 'OFF'}${s?.variant ? `(${s.variant})` : ''}`
        }).join(', ')
      })
    } catch (error) {
      logger.error('Failed to refresh feature flags', {
        error: error instanceof Error ? error.message : String(error)
      })
    }
  }

  // Generic accessors
  const isEnabled = (flag: string): boolean => state.get(flag)?.enabled ?? false
  const getVariant = (flag: string): string | undefined => state.get(flag)?.variant

  // Nudge-emails convenience
  const isNudgeEmailEnabled = (): boolean => isEnabled(FF_NUDGE_EMAILS)

  const getNudgeEmailWhitelist = (): string[] | undefined => {
    const variant = getVariant(FF_NUDGE_EMAILS)
    if (!variant) return undefined
    return variant
      .split(',')
      .map(e => e.trim().toLowerCase())
      .filter(e => e.length > 0)
  }

  let interval: NodeJS.Timeout | null = null

  return {
    async [START_COMPONENT]() {
      await refresh()
      interval = setInterval(() => void refresh(), REFRESH_INTERVAL_MS)
      logger.info('Feature flags adapter started', { refreshIntervalMs: REFRESH_INTERVAL_MS })
    },
    async [STOP_COMPONENT]() {
      if (interval) {
        clearInterval(interval)
        interval = null
      }
    },
    isEnabled,
    getVariant,
    isNudgeEmailEnabled,
    getNudgeEmailWhitelist
  }
}
