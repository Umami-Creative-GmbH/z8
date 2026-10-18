"use server";

import { z } from "zod";
import { CSV_WORK_MAX_BYTES } from "@/lib/import-review/csv-work-format";
import {
	createCsvWorkImport,
	decideCsvWorkRows,
	mapCsvWorkValue,
	prepareCsvWorkCommit,
	refreshCsvWorkImport,
} from "@/lib/import-review/csv-work-import";
import {
	enqueueImportCommitJob,
	enqueueImportScanJob,
} from "@/lib/import-review/queue";
import { updateImportBatchStatus } from "@/lib/import-review/repository";
import { requireImportAdmin } from "./review-actions";

const uploadSchema = z.strictObject({
	organizationId: z.string().min(1).max(128),
	csv: z.string().min(1).max(CSV_WORK_MAX_BYTES),
	timezone: z.string().max(100).optional(),
	fileName: z.string().min(1).max(200),
});

export async function uploadCsvWorkAction(input: unknown) {
	try {
		const values = uploadSchema.parse(input);
		const auth = await requireImportAdmin(values.organizationId);
		const created = await createCsvWorkImport({
			...values,
			actorUserId: auth.user.id,
		});
		try {
			await enqueueImportScanJob(created.scanJob);
		} catch {
			await updateImportBatchStatus({
				organizationId: values.organizationId,
				batchId: created.batchId,
				status: "scan_failed",
				errorMessage: "The scan could not be queued; upload the file again",
			});
			throw new Error("The scan could not be queued; upload the file again");
		}
		return { success: true as const, data: { batchId: created.batchId } };
	} catch (error) {
		return {
			success: false as const,
			error:
				error instanceof Error && !error.cause
					? error.message.slice(0, 500)
					: "Unable to upload this CSV work import",
		};
	}
}

const batchSchema = z.strictObject({
	organizationId: z.string().min(1).max(128),
	batchId: z.uuid(),
});

export async function commitCsvWorkAction(input: unknown) {
	try {
		const values = batchSchema.parse(input);
		const auth = await requireImportAdmin(values.organizationId);
		const job = await prepareCsvWorkCommit({
			...values,
			actorUserId: auth.user.id,
		});
		try {
			await enqueueImportCommitJob(job);
		} catch {
			await updateImportBatchStatus({
				...values,
				status: "commit_failed",
				errorMessage:
					"The commit could not be queued; recheck the unresolved rows and try again",
			});
			throw new Error(
				"The commit could not be queued; recheck the unresolved rows and try again",
			);
		}
		return { success: true as const, data: {} };
	} catch (error) {
		return {
			success: false as const,
			error:
				error instanceof Error && !error.cause
					? error.message.slice(0, 500)
					: "Unable to start this CSV work commit",
		};
	}
}

const decisionSchema = batchSchema.extend({
	rowIds: z.array(z.uuid()).min(1).max(1000),
	decision: z.enum(["accepted", "rejected"]),
});
const mappingSchema = batchSchema.extend({
	kind: z.enum(["employee", "vehicle"]),
	sourceValue: z.string().min(1).max(128),
	targetId: z.uuid(),
});
async function runCsvBatchAction<T extends z.infer<typeof batchSchema>, R>(
	schema: z.ZodType<T>,
	input: unknown,
	operation: (values: T & { actorUserId: string }) => Promise<R>,
) {
	try {
		const values = schema.parse(input);
		const auth = await requireImportAdmin(values.organizationId);
		return {
			success: true as const,
			data: await operation({ ...values, actorUserId: auth.user.id }),
		};
	} catch (error) {
		return {
			success: false as const,
			error:
				error instanceof Error && !error.cause
					? error.message.slice(0, 500)
					: "Unable to update this CSV work import",
		};
	}
}
export async function decideCsvWorkAction(input: unknown) {
	return runCsvBatchAction(decisionSchema, input, decideCsvWorkRows);
}
export async function mapCsvWorkAction(input: unknown) {
	return runCsvBatchAction(mappingSchema, input, mapCsvWorkValue);
}
export async function refreshCsvWorkAction(input: unknown) {
	return runCsvBatchAction(batchSchema, input, refreshCsvWorkImport);
}
