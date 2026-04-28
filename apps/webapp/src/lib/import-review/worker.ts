import type { Job } from "bullmq";
import type { JobResult } from "@/lib/queue";
import { scanClockinImportPartition } from "./clockin-adapter";
import { scanClockodoImportPartition } from "./clockodo-adapter";
import { commitAcceptedRowsForEntity } from "./committers";
import { updateImportBatchJob } from "./repository";
import type { ImportCommitJobData, ImportScanJobData } from "./types";

type ImportReviewJobData = ImportScanJobData | ImportCommitJobData;

interface ImportScanResult {
	stagedRows: number;
	issues: number;
}

function formatCommitRowFailure(result: {
	failedRows: number;
	errors: Array<{ rowId: string; message: string }>;
}) {
	const details = result.errors.map((error) => `${error.rowId}: ${error.message}`).join("; ");
	return `Import review commit failed for ${result.failedRows} row(s)${details ? `: ${details}` : ""}`;
}

function isFinalAttempt(job: Job<ImportReviewJobData>): boolean {
	const maxAttempts = typeof job.opts.attempts === "number" && job.opts.attempts > 0 ? job.opts.attempts : 1;
	return job.attemptsMade + 1 >= maxAttempts;
}

async function markRunning(data: ImportReviewJobData) {
	await updateImportBatchJob({
		jobId: data.jobId,
		organizationId: data.organizationId,
		status: "running",
		errorMessage: null,
	});
}

async function markCompleted(data: ImportReviewJobData, processedRows: number) {
	await updateImportBatchJob({
		jobId: data.jobId,
		organizationId: data.organizationId,
		status: "completed",
		processedRows,
		errorMessage: null,
	});
}

async function markFailed(data: ImportReviewJobData, errorMessage: string) {
	await updateImportBatchJob({
		jobId: data.jobId,
		organizationId: data.organizationId,
		status: "failed",
		errorMessage: errorMessage,
	});
}

export async function processImportReviewJob(job: Job<ImportReviewJobData>): Promise<JobResult> {
	const { data } = job;
	let failureAlreadyMarked = false;

	try {
		await markRunning(data);

		switch (data.type) {
			case "import-review-scan": {
				let scanResult: ImportScanResult;
				switch (data.provider) {
					case "clockin":
						scanResult = await scanClockinImportPartition(data);
						break;
					case "clockodo":
						scanResult = await scanClockodoImportPartition(data);
						break;
					default:
						throw new Error(`Unsupported import review provider: ${String(data.provider)}`);
				}

				await markCompleted(data, scanResult.stagedRows);
				return {
					success: true,
					message: "Import review scan completed",
					data: scanResult,
				};
			}

			case "import-review-commit": {
				const finalAttempt = isFinalAttempt(job);
				const commitResult = await commitAcceptedRowsForEntity(data, { finalAttempt });
				if (commitResult.failedRows > 0) {
					const errorMessage = formatCommitRowFailure(commitResult);
					if (finalAttempt) {
						await markFailed(data, errorMessage);
						failureAlreadyMarked = true;
					}
					throw new Error(errorMessage);
				}
				const { committedRows } = commitResult;
				await markCompleted(data, committedRows);
				return {
					success: true,
					message: "Import review commit completed",
					data: { committedRows },
				};
			}

			default:
				throw new Error(`Unsupported import review job type: ${String((data as { type?: unknown }).type)}`);
		}
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error);
		if (!failureAlreadyMarked && isFinalAttempt(job)) await markFailed(data, errorMessage);
		throw error;
	}
}

export async function processImportReviewScanJob(
	job: Job<ImportScanJobData>,
): Promise<JobResult> {
	return processImportReviewJob(job);
}

export async function processImportReviewCommitJob(
	job: Job<ImportCommitJobData>,
): Promise<JobResult> {
	return processImportReviewJob(job);
}
