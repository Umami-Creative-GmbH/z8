"use server";

import { and, eq } from "drizzle-orm";
import { DateTime } from "luxon";
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

const MAX_EMPLOYEE_IDS = 500;
const MAX_EMPLOYEE_ID_LENGTH = 128;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const GENERIC_SCAN_START_ERROR = "Failed to start import review scan";
const IMPORT_PROVIDERS = new Set<ImportProvider>(["clockodo", "clockin"]);
const IMPORT_ENTITY_TYPES = new Set<ImportEntityType>([
	"employee",
	"team",
	"service",
	"work_category",
	"absence_category",
	"target_hours",
	"work_policy",
	"holiday_quota",
	"holiday",
	"surcharge",
	"absence",
	"time_entry",
	"work_period",
]);

export interface StartImportReviewScanInput {
	organizationId: string;
	provider: ImportProvider;
	credential: string;
	selectedScope: Record<string, unknown>;
	dateRange: ImportDateRange;
	employeeIds: string[];
	entityTypes: ImportEntityType[];
}

interface ValidatedStartImportReviewScanInput extends StartImportReviewScanInput {
	credential: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	if (!isRecord(value)) return false;
	const prototype = Object.getPrototypeOf(value);
	return prototype === Object.prototype || prototype === null;
}

function validateImportDate(value: unknown, label: "start" | "end"): string {
	if (typeof value !== "string" || !DATE_PATTERN.test(value)) {
		throw new Error(`Invalid import ${label} date: ${String(value)}`);
	}

	const parsed = DateTime.fromISO(value, { zone: "utc" });
	if (!parsed.isValid || parsed.toISODate() !== value) {
		throw new Error(`Invalid import ${label} date: ${value}`);
	}

	return value;
}

function validateStartImportReviewScanInput(input: unknown): ValidatedStartImportReviewScanInput {
	if (!isRecord(input)) {
		throw new Error("Invalid import review scan input");
	}

	if (typeof input.organizationId !== "string" || input.organizationId.trim().length === 0) {
		throw new Error("Organization ID is required");
	}

	if (typeof input.provider !== "string" || !IMPORT_PROVIDERS.has(input.provider as ImportProvider)) {
		throw new Error("Invalid import provider");
	}

	const credential = typeof input.credential === "string" ? input.credential.trim() : "";
	if (!credential) {
		throw new Error("Import credential is required");
	}

	if (!isPlainObject(input.selectedScope)) {
		throw new Error("Import selected scope must be a plain object");
	}

	if (!isRecord(input.dateRange)) {
		throw new Error("Invalid import date range");
	}

	const startDate = validateImportDate(input.dateRange.startDate, "start");
	const endDate = validateImportDate(input.dateRange.endDate, "end");
	if (startDate > endDate) {
		throw new Error("Import start date must be on or before end date");
	}

	if (!Array.isArray(input.employeeIds)) {
		throw new Error("Import employee IDs must be an array");
	}

	if (input.employeeIds.length > MAX_EMPLOYEE_IDS) {
		throw new Error("Too many employee IDs requested");
	}

	if (
		input.employeeIds.some(
			(employeeId) =>
				typeof employeeId !== "string" ||
				employeeId.trim().length === 0 ||
				employeeId.length > MAX_EMPLOYEE_ID_LENGTH,
		)
	) {
		throw new Error("Invalid import employee ID");
	}

	if (!Array.isArray(input.entityTypes) || input.entityTypes.length === 0) {
		throw new Error("At least one import entity type is required");
	}

	if (
		input.entityTypes.some(
			(entityType) => typeof entityType !== "string" || !IMPORT_ENTITY_TYPES.has(entityType as ImportEntityType),
		)
	) {
		throw new Error("Invalid import entity type");
	}

	return {
		organizationId: input.organizationId,
		provider: input.provider as ImportProvider,
		credential,
		selectedScope: input.selectedScope,
		dateRange: { startDate, endDate },
		employeeIds: input.employeeIds,
		entityTypes: input.entityTypes as ImportEntityType[],
	};
}

function sanitizeErrorMessage(error: unknown, credential?: string): string {
	if (!(error instanceof Error)) return GENERIC_SCAN_START_ERROR;
	const message = error.message.trim();
	if (!message) return GENERIC_SCAN_START_ERROR;
	if (credential && message.includes(credential)) return GENERIC_SCAN_START_ERROR;
	return message.length > 500 ? `${message.slice(0, 497)}...` : message;
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
	input: unknown,
): Promise<ActionResult<{ batchId: string }>> {
	let batchContext: { id: string; organizationId: string } | null = null;
	let credential: string | undefined;

	try {
		const validated = validateStartImportReviewScanInput(input);
		credential = validated.credential;
		const authContext = await requireImportAdmin(validated.organizationId);

		const datePartitions = partitionDateRangeByMonth(
			validated.dateRange.startDate,
			validated.dateRange.endDate,
		);
		const batch = await createImportBatch({
			organizationId: validated.organizationId,
			provider: validated.provider,
			selectedScope: validated.selectedScope,
			dateRange: validated.dateRange,
			startedBy: authContext.user.id,
		});
		batchContext = { id: batch.id, organizationId: validated.organizationId };

		const secret = await saveImportJobSecret({
			batchId: batch.id,
			organizationId: validated.organizationId,
			credential: encryptImportCredential(credential, env.BETTER_AUTH_SECRET),
		});

		const scanJobs: Array<{
			jobId: string;
			entityType: ImportEntityType;
			dateRange: ImportDateRange;
		}> = [];

		for (const entityType of validated.entityTypes) {
			for (const dateRange of datePartitions) {
				const partitionKey = `${entityType}:${dateRange.startDate}:${dateRange.endDate}`;
				const job = await createImportBatchJob({
					batchId: batch.id,
					organizationId: validated.organizationId,
					kind: "scan",
					entityType,
					partitionKey,
				});

				if (!job) {
					throw new Error("Failed to create import scan job");
				}

				scanJobs.push({ jobId: job.id, entityType, dateRange });
			}
		}

		for (const job of scanJobs) {
			await enqueueImportScanJob({
				type: "import-review-scan",
				batchId: batch.id,
				jobId: job.jobId,
				organizationId: validated.organizationId,
				provider: validated.provider,
				entityType: job.entityType,
				dateRange: job.dateRange,
				employeeIds: validated.employeeIds,
				secretId: secret.id,
			});
		}

		await updateImportBatchStatus({
			batchId: batch.id,
			organizationId: validated.organizationId,
			status: "scanning",
		});

		return { success: true, data: { batchId: batch.id } };
	} catch (error) {
		const errorMessage = sanitizeErrorMessage(error, credential);

		if (batchContext) {
			await updateImportBatchStatus({
				batchId: batchContext.id,
				organizationId: batchContext.organizationId,
				status: "scan_failed",
				errorMessage,
			});
		}

		return {
			success: false,
			error: errorMessage,
		};
	}
}
