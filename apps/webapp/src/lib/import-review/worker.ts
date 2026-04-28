import type { Job } from "bullmq";
import type { JobResult } from "@/lib/queue";
import { scanClockinImportPartition } from "./clockin-adapter";
import { scanClockodoImportPartition } from "./clockodo-adapter";
import { commitAcceptedRowsForEntity } from "./committers";
import { updateImportBatchJob } from "./repository";
import type { ImportCommitJobData, ImportScanJobData } from "./types";

type ImportReviewJobData = ImportScanJobData | ImportCommitJobData;

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

	try {
		await markRunning(data);

		if (data.type === "import-review-scan") {
			const processedRows =
				data.provider === "clockin"
					? await scanClockinImportPartition(data)
					: await scanClockodoImportPartition(data);

			await markCompleted(data, processedRows);
			return {
				success: true,
				message: "Import review scan completed",
				data: { processedRows },
			};
		}

		const committedRows = await commitAcceptedRowsForEntity(data);
		await markCompleted(data, committedRows);
		return {
			success: true,
			message: "Import review commit completed",
			data: { committedRows },
		};
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error);
		await markFailed(data, errorMessage);
		return { success: false, error: errorMessage };
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
