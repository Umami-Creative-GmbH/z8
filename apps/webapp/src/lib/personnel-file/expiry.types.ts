/**
 * Dependency-free vocabulary of expiry reminders (#869). The schema imports
 * it, so it must not import anything; `expiry.ts` re-exports it.
 */

export const EXPIRY_REMINDER_KINDS = ["upcoming", "expired_today"] as const;
export type ExpiryReminderKind = (typeof EXPIRY_REMINDER_KINDS)[number];
