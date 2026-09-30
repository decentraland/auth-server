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
   * Reasons: `invalid_shape` and `cap_reached` are refused locally, before any call;
   * `upstream_status` is a non-2xx from the Catalyst, `invalid_response` an answer it should never
   * give (a peer on the wrong chain or not a Catalyst at all), `timeout` a call that hit the
   * deadline and `unreachable` one that never connected.
   *
   * `cap_reached` is the one to alert on: it means smart-account logins are being turned away by
   * this service's own concurrency cap, which the unauthenticated `POST /requests` and socket
   * `request` paths let anyone fill.
   */
  signature_validation_refused_total: {
    help: 'Number of on-chain signature validations that could not be settled, by reason',
    type: IMetricsComponent.CounterType,
    labelNames: ['reason']
  }
}

// type assertions
validateMetricsDeclaration(metricDeclarations)
