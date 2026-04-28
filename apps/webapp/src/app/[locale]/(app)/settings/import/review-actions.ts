"use server";

import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import * as authSchema from "@/db/auth-schema";
import { env } from "@/env";
import { requireUser } from "@/lib/auth-helpers";
import { encryptImportCredential } from "@/lib/import-review/credential-secret";
import { partitionDateRangeByMonth } from "@/lib/import-review/partitioning";
import { enqueueImportScanJob } from "@/lib/import-review/queue";
import {
	createImportBatch,
	createImportBatchJob,
	saveImportJobSecret,
	updateImportBatchStatus,
} from "@/lib/import-review/repository";
import type { ImportDateRange, ImportEntityType, ImportProvider } from "@/lib/import-review/types";

type ActionResult<T> = { success: true; data: T } | { success: false; error: string };

export interface StartImportReviewScanInput {
	organizationId: string;
	provider: ImportProvider;
	credential: string;
	selectedScope: Record<string, unknown>;
	dateRange: ImportDateRange;
	employeeIds: string[];
	entityTypes: ImportEntityType[];
}

export async function requireImportAdmin(organizationId: string) {
	const authContext = await requireUser();
	const memberRecord = await db.query.member.findFirst({
		where: and(
			eq(authSchema.member.userId, authContext.user.id),
			eq(authSchema.member.organizationId, organizationId),
		),
	});

	if (!memberRecord || (memberRecord.role !== "owner" && memberRecord.role !== "admin")) {
		throw new Error("Unauthorized");
	}

	return authContext;
}

export async function startImportReviewScan(
	input: StartImportReviewScanInput,
): Promise<ActionResult<{ batchId: string }>> {
	try {
		const authContext = await requireImportAdmin(input.organizationId);
		const credential = input.credential.trim();

		if (!credential) {
			return { success: false, error: "Import credential is required" };
		}

		if (input.entityTypes.length === 0) {
			return { success: false, error: "At least one import entity type is required" };
		}

		const datePartitions = partitionDateRangeByMonth(
			input.dateRange.startDate,
			input.dateRange.endDate,
		);
		const batch = await createImportBatch({
			organizationId: input.organizationId,
			provider: input.provider,
			selectedScope: input.selectedScope,
			dateRange: input.dateRange,
			startedBy: authContext.user.id,
		});
		const secret = await saveImportJobSecret({
			batchId: batch.id,
			organizationId: input.organizationId,
			credential: encryptImportCredential(credential, env.BETTER_AUTH_SECRET),
		});

		await updateImportBatchStatus({
			batchId: batch.id,
			organizationId: input.organizationId,
			status: "scanning",
		});

		for (const entityType of input.entityTypes) {
			for (const dateRange of datePartitions) {
				const partitionKey = `${entityType}:${dateRange.startDate}:${dateRange.endDate}`;
				const job = await createImportBatchJob({
					batchId: batch.id,
					organizationId: input.organizationId,
					kind: "scan",
					entityType,
					partitionKey,
				});

				if (!job) {
					throw new Error("Failed to create import scan job");
				}

				await enqueueImportScanJob({
					type: "import-review-scan",
					batchId: batch.id,
					jobId: job.id,
					organizationId: input.organizationId,
					provider: input.provider,
					entityType,
					dateRange,
					employeeIds: input.employeeIds,
					secretId: secret.id,
				});
			}
		}

		return { success: true, data: { batchId: batch.id } };
	} catch (error) {
		return {
			success: false,
			error: error instanceof Error ? error.message : "Failed to start import review scan",
		};
	}
}
