"use server";

import { and, eq, inArray } from "drizzle-orm";
import { Effect } from "effect";
import { DateTime } from "luxon";
import { z } from "zod";
import { employee } from "@/db/schema";
import { env } from "@/env";
import { ValidationError } from "@/lib/effect/errors";
import { DatabaseService } from "@/lib/effect/services/database.service";
import { encryptImportCredential } from "@/lib/import-review/credential-secret";
import { partitionDateRangeByMonth } from "@/lib/import-review/partitioning";
import {
	enqueueImportCommitJob,
	enqueueImportScanJob,
} from "@/lib/import-review/queue";
import {
	applyImportRowDecision,
	createCommitJobsForAcceptedRows,
	createImportBatch,
	createImportBatchJob,
	getImportReviewSummary,
	listImportReviewRows,
	listRejectedImportReviewRowsForExport,
	readyCommitJobsFromJobs,
	recordRejectedExport,
	saveImportJobSecret,
	updateImportBatchStatus,
} from "@/lib/import-review/repository";
import type {
	ImportApiProvider,
	ImportDateRange,
	ImportEmployeeMapping,
	ImportEntityType,
	ImportRowChoice,
	ImportRowStatus,
} from "@/lib/import-review/types";
import { organizationAction } from "@/lib/organization-action/organization-action";

const MAX_EMPLOYEE_IDS = 500;
const MAX_EMPLOYEE_ID_LENGTH = 128;
const MAX_ROW_IDS = 500;
const MAX_REVIEW_PAGE_LIMIT = 500;
const MAX_REVIEW_PAGE_OFFSET = 100_000;
const MAX_DECISION_REASON_LENGTH = 1_000;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const SAFE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const UUID_PATTERN =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const GENERIC_SCAN_START_ERROR = "Failed to start import review scan";
const GENERIC_COMMIT_START_ERROR = "Failed to start import commit";
function isImportProvider(value: string): value is ImportApiProvider {
	return value === "clockodo" || value === "clockin";
}

function isImportRowStatus(value: string): value is ImportRowStatus {
	return (
		value === "staged" ||
		value === "accepted" ||
		value === "rejected" ||
		value === "blocked" ||
		value === "needs_mapping" ||
		value === "committing" ||
		value === "committed" ||
		value === "commit_failed"
	);
}

function isImportEntityType(value: string): value is ImportEntityType {
	return (
		value === "employee" ||
		value === "team" ||
		value === "service" ||
		value === "work_category" ||
		value === "absence_category" ||
		value === "target_hours" ||
		value === "work_policy" ||
		value === "holiday_quota" ||
		value === "holiday" ||
		value === "surcharge" ||
		value === "absence" ||
		value === "time_entry" ||
		value === "work_period"
	);
}

export interface StartImportReviewScanInput {
	provider: ImportApiProvider;
	credential: string;
	selectedScope: Record<string, unknown>;
	dateRange: ImportDateRange;
	employeeIds: string[];
	employeeMappings?: ImportEmployeeMapping[];
	entityTypes: ImportEntityType[];
}

interface ValidatedStartImportReviewScanInput
	extends StartImportReviewScanInput {
	credential: string;
	employeeMappings: ImportEmployeeMapping[];
}

