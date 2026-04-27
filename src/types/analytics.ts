export enum AnalyticsEvent {
  NUDGE_EMAIL_SENT = 'NUDGE_EMAIL_SENT',
  NUDGE_EMAIL_FAILED = 'NUDGE_EMAIL_FAILED'
}

export type AnalyticsEventPayload = {
  [AnalyticsEvent.NUDGE_EMAIL_SENT]: {
    user_id: string
    email: string
    checkpoint: number
    sequence: 1 | 2
    template_id: string
    sendgrid_message_id?: string
    sent_at: string
  }
  [AnalyticsEvent.NUDGE_EMAIL_FAILED]: {
    user_id: string
    email: string
    checkpoint: number
    sequence: 1 | 2
    template_id: string
    error: string
    failed_at: string
  }
}
