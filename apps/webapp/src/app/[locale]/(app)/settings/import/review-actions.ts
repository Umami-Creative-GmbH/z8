"use server";

import { and, eq, inArray } from "drizzle-orm";
import { DateTime } from "luxon";
import { db } from "@/db";
import * as authSchema from "@/db/auth-schema";
import { employee } from "@/db/schema";
import { env } from "@/env";
import { requireUser } from "@/lib/auth-helpers";
import { encryptImportCredential } from "@/lib/import-review/credential-secret";
import { partitionDateRangeByMonth } from "@/lib/import-review/partitioning";
import { enqueueImportCommitJob, enqueueImportScanJob } from "@/lib/import-review/queue";
import {
	applyImportRowDecision,
	createCommitJobsForAcceptedRows,
	createImportBatch,
	createImportBatchJob,
	getImportReviewSummary,
	listImportReviewRows,
	listRejectedImportReviewRowsForExport,
	recordRejectedExport,
	readyCommitJobsFromJobs,
	saveImportJobSecret,
	updateImportBatchStatus,
} from "@/lib/import-review/repository";
import type {
	ImportDateRange,
	ImportEmployeeMapping,
	ImportEntityType,
	ImportProvider,
	ImportRowStatus,
} from "@/lib/import-review/types";

type ActionResult<T> = { success: true; data: T } | { success: false; error: string };

const MAX_EMPLOYEE_IDS = 500;
const MAX_EMPLOYEE_ID_LENGTH = 128;
const MAX_ROW_IDS = 500;
const MAX_REVIEW_PAGE_LIMIT = 500;
const MAX_REVIEW_PAGE_OFFSET = 100_000;
const MAX_DECISION_REASON_LENGTH = 1_000;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const SAFE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const GENERIC_SCAN_START_ERROR = "Failed to start import review scan";
const GENERIC_COMMIT_START_ERROR = "Failed to start import commit";
const IMPORT_PROVIDERS = new Set<ImportProvider>(["clockodo", "clockin"]);
const IMPORT_ROW_STATUSES = new Set<ImportRowStatus>([
	"staged",
	"accepted",
	"rejected",
	"blocked",
	"needs_mapping",
	"committing",
	"committed",
	"commit_failed",
]);
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
	employeeMappings?: ImportEmployeeMapping[];
	entityTypes: ImportEntityType[];
}

interface ValidatedStartImportReviewScanInput extends StartImportReviewScanInput {
	credential: string;
	employeeMappings: ImportEmployeeMapping[];
}

interface ImportReviewBatchInput {
	organizationId: string;
	batchId: string;
}

interface ListImportReviewRowsInput extends ImportReviewBatchInput {
	status?: ImportRowStatus;
	limit: number;
	offset: number;
}