interface ImportReviewBatchInput {
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
	/** Link the accepted row onto an existing record instead of creating one (#906). */
	choice?: ImportRowChoice | null;
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

function validateImportReviewBatchInput(
	input: unknown,
): ImportReviewBatchInput {
	if (!isRecord(input)) throw new Error("Invalid import review input");

	return {
		batchId: validateSafeId(input.batchId, "Import batch ID"),
	};
}

function validateListImportReviewRowsInput(
	input: unknown,
): ListImportReviewRowsInput {
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
		(typeof input.status !== "string" || !isImportRowStatus(input.status))
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

function validateApplyImportDecisionInput(
	input: unknown,
): ApplyImportDecisionInput {
	const batchInput = validateImportReviewBatchInput(input);
	if (!isRecord(input)) throw new Error("Invalid import review decision input");

	if (!Array.isArray(input.rowIds) || input.rowIds.length === 0) {
		throw new Error("At least one import review row is required");
	}

	if (input.rowIds.length > MAX_ROW_IDS) {
		throw new Error("Too many import review rows requested");
	}

	const rowIds = input.rowIds.map((rowId) =>
		validateSafeId(rowId, "Import review row ID"),
	);
	if (new Set(rowIds).size !== rowIds.length) {
		throw new Error("Duplicate import review row IDs are not allowed");
	}

	if (input.decision !== "accepted" && input.decision !== "rejected") {
		throw new Error("Invalid import review decision");
	}

	let reason: string | null | undefined;
	if (input.reason !== undefined && input.reason !== null) {
		if (typeof input.reason !== "string")
			throw new Error("Invalid import review decision reason");
		reason = input.reason.trim();
		if (reason.length > MAX_DECISION_REASON_LENGTH)
			throw new Error("Import review decision reason is too long");
		if (!reason) reason = null;
	}

	let choice: ImportRowChoice | null = null;
	if (input.choice !== undefined && input.choice !== null) {
		if (
			!isRecord(input.choice) ||
			input.choice.kind !== "link" ||
			typeof input.choice.targetId !== "string" ||
			!UUID_PATTERN.test(input.choice.targetId)
		) {
			throw new Error("Invalid import review link target");
		}
		if (input.decision !== "accepted" || rowIds.length !== 1) {
			throw new Error("Link one accepted import review row at a time");
		}
		choice = { kind: "link", targetId: input.choice.targetId };
	}

	return {
		...batchInput,
		rowIds,
		decision: input.decision,
		reason,
		choice,
	};
}

function validateStartImportReviewScanInput(
	input: unknown,
): ValidatedStartImportReviewScanInput {
	if (!isRecord(input)) {
		throw new Error("Invalid import review scan input");
	}

	if (typeof input.provider !== "string" || !isImportProvider(input.provider)) {
		throw new Error("Invalid import provider");
	}

	const credential =
		typeof input.credential === "string" ? input.credential.trim() : "";
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
			if (!isRecord(mapping))
				throw new Error("Invalid import employee mapping");

			const providerEmployeeId =
				typeof mapping.providerEmployeeId === "string"
					? mapping.providerEmployeeId.trim()
					: "";
			if (
				!providerEmployeeId ||
				providerEmployeeId.length > MAX_EMPLOYEE_ID_LENGTH
			) {
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
				typeof entityType !== "string" || !isImportEntityType(entityType),
		)
	) {
		throw new Error("Invalid import entity type");
	}

	return {
		provider: input.provider as ImportApiProvider,
		credential,
		selectedScope: input.selectedScope,
		dateRange: { startDate, endDate },
		employeeIds: input.employeeIds,
		employeeMappings,
		entityTypes: input.entityTypes as ImportEntityType[],
	};
}

/**
 * A zod schema over one of the validators above, so the input is checked after
 * authorization and a refusal keeps the validator's message.
 */
function validatedBy<T>(validate: (input: unknown) => T) {
	return z.unknown().transform((input, context) => {
		try {
			return validate(input);
		} catch (error) {
			context.addIssue({
				code: "custom",
				message: error instanceof Error ? error.message : "Invalid import review input",
			});
			return z.NEVER;
		}
	});
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

/**
 * Import review work that still runs on Promise helpers. A failure reaches the
 * client as its sanitized message (`UNKNOWN_ERROR`), never with the credential.
 */
function importReview<T>(
	run: () => Promise<T>,
	options: { credential?: string; fallback?: string } = {},
) {
	return Effect.tryPromise({
		try: run,
		catch: (error) => new Error(sanitizeErrorMessage(error, options.credential, options.fallback)),
	}).pipe(Effect.orDie);
}

/** Refuses mapped employees outside the organization (tampered client requests). */
function validateMappedEmployeesInOrganization(
	employeeMappings: ImportEmployeeMapping[],
	organizationId: string,
) {
	return Effect.gen(function* () {
		const mappedEmployeeIds = [...new Set(employeeMappings.map((mapping) => mapping.employeeId))];
		if (mappedEmployeeIds.length === 0) return;
		const dbService = yield* DatabaseService;
		const validEmployees = yield* dbService.query("importReview.mappedEmployees", () =>
			dbService.db
				.select({ id: employee.id })
				.from(employee)
				.where(
					and(
						eq(employee.organizationId, organizationId),
						inArray(employee.id, mappedEmployeeIds),
					),
				),
		);
		const validIds = new Set(validEmployees.map((entry) => entry.id));
		if (mappedEmployeeIds.some((id) => !validIds.has(id))) {
			return yield* Effect.fail(
				new ValidationError({
					message: "One or more mapped employee IDs do not belong to this organization",
					field: "employeeMappings",
				}),
			);
		}
	});
}

export const startImportReviewScan = organizationAction(
	{
		name: "importReview.startScan",
		requires: "orgAdmin",
		schema: validatedBy(validateStartImportReviewScanInput),
	},
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			yield* validateMappedEmployeesInOrganization(input.employeeMappings, organizationId);
			return yield* importReview(() => startScan(input, organizationId, actor.userId), {
				credential: input.credential,
			});
		}),
);

