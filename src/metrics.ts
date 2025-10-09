import { IMetricsComponent } from '@well-known-components/interfaces'
import { metricDeclarations as logsMetricsDeclarations } from '@well-known-components/logger'
import { getDefaultHttpMetrics, validateMetricsDeclaration } from '@well-known-components/metrics'

export const metricDeclarations = {
  ...getDefaultHttpMetrics(),
  ...logsMetricsDeclarations,
  test_ping_counter: {
    help: 'Count calls to ping',
    type: IMetricsComponent.CounterType,
    labelNames: ['pathname']
  },
  ip_extraction_total: {
    help: 'Total IP extraction attempts',
    type: IMetricsComponent.CounterType,
    labelNames: ['method', 'result']
  },
  ip_validation_total: {
    help: 'Total IP validation attempts',
    type: IMetricsComponent.CounterType,
    labelNames: ['result', 'reason']
  }
}

// type assertions
validateMetricsDeclaration(metricDeclarations)
