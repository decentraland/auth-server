import { IMetricsComponent } from '@well-known-components/interfaces'
import { metricDeclarations as logsMetricsDeclarations } from '@well-known-components/logger'
import { getDefaultHttpMetrics } from '@dcl/http-server'
import { validateMetricsDeclaration } from '@dcl/metrics'

export const metricDeclarations = {
  ...getDefaultHttpMetrics(),
  ...logsMetricsDeclarations,
  /**
   * On-chain signature validations that did not get a verdict from the Catalyst, by reason. A
   * signature the Catalyst genuinely rejects is not counted — that is a working validation.
   *
   * Labelled by `pool` (`authenticated` for the login handoff, `anonymous` for `POST /requests` and
   * the socket, `signed_fetch` for the signed-fetch middleware's own checks) and by `reason`. `invalid_shape`, `cap_reached` (the pool is full) and
   * `client_cap_reached` (one client holds its share of the pool) are refused locally, before any
   * call;
   * `upstream_status` is a non-2xx from the Catalyst, `invalid_response` an answer it should never
   * give (a peer on the wrong chain or not a Catalyst at all), `timeout` a call that hit the
   * deadline and `unreachable` one that never connected.
   *
   * `cap_reached` is the one to alert on: it means smart-account validations are being turned away
   * by this service's own concurrency cap. On `pool="anonymous"` that is someone filling the
   * unauthenticated paths; on `pool="authenticated"` it is the login handoff itself.
   */
  signature_validation_refused_total: {
    help: 'Number of on-chain signature validations that could not be settled, by reason',
    type: IMetricsComponent.CounterType,
    labelNames: ['reason', 'pool']
  }
}

// type assertions
validateMetricsDeclaration(metricDeclarations)
