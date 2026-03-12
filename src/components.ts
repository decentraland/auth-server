import { createDotEnvConfigComponent } from '@well-known-components/env-config-provider'
import { createFeaturesComponent } from '@well-known-components/features-component'
import { createFetchComponent } from '@well-known-components/fetch-component'
import { createLogComponent } from '@well-known-components/logger'
import { createMetricsComponent } from '@well-known-components/metrics'
import { createTracerComponent } from '@well-known-components/tracer-component'
import { createInMemoryCacheComponent } from '@dcl/memory-cache-component'
import { createRedisComponent } from '@dcl/redis-component'
import { createSlackComponent } from '@dcl/slack-component'
import { createFeatureFlagsAdapter } from './adapters/feature-flags'
import { metricDeclarations } from './metrics'
import { createPgComponent } from './ports/db/component'
import { createEmailComponent } from './ports/email/component'
import { createNudgeJobComponent } from './ports/nudge-job/component'
import { createOnboardingComponent } from './ports/onboarding/component'
import { createServerComponent } from './ports/server/component'
import { createStorageComponent } from './ports/storage/component'
import { AppComponents } from './types'

// Initialize all the components of the app
export async function initComponents(): Promise<AppComponents> {
  const config = await createDotEnvConfigComponent({ path: ['.env.default', '.env'] })
  const requestExpirationInSeconds = await config.requireNumber('REQUEST_EXPIRATION_IN_SECONDS')
  const dclPersonalSignExpirationInSeconds = await config.requireNumber('DCL_PERSONAL_SIGN_REQUEST_EXPIRATION_IN_SECONDS')
  const tracer = await createTracerComponent()
  const logs = await createLogComponent({ tracer })
  const metrics = await createMetricsComponent(metricDeclarations, { config })
  const redisHostUrl = await config.getString('REDIS_HOST')
  const cache = redisHostUrl ? await createRedisComponent(redisHostUrl, { logs }) : createInMemoryCacheComponent()
  const db = await createPgComponent({ config, logs, metrics }, {})
  const storage = createStorageComponent({ cache })
  const fetch = createFetchComponent()
  const features = await createFeaturesComponent(
    { config, logs, fetch },
    (await config.getString('SERVICE_BASE_URL')) || 'https://auth-api.decentraland.org'
  )
  const featureFlags = createFeatureFlagsAdapter({ logs, features })
  const onboarding = createOnboardingComponent({ db, logs })
  const email = await createEmailComponent({ config, logs })
  const slackToken = await config.getString('SLACK_BOT_TOKEN')
  const slack = createSlackComponent({ logs }, { token: slackToken ?? '' })
  const nudgeJob = createNudgeJobComponent({ onboarding, email, slack, logs, config, featureFlags })
  const server = await createServerComponent({
    config,
    logs,
    metrics,
    onboarding,
    email,
    nudgeJob,
    storage,
    tracer,
    requestExpirationInSeconds,
    dclPersonalSignExpirationInSeconds
  })

  return {
    cache,
    config,
    fetch,
    features,
    featureFlags,
    nudgeJob,
    db,
    email,
    logs,
    metrics,
    onboarding,
    server,
    slack,
    storage,
    tracer
  }
}