interface ApplyImportDecisionInput extends ImportReviewBatchInput {
	rowIds: string[];
	decision: "accepted" | "rejected";
	reason?: string | null;
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

function validateSafeId(value: unknown, label: string): string {
	if (typeof value !== "string" || !SAFE_ID_PATTERN.test(value.trim())) {
		throw new Error(`${label} is invalid`);
	}

	return value.trim();
}

function validateImportReviewBatchInput(input: unknown): ImportReviewBatchInput {
	if (!isRecord(input)) throw new Error("Invalid import review input");

	return {
		organizationId: validateSafeId(input.organizationId, "Organization ID"),
		batchId: validateSafeId(input.batchId, "Import batch ID"),
	};
}

function validateListImportReviewRowsInput(input: unknown): ListImportReviewRowsInput {
	const batchInput = validateImportReviewBatchInput(input);
	if (!isRecord(input)) throw new Error("Invalid import review row list input");

	if (
		typeof input.limit !== "number" ||
		!Number.isInteger(input.limit) ||
		input.limit < 1 ||
		input.limit > MAX_REVIEW_PAGE_LIMIT
	) {
		throw new Error("Invalid import review page limit");
	}

	if (
		typeof input.offset !== "number" ||
		!Number.isInteger(input.offset) ||
		input.offset < 0 ||
		input.offset > MAX_REVIEW_PAGE_OFFSET
	) {
		throw new Error("Invalid import review page offset");
	}

	if (
		input.status !== undefined &&
		(typeof input.status !== "string" || !IMPORT_ROW_STATUSES.has(input.status as ImportRowStatus))
	) {
		throw new Error("Invalid import review row status");
	}

	return {
		...batchInput,
		status: input.status as ImportRowStatus | undefined,
		limit: input.limit,
		offset: input.offset,
	};
}

function validateApplyImportDecisionInput(input: unknown): ApplyImportDecisionInput {
	const batchInput = validateImportReviewBatchInput(input);
	if (!isRecord(input)) throw new Error("Invalid import review decision input");

	if (!Array.isArray(input.rowIds) || input.rowIds.length === 0) {
		throw new Error("At least one import review row is required");
	}

	if (input.rowIds.length > MAX_ROW_IDS) {
		throw new Error("Too many import review rows requested");
	}

	const rowIds = input.rowIds.map((rowId) => validateSafeId(rowId, "Import review row ID"));
	if (new Set(rowIds).size !== rowIds.length) {
		throw new Error("Duplicate import review row IDs are not allowed");
	}

	if (input.decision !== "accepted" && input.decision !== "rejected") {
		throw new Error("Invalid import review decision");
	}

	let reason: string | null | undefined;
	if (input.reason !== undefined && input.reason !== null) {
		if (typeof input.reason !== "string") throw new Error("Invalid import review decision reason");
		reason = input.reason.trim();
		if (reason.length > MAX_DECISION_REASON_LENGTH)
			throw new Error("Import review decision reason is too long");
		if (!reason) reason = null;
	}

	return {
		...batchInput,
		rowIds,
		decision: input.decision,
		reason,
	};
}

function validateStartImportReviewScanInput(input: unknown): ValidatedStartImportReviewScanInput {
	if (!isRecord(input)) {
		throw new Error("Invalid import review scan input");
	}

	if (typeof input.organizationId !== "string" || input.organizationId.trim().length === 0) {
		throw new Error("Organization ID is required");
	}

	if (
		typeof input.provider !== "string" ||
		!IMPORT_PROVIDERS.has(input.provider as ImportProvider)
	) {
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

	let employeeMappings: ImportEmployeeMapping[] = [];
	if (input.employeeMappings !== undefined) {
		if (!Array.isArray(input.employeeMappings)) {
			throw new Error("Import employee mappings must be an array");
		}

		if (input.employeeMappings.length > MAX_EMPLOYEE_IDS) {
			throw new Error("Too many employee mappings requested");
		}

		employeeMappings = input.employeeMappings.map((mapping) => {
			if (!isRecord(mapping)) throw new Error("Invalid import employee mapping");

			const providerEmployeeId =
				typeof mapping.providerEmployeeId === "string" ? mapping.providerEmployeeId.trim() : "";
			if (!providerEmployeeId || providerEmployeeId.length > MAX_EMPLOYEE_ID_LENGTH) {
				throw new Error("Invalid import provider employee ID");
			}

			let userId: string | null | undefined;
			if (mapping.userId !== undefined && mapping.userId !== null) {
				userId = validateSafeId(mapping.userId, "Mapped user ID");
			} else if (mapping.userId === null) {
				userId = null;
			}

			return {
				providerEmployeeId,
				employeeId: validateSafeId(mapping.employeeId, "Mapped employee ID"),
				userId,
			};
		});
	}

	if (!Array.isArray(input.entityTypes) || input.entityTypes.length === 0) {
		throw new Error("At least one import entity type is required");
	}

	if (
		input.entityTypes.some(
			(entityType) =>
				typeof entityType !== "string" || !IMPORT_ENTITY_TYPES.has(entityType as ImportEntityType),
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
		employeeMappings,
		entityTypes: input.entityTypes as ImportEntityType[],
	};
}

async function validateMappedEmployeeOwnership(
	employeeMappings: ImportEmployeeMapping[],
	organizationId: string,
): Promise<void> {
	if (employeeMappings.length === 0) return;

	const mappedEmployeeIds = [...new Set(employeeMappings.map((mapping) => mapping.employeeId))];
	const validEmployees = await db
		.select({ id: employee.id })
		.from(employee)
		.where(and(eq(employee.organizationId, organizationId), inArray(employee.id, mappedEmployeeIds)));

	const validIds = new Set(validEmployees.map((entry) => entry.id));
	const invalidIds = mappedEmployeeIds.filter((id) => !validIds.has(id));
	if (invalidIds.length > 0) {
		throw new Error("One or more mapped employee IDs do not belong to this organization");
	}
}

function sanitizeErrorMessage(
	error: unknown,
	credential?: string,
	fallback = GENERIC_SCAN_START_ERROR,
): string {
	if (!(error instanceof Error)) return fallback;
	const message = error.message.trim();
	if (!message) return fallback;
	if (credential && message.includes(credential)) return fallback;
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
		await validateMappedEmployeeOwnership(validated.employeeMappings, validated.organizationId);

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
				employeeMappings: validated.employeeMappings,
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

export async function getImportReviewSummaryAction(
	organizationId: unknown,
	batchId: unknown,
): Promise<ActionResult<Awaited<ReturnType<typeof getImportReviewSummary>>>> {
	try {
		const validated = {
			organizationId: validateSafeId(organizationId, "Organization ID"),
			batchId: validateSafeId(batchId, "Import batch ID"),
		};
		await requireImportAdmin(validated.organizationId);
		const summary = await getImportReviewSummary(validated);
		return { success: true, data: summary };
	} catch (error) {
		return { success: false, error: sanitizeErrorMessage(error) };
	}
}

export async function listImportReviewRowsAction(
	input: unknown,
): Promise<ActionResult<Awaited<ReturnType<typeof listImportReviewRows>>>> {
	try {
		const validated = validateListImportReviewRowsInput(input);
		await requireImportAdmin(validated.organizationId);
		const rows = await listImportReviewRows(validated);
		return { success: true, data: rows };
	} catch (error) {
		return { success: false, error: sanitizeErrorMessage(error) };
	}
}

export async function applyImportDecisionAction(
	input: unknown,
): Promise<ActionResult<{ updatedCount: number }>> {
	try {
		const validated = validateApplyImportDecisionInput(input);
		const authContext = await requireImportAdmin(validated.organizationId);
		const result = await applyImportRowDecision({
			...validated,
			decidedBy: authContext.user.id,
		});
		return { success: true, data: result };
	} catch (error) {
		return { success: false, error: sanitizeErrorMessage(error) };
	}
}

export async function exportRejectedRowsAction(
	input: unknown,
): Promise<ActionResult<{ exportId: string; fileName: string; content: string }>> {
	try {
		const validated = validateImportReviewBatchInput(input);
		const authContext = await requireImportAdmin(validated.organizationId);
		const rows = await listRejectedImportReviewRowsForExport(validated);
		const fileName = `import-${validated.batchId}-rejected.csv`;
		const content = buildRejectedRowsCsv(rows);
		const rejectedExport = await recordRejectedExport({
			...validated,
			exportedBy: authContext.user.id,
			rowCount: rows.length,
			fileName,
		});

		return {
			success: true,
			data: { exportId: rejectedExport.id, fileName: rejectedExport.fileName, content },
		};
	} catch (error) {
		return { success: false, error: sanitizeErrorMessage(error) };
	}
}

function csvCell(value: unknown): string {
	const text = typeof value === "string" ? value : JSON.stringify(value ?? "");
	if (!/[",\n\r]/.test(text)) return text;
	return `"${text.replaceAll('"', '""')}"`;
}

function buildRejectedRowsCsv(
	rows: Awaited<ReturnType<typeof listRejectedImportReviewRowsForExport>>,
): string {
	const header = [
		"id",
		"entityType",
		"providerSourceId",
		"issueSeverity",
		"decisionReason",
		"normalizedPayload",
		"sourcePayload",
	];
	const lines = rows.map((row) =>
		[
			row.id,
			row.entityType,
			row.providerSourceId,
			row.issueSeverity,
			row.decisionReason ?? "",
			row.normalizedPayload,
			row.sourcePayload,
		]
			.map(csvCell)
			.join(","),
	);

	return [header.join(","), ...lines].join("\n");
}

export async function startImportCommitAction(
	input: unknown,
): Promise<ActionResult<{ queuedCount: number }>> {
	let batchContext: ImportReviewBatchInput | null = null;

	try {
		const validated = validateImportReviewBatchInput(input);
		const authContext = await requireImportAdmin(validated.organizationId);
		const summary = await getImportReviewSummary(validated);

		if (summary.blockedRows > 0) {
			return {
				success: false,
				error: "Resolve blocked import review rows before committing",
			};
		}

		const jobs = await createCommitJobsForAcceptedRows(validated);
		if (jobs.length === 0) {
			return {
				success: false,
				error: "No accepted import review rows are available to commit",
			};
		}

		await updateImportBatchStatus({
			...validated,
			status: "committing",
			expectedStatus: "needs_review",
		});
		batchContext = validated;

		for (const job of readyCommitJobsFromJobs(jobs)) {
			await enqueueImportCommitJob({
				type: "import-review-commit",
				batchId: validated.batchId,
				jobId: job.id,
				organizationId: validated.organizationId,
				entityType: job.entityType as ImportEntityType,
				committedBy: authContext.user.id,
			});
		}

		return { success: true, data: { queuedCount: jobs.length } };
	} catch (error) {
		const errorMessage = sanitizeErrorMessage(error, undefined, GENERIC_COMMIT_START_ERROR);

		if (batchContext) {
			await updateImportBatchStatus({
				...batchContext,
				status: "commit_failed",
				errorMessage,
			});
		}

		return { success: false, error: errorMessage };
	}
}
