import { IJobComponent } from '@dcl/job-component'

export type INudgeJobComponent = IJobComponent & {
  /**
   * Exposed for testing: runs the nudge evaluator manually without waiting for the schedule.
   */
  runEvaluator(): Promise<void>
}
