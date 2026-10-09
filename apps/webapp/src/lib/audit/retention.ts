/**
 * How long audit records are kept before the `old_audit_logs` cleanup deletes
 * them. Records that follow the audit-log lifetime (the position stamp access
 * log, consents and declines; spec #766) use the same value, and migration 0145
 * hard-codes it in the access log's delete guard.
 */
export const AUDIT_LOG_RETENTION_DAYS = 365;
