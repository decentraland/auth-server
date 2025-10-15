import { IMetricsComponent } from '@well-known-components/interfaces'
import { metricDeclarations as logsMetricsDeclarations } from '@well-known-components/logger'
import { getDefaultHttpMetrics, validateMetricsDeclaration } from '@well-known-components/metrics'

export const metricDeclarations = {
  ...getDefaultHttpMetrics(),
  ...logsMetricsDeclarations,
  ip_extraction_total: {
    help: 'Total IP extraction attempts',
    type: IMetricsComponent.CounterType,
    labelNames: ['method', 'result']
    // Cardinality: 2 (method) × 2 (result) = 4 time series
    // method: 'http' | 'websocket'
    // result: 'success' | 'failed'
  },
  ip_validation_total: {
    help: 'Total IP validation attempts',
    type: IMetricsComponent.CounterType,
    labelNames: ['result', 'reason']
    // Cardinality: 2 (result) × 3 (reason) = 6 time series
    // result: 'success' | 'failed'
    // reason: 'valid' | 'ip_mismatch' | 'current_ip_unknown'
  }
}

// type assertions
validateMetricsDeclaration(metricDeclarations)
