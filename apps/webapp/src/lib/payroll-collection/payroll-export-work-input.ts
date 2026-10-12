/**
 * Persisted immutable work input of one payroll export job (#322).
 *
 * The input is written with its job, before any delivery, and a recovery of that
 * job formats this input instead of collecting again. On every read the stored
 * digest must match both the row and a fresh digest of the stored facts, so a
 * recovery provably reuses exactly what was collected.
 */
import "server-only";

import { and, eq } from "drizzle-orm";
import type { db as database } from "@/db";
import { payrollExportWorkInput } from "@/db/schema";
import {
	type CollectedPayrollWorkInput,
	PAYROLL_WORK_INPUT_VERSION,
	payrollWorkInputDigest,
	type StoredPayrollWorkInput,
} from "./payroll-work-collection";

/** Versions a stored input may have: version 1 predates the frozen identifier (#821). */
const READABLE_VERSIONS: readonly number[] = [1, PAYROLL_WORK_INPUT_VERSION];

type Database = typeof database;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

export class PayrollExportWorkInputIntegrityError extends Error {
	constructor(readonly jobId: string) {
		super(`Stored payroll export work input failed its integrity check for job ${jobId}`);
		this.name = "PayrollExportWorkInputIntegrityError";
	}
}

export async function insertPayrollExportWorkInput(
	tx: Pick<Transaction, "insert">,
	jobId: string,
	input: CollectedPayrollWorkInput,
): Promise<void> {
	await tx.insert(payrollExportWorkInput).values({
		jobId,
		organizationId: input.organizationId,
		version: input.version,
		digest: input.digest,
		workCount: input.work.length,
		input,
	});
}

/**
 * The job's stored input, or `null` for a job collected without it. Version 1
 * input stays readable and recoverable: its digest covers what it stored.
 */
export async function readPayrollExportWorkInput(
	reader: Pick<Database, "select">,
	organizationId: string,
	jobId: string,
): Promise<StoredPayrollWorkInput | null> {
	const [row] = await reader
		.select({
			digest: payrollExportWorkInput.digest,
			version: payrollExportWorkInput.version,
			workCount: payrollExportWorkInput.workCount,
			input: payrollExportWorkInput.input,
		})
		.from(payrollExportWorkInput)
		.where(
			and(
				eq(payrollExportWorkInput.jobId, jobId),
				eq(payrollExportWorkInput.organizationId, organizationId),
			),
		)
		.limit(1);
	if (!row) return null;

	const input = row.input as StoredPayrollWorkInput;
	if (
		!READABLE_VERSIONS.includes(row.version) ||
		input.version !== row.version ||
		input.organizationId !== organizationId ||
		input.digest !== row.digest ||
		input.work.length !== row.workCount ||
		payrollWorkInputDigest(input) !== row.digest
	) {
		throw new PayrollExportWorkInputIntegrityError(jobId);
	}
	return input;
}
