/**
 * Reimbursement channels (#849): how an organization pays its reimbursements.
 * Kept free of imports, since the database schema references them.
 */

export const REIMBURSEMENT_CHANNELS = ["bank_transfer", "payroll_run"] as const;
export type ReimbursementChannel = (typeof REIMBURSEMENT_CHANNELS)[number];

/** Today's behavior, and the channel of every organization that never chose one. */
export const DEFAULT_REIMBURSEMENT_CHANNEL: ReimbursementChannel = "bank_transfer";

export function isReimbursementChannel(value: unknown): value is ReimbursementChannel {
	return REIMBURSEMENT_CHANNELS.some((channel) => channel === value);
}
