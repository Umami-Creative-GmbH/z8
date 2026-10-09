/**
 * Dependency-free vocabulary of payslip batches (#868, CONTEXT.md "Payslip
 * batch"). The schema, server code and client components import it.
 */

/** A pay period as `2026-09`, the form the duplicate flag and notifications use. */
export function payPeriodCode(payPeriod: { year: number; month: number }): string {
	return `${payPeriod.year}-${String(payPeriod.month).padStart(2, "0")}`;
}

/** At most this many payslip files in one batch. */
export const PAYSLIP_BATCH_MAX_FILES = 500;

/** A ZIP of payslips may be at most this large (it is unpacked in the browser). */
export const PAYSLIP_BATCH_MAX_ZIP_BYTES = 500 * 1024 * 1024;

/** Payslips are PDF files. */
export const PAYSLIP_BATCH_MIME_TYPES = ["application/pdf"] as const;

export const PAYSLIP_BATCH_REFUSAL_MESSAGE = "A payslip batch takes PDF files only.";

export function isPayslipBatchMime(mime: string): boolean {
	return (PAYSLIP_BATCH_MIME_TYPES as readonly string[]).includes(mime.toLowerCase());
}

/**
 * `open`: files are being added and matched, nothing is saved yet.
 * `confirmed`: the officer confirmed; included files became employee
 * documents, and failed ones can be retried.
 */
export const PAYSLIP_BATCH_STATUSES = ["open", "confirmed"] as const;
export type PayslipBatchStatus = (typeof PAYSLIP_BATCH_STATUSES)[number];

/** How a staged file's name matched personnel numbers when it was added. */
export const PAYSLIP_MATCH_KINDS = ["matched", "unmatched", "ambiguous"] as const;
export type PayslipMatchKind = (typeof PAYSLIP_MATCH_KINDS)[number];

/** Why a file could not become an employee document on confirmation. */
export const PAYSLIP_FILE_FAILURES = [
	/** The staged file was cleaned up before the batch was confirmed. */
	"expired",
	/** The assigned employee is not (or no longer) in the officer's scope for payslips. */
	"out_of_scope",
	/** Anything else; retrying may help. */
	"error",
] as const;
export type PayslipFileFailure = (typeof PAYSLIP_FILE_FAILURES)[number];
