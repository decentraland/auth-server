export enum AnalyticsEvent {
  NUDGE_EMAIL_SENT = 'NUDGE_EMAIL_SENT',
  NUDGE_EMAIL_FAILED = 'NUDGE_EMAIL_FAILED'
}

/**
 * `checkpoint` is intentionally absent from these payloads — the only
 * checkpoint that triggers nudges is CP2, so emitting it would carry no
 * signal. If a second nudge target is added in the future, reintroduce it.
 */
export type AnalyticsEventPayload = {
  [AnalyticsEvent.NUDGE_EMAIL_SENT]: {
    user_id: string
    email: string
    sequence: 1 | 2
    template_id: string
    sendgrid_message_id: string
    sent_at: string
  }
  [AnalyticsEvent.NUDGE_EMAIL_FAILED]: {
    user_id: string
    email: string
    sequence: 1 | 2
    template_id: string
    error: string
    failed_at: string
  }
}
