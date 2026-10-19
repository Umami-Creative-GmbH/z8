/** The confirmation returns home on its own after about this long. */
export const KIOSK_CONFIRMATION_MS = 10_000;
/** A PIN pad or employee screen nobody touches returns home after this long. */
export const KIOSK_IDLE_MS = 30_000;
/** An online action (or outcome question) without an answer after this long is uncertain (#1363). */
export const KIOSK_ACTION_TIMEOUT_MS = 20_000;
/** The first question about an uncertain action waits this long (#1363). */
export const KIOSK_OUTCOME_FIRST_CHECK_MS = 3_000;
/** While Z8 cannot answer, the kiosk asks again this often (#1363). */
export const KIOSK_OUTCOME_RETRY_MS = 5_000;
