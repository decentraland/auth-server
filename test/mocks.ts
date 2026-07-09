// Lightweight, framework-only test mock factories shared by unit and integration specs.
// Kept free of the runner/service wiring in `components.ts` so unit specs can import them
// without booting the whole program.
import { ILoggerComponent } from '@well-known-components/interfaces'
import { IPgComponent } from '../src/ports/db/types'

/** Logger whose every level is a `jest.fn()`; `getLogger` always returns the same instance. */
export function createMockLogs(): ILoggerComponent {
  const logger = { log: jest.fn(), error: jest.fn(), debug: jest.fn(), warn: jest.fn(), info: jest.fn() }
  return { getLogger: () => logger } as unknown as ILoggerComponent
}

/**
 * No-op pg component whose `query` resolves to an empty result set by default. The `query`
 * mock is exposed as a `jest.Mock` so specs can set per-case return values.
 */
export function createMockDbComponent(): jest.Mocked<Pick<IPgComponent, 'query'>> & IPgComponent {
  return {
    query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0, notices: [] }),
    getPool: jest.fn(),
    withTransaction: jest.fn(),
    start: jest.fn().mockResolvedValue(undefined),
    stop: jest.fn().mockResolvedValue(undefined)
  } as unknown as jest.Mocked<Pick<IPgComponent, 'query'>> & IPgComponent
}
