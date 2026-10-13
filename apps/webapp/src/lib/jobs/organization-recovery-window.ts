/**
 * How long a soft-deleted organization can be recovered: organization-cleanup
 * deletes it for good after this, and the deletion email names that date.
 */
export const ORGANIZATION_RECOVERY_WINDOW_HOURS = 5 * 24;