async function startScan(
	validated: ValidatedStartImportReviewScanInput,
	organizationId: string,
	startedBy: string,
): Promise<{ batchId: string }> {
	let batchId: string | null = null;
	try {
		const datePartitions = partitionDateRangeByMonth(
			validated.dateRange.startDate,
			validated.dateRange.endDate,
		);
		const batch = await createImportBatch({
			organizationId,
			provider: validated.provider,
			selectedScope: validated.selectedScope,
			dateRange: validated.dateRange,
			startedBy,
		});
		batchId = batch.id;

		const secret = await saveImportJobSecret({
			batchId: batch.id,
			organizationId,
			credential: encryptImportCredential(validated.credential, env.BETTER_AUTH_SECRET),
		});

		const scanJobInputs = validated.entityTypes.flatMap((entityType) =>
			datePartitions.map((dateRange) => ({ entityType, dateRange })),
		);
		const scanJobs = await Promise.all(
			scanJobInputs.map(async ({ entityType, dateRange }) => {
				const partitionKey = `${entityType}:${dateRange.startDate}:${dateRange.endDate}`;
				const job = await createImportBatchJob({
					batchId: batch.id,
					organizationId,
					kind: "scan",
					entityType,
					partitionKey,
				});
				if (!job) {
					throw new Error("Failed to create import scan job");
				}
				return { jobId: job.id, entityType, dateRange };
			}),
		);

		await updateImportBatchStatus({ batchId: batch.id, organizationId, status: "scanning" });

		await Promise.all(
			scanJobs.map((job) =>
				enqueueImportScanJob({
					type: "import-review-scan",
					batchId: batch.id,
					jobId: job.jobId,
					organizationId,
					provider: validated.provider,
					entityType: job.entityType,
					dateRange: job.dateRange,
					employeeIds: validated.employeeIds,
					employeeMappings: validated.employeeMappings,
					secretId: secret.id,
				}),
			),
		);

		return { batchId: batch.id };
	} catch (error) {
		if (batchId) {
			await updateImportBatchStatus({
				batchId,
				organizationId,
				status: "scan_failed",
				errorMessage: sanitizeErrorMessage(error, validated.credential),
			});
		}
		throw error;
	}
}

export const getImportReviewSummaryAction = organizationAction(
	{
		name: "importReview.getSummary",
		requires: "orgAdmin",
		schema: validatedBy(validateImportReviewBatchInput),
	},
	({ organizationId, input }) =>
		importReview(() => getImportReviewSummary({ ...input, organizationId })),
);

export const listImportReviewRowsAction = organizationAction(
	{
		name: "importReview.listRows",
		requires: "orgAdmin",
		schema: validatedBy(validateListImportReviewRowsInput),
	},
	({ organizationId, input }) =>
		importReview(() => listImportReviewRows({ ...input, organizationId })),
);

export const applyImportDecisionAction = organizationAction(
	{
		name: "importReview.applyDecision",
		requires: "orgAdmin",
		schema: validatedBy(validateApplyImportDecisionInput),
	},
	({ actor, organizationId, input }) =>
		importReview(() =>
			applyImportRowDecision({ ...input, organizationId, decidedBy: actor.userId }),
		),
);

export const exportRejectedRowsAction = organizationAction(
	{
		name: "importReview.exportRejectedRows",
		requires: "orgAdmin",
		schema: validatedBy(validateImportReviewBatchInput),
	},
	({ actor, organizationId, input }) =>
		importReview(async () => {
			const batch = { ...input, organizationId };
			const rows = await listRejectedImportReviewRowsForExport(batch);
			const fileName = `import-${input.batchId}-rejected.csv`;
			const content = buildRejectedRowsCsv(rows);
			const rejectedExport = await recordRejectedExport({
				...batch,
				exportedBy: actor.userId,
				rowCount: rows.length,
				fileName,
			});
			return { exportId: rejectedExport.id, fileName: rejectedExport.fileName, content };
		}),
);

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

export const startImportCommitAction = organizationAction(
	{
		name: "importReview.startCommit",
		requires: "orgAdmin",
		schema: validatedBy(validateImportReviewBatchInput),
	},
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			const batch = { ...input, organizationId };
			const summary = yield* importReview(() => getImportReviewSummary(batch), {
				fallback: GENERIC_COMMIT_START_ERROR,
			});
			if (summary.blockedRows > 0) {
				return yield* Effect.fail(
					new ValidationError({
						message: "Resolve blocked import review rows before committing",
					}),
				);
			}

			const jobs = yield* importReview(() => createCommitJobsForAcceptedRows(batch), {
				fallback: GENERIC_COMMIT_START_ERROR,
			});
			if (jobs.length === 0) {
				return yield* Effect.fail(
					new ValidationError({
						message: "No accepted import review rows are available to commit",
					}),
				);
			}

			return yield* importReview(() => startCommit(batch, jobs, actor.userId), {
				fallback: GENERIC_COMMIT_START_ERROR,
			});
		}),
);

async function startCommit(
	batch: ImportReviewBatchInput & { organizationId: string },
	jobs: Awaited<ReturnType<typeof createCommitJobsForAcceptedRows>>,
	committedBy: string,
): Promise<{ queuedCount: number }> {
	await updateImportBatchStatus({
		...batch,
		status: "committing",
		expectedStatus: "needs_review",
	});
	try {
		await Promise.all(
			readyCommitJobsFromJobs(jobs).map((job) =>
				enqueueImportCommitJob({
					type: "import-review-commit",
					batchId: batch.batchId,
					jobId: job.id,
					organizationId: batch.organizationId,
					entityType: job.entityType as ImportEntityType,
					committedBy,
				}),
			),
		);
	} catch (error) {
		await updateImportBatchStatus({
			...batch,
			status: "commit_failed",
			errorMessage: sanitizeErrorMessage(error, undefined, GENERIC_COMMIT_START_ERROR),
		});
		throw error;
	}
	return { queuedCount: jobs.length };
}
