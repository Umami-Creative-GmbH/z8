import { createHash, randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { user } from "@/db/auth-schema";
import {
	type ContractChangeBatch,
	type ContractChangeBatchItem,
	contractChangeBatch,
	contractChangeBatchItem,
	contractTemplateVersion,
	contractTemplateVersionDay,
	employee,
	employeeEmploymentHistory,
	employeeEmploymentHistoryDay,
} from "@/db/schema";
import type {
	ArbzgScope,
	BalanceMode,
	ContractChangeBatchExecutionMode,
	ContractChangeBatchItemStatus,
	ContractChangeBatchOperationKind,
	ContractChangeBatchStatus,
	EmploymentProfile,
	OnCallHoursKind,
	PresenceOverride,
	ScheduleMode,
	ScheduleSource,
} from "@/db/schema/contract-types";
import { currentTimestamp } from "@/lib/datetime/drizzle-adapter";
import { systemClock } from "@/lib/datetime/temporal-core";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/effect/errors";
import type { DatabaseClient } from "@/lib/effect/services/database.service";
import type { createDepartureCommands } from "@/lib/employee-lifecycle/commands";
import type { DepartureClockOutPort, LifecycleActor } from "@/lib/employee-lifecycle/types";
import { createLogger } from "@/lib/logger";
import type { ContractType } from "@/lib/validations/employee";
import { adoptContractDefaultInTx, commitContractChangeInTx } from "./commit-contract-change";
import { type ContractWriteTx, parseIsoCalendarDate } from "./contract-validation";
import { resolveEffectiveContractOnDay } from "./resolve-contract";
import type { CustomWorkDay, WorkModel } from "./types";

const logger = createLogger("ContractChangeBatchEngine");

export const INLINE_BATCH_THRESHOLD = 200;
export const BATCH_LEASE_DURATION_MS = 60_000;
export const BATCH_HEARTBEAT_INTERVAL_ITEMS = 10;
export const RECOVERY_PENDING_AGE_MS = 10_000;
const ITEM_INSERT_CHUNK_SIZE = 1000;
const ITEM_FETCH_CHUNK_SIZE = 100;

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function contractChangeBatchJobId(batchId: string): string {
	return `contract-change-batch-${batchId}`;
}

export type OperationalDivergenceField =
	| "workPolicy"
	| "weeklyContractMinutes"
	| "scheduleMode"
	| "workModel"
	| "presenceOverride"
	| "balanceMode"
	| "scheduleSource";

export interface BulkTemplateApplyBatchPayload {
	readonly templateVersionId: string;
	readonly effectiveFromDate: string;
	readonly overwritePersonalDivergences: boolean;
	readonly changeReason: string | null;
}

export interface BulkAdoptDefaultBatchPayload {
	readonly effectiveFromDate: string;
	readonly keepDivergenceFields: readonly OperationalDivergenceField[];
	readonly onlyLegacyTerms?: boolean;
	readonly changeReason: string | null;
}

export interface BulkTermsUpdateChanges {
	readonly workPolicyId?: string | null;
	readonly clearPersonalPolicyPin?: boolean;
	readonly weeklyContractMinutes?: number | null;
	readonly scheduleMode?: ScheduleMode | null;
	readonly customDays?: readonly CustomWorkDay[] | null;
	readonly workModel?: WorkModel | null;
	readonly presenceOverride?: PresenceOverride | null;
	readonly balanceMode?: BalanceMode | null;
	readonly scheduleSource?: ScheduleSource | null;
	readonly contractType?: ContractType;
	readonly hourlyRate?: number | null;
	readonly currency?: string;
	readonly employmentProfile?: EmploymentProfile;
	readonly arbzgScope?: ArbzgScope;
	readonly onCallHoursKind?: OnCallHoursKind | null;
	readonly onCallWeeklyMinutes?: number | null;
	readonly onCallDailyMinutes?: number | null;
	readonly changeReason?: string | null;
}

export interface BulkTermsUpdateBatchPayload {
	readonly effectiveFromDate: string;
	readonly overwritePersonalDivergences: boolean;
	readonly changes: BulkTermsUpdateChanges;
	readonly changeReason: string | null;
}

export interface CsvContractBatchItemPayload {
	readonly rowNumber: number;
	readonly effectiveFromDate: string;
	readonly overwritePersonalDivergences: boolean;
	readonly changes: BulkTermsUpdateChanges;
}

export type CsvDepartureItemAction =
	| "schedule_departure"
	| "offboard_immediately"
	| "record_past_departure"
	| "correct_past_departure_date"
	| "record_historical_departure_date"
	| "skip_unchanged";

export interface CsvDepartureBatchItemPayload {
	readonly rowNumber: number;
	readonly action: CsvDepartureItemAction;
	readonly lastWorkingDay: string;
	readonly replacementEmployeeId: string | null;
	readonly acknowledgeUnassignedDuties: boolean;
	readonly reason: string | null;
	readonly expectedDepartureId: string | null;
	readonly expectedRevision: number | null;
}

export interface BatchItemInput {
	readonly employeeId: string;
	readonly payload: Record<string, unknown>;
}

export type AsyncBatchEnqueuer = (input: {
	batchId: string;
	organizationId: string;
}) => Promise<void>;

export interface RunContractChangeBatchOptions {
	readonly now?: () => Date;
	readonly leaseDurationMs?: number;
	readonly heartbeatIntervalItems?: number;
	readonly existingLeaseToken?: string;
	readonly departureCommands?: ReturnType<typeof createDepartureCommands>;
	readonly departureClockOut?: DepartureClockOutPort;
	readonly skipBalanceDirtyNotification?: boolean;
	/**
	 * Optional test/instrumentation hook invoked after each processed item.
	 * Returning `{ stopExecution: true }` aborts the worker loop WITHOUT releasing
	 * the lease or finalizing the batch, cleanly simulating a mid-batch process crash.
	 */
	readonly onAfterItemProcessed?: (info: {
		batchId: string;
		itemId: string;
		employeeId: string;
		processedInThisRun: number;
		status: ContractChangeBatchItemStatus;
	}) => Promise<{ stopExecution?: boolean } | void> | { stopExecution?: boolean } | void;
	/** Optional test hook observing heartbeat renewals. */
	readonly onHeartbeat?: (info: {
		batchId: string;
		leaseToken: string;
		processedInThisRun: number;
		leaseExpiresAt: Date;
	}) => void;
}

export interface SubmitContractChangeBatchInput {
	readonly organizationId: string;
	readonly actorUserId: string;
	readonly requestId: string;
	readonly operationKind: ContractChangeBatchOperationKind;
	readonly payload: Record<string, unknown>;
	readonly items: readonly BatchItemInput[];
	readonly now?: Date;
	readonly enqueueAsyncJob?: AsyncBatchEnqueuer;
	/**
	 * When true, commits the batch and items durably without immediately executing inline
	 * or enqueuing async work (useful for deterministic crash-after-commit verification).
	 */
	readonly skipImmediateExecution?: boolean;
	readonly runnerOptions?: RunContractChangeBatchOptions;
}

export interface ContractChangeBatchReceipt {
	readonly batch: ContractChangeBatch;
	readonly replayed: boolean;
	readonly executionMode: ContractChangeBatchExecutionMode;
	readonly recoveryNudged: boolean;
}

export interface RunContractChangeBatchResult {
	readonly batchId: string;
	readonly organizationId: string;
	readonly claimed: boolean;
	readonly abortedEarly: boolean;
	readonly leaseLost: boolean;
	readonly processedInThisRun: number;
	readonly heartbeatsSent: number;
	readonly batch: ContractChangeBatch;
}

export interface ContractChangeBatchRecoveryResult {
	readonly scanned: number;
	readonly recovered: number;
	readonly completed: number;
	readonly completedWithErrors: number;
	readonly failed: number;
	readonly errors: readonly {
		readonly batchId: string;
		readonly organizationId: string;
		readonly error: string;
	}[];
}

function sortKeysCanonical(value: unknown): unknown {
	if (Array.isArray(value)) {
		return value.map(sortKeysCanonical);
	}
	if (value instanceof Date) {
		return value.toISOString();
	}
	if (value !== null && typeof value === "object") {
		const entries = Object.entries(value as Record<string, unknown>)
			.filter(([, v]) => v !== undefined)
			.sort(([a], [b]) => a.localeCompare(b))
			.map(([k, v]) => [k, sortKeysCanonical(v)]);
		return Object.fromEntries(entries);
	}
	return value;
}

/**
 * Computes a deterministic SHA-256 fingerprint over canonical (key-sorted, UUID-sorted)
 * batch submission inputs for idempotency verification and `request_conflict` detection.
 */
export function computeBatchRequestFingerprint(input: {
	organizationId: string;
	operationKind: ContractChangeBatchOperationKind;
	payload: Record<string, unknown>;
	items: readonly BatchItemInput[];
}): string {
	const sortedItems = [...input.items]
		.sort((a, b) => a.employeeId.localeCompare(b.employeeId))
		.map((item) => ({
			employeeId: item.employeeId,
			payload: sortKeysCanonical(item.payload),
		}));
	const canonical = JSON.stringify({
		organizationId: input.organizationId,
		operationKind: input.operationKind,
		payload: sortKeysCanonical(input.payload),
		items: sortedItems,
	});
	return createHash("sha256").update(canonical).digest("hex");
}

function isPgUniqueViolation(error: unknown): boolean {
	if (!error || typeof error !== "object") return false;
	const rec = error as { code?: unknown; cause?: { code?: unknown } };
	return rec.code === "23505" || rec.cause?.code === "23505";
}

async function defaultEnqueueAsyncBatchJob(input: {
	batchId: string;
	organizationId: string;
}): Promise<void> {
	const { addContractChangeBatchJob } = await import("@/lib/queue");
	await addContractChangeBatchJob({
		batchId: input.batchId,
		organizationId: input.organizationId,
	});
}

function validateUuid(value: string, field: string): string {
	if (!UUID_REGEX.test(value)) {
		throw new ValidationError({
			message: `Invalid UUID for ${field}.`,
			field,
			refusal: "invalid_uuid",
		});
	}
	return value;
}

async function readBatchById(
	db: Pick<DatabaseClient, "select">,
	organizationId: string,
	batchId: string,
): Promise<ContractChangeBatch | null> {
	const [row] = await db
		.select()
		.from(contractChangeBatch)
		.where(
			and(
				eq(contractChangeBatch.id, batchId),
				eq(contractChangeBatch.organizationId, organizationId),
			),
		)
		.limit(1);
	return row ?? null;
}

export async function replayExistingContractChangeBatch(
	db: DatabaseClient,
	input: {
		readonly organizationId: string;
		readonly existingBatch: ContractChangeBatch;
		readonly enqueueAsyncJob?: AsyncBatchEnqueuer;
		readonly skipImmediateExecution?: boolean;
		readonly runnerOptions?: RunContractChangeBatchOptions;
	},
): Promise<ContractChangeBatchReceipt> {
	const enqueue = input.enqueueAsyncJob ?? defaultEnqueueAsyncBatchJob;
	let currentBatch = input.existingBatch;
	let recoveryNudged = false;
	const checkNow = input.runnerOptions?.now?.() ?? currentTimestamp();
	const isStalled =
		currentBatch.status === "pending" ||
		(currentBatch.status === "running" &&
			(currentBatch.leaseExpiresAt === null ||
				currentBatch.leaseExpiresAt.getTime() < checkNow.getTime()));

	if (isStalled && !input.skipImmediateExecution) {
		recoveryNudged = true;
		if (currentBatch.executionMode === "inline") {
			const runResult = await runContractChangeBatch(db, {
				organizationId: input.organizationId,
				batchId: currentBatch.id,
				...input.runnerOptions,
			});
			currentBatch = runResult.batch;
		} else {
			try {
				await enqueue({
					batchId: currentBatch.id,
					organizationId: input.organizationId,
				});
			} catch (enqueueError) {
				logger.warn(
					{ error: enqueueError, batchId: currentBatch.id, organizationId: input.organizationId },
					"Failed to nudge async contract batch job on replay; recovery sweeper will pick it up",
				);
			}
		}
	}

	return {
		batch: currentBatch,
		replayed: true,
		executionMode: currentBatch.executionMode,
		recoveryNudged,
	};
}

/**
 * Commit-first durable batch submission with `(organization_id, request_id)` uniqueness
 * and canonical SHA-256 `request_fingerprint` verification:
 *
 * - Replaying the same `(organization_id, request_id)` with an identical fingerprint
 *   returns the original batch receipt and nudges recovery/execution if stalled.
 * - Reusing `request_id` with a different fingerprint throws `ConflictError` (`request_conflict`).
 * - Batches with `<= 200` items execute `inline`; batches with `> 200` items enqueue `async`
 *   on BullMQ (`contract-change-batch-${batchId}`).
 */
export async function submitContractChangeBatch(
	db: DatabaseClient,
	input: SubmitContractChangeBatchInput,
): Promise<ContractChangeBatchReceipt> {
	const requestId = validateUuid(input.requestId, "requestId");
	if (input.items.length === 0) {
		throw new ValidationError({
			message: "A bulk contract batch must target at least one employee.",
			field: "items",
			refusal: "empty_batch",
		});
	}

	const seenEmployees = new Set<string>();
	for (const item of input.items) {
		validateUuid(item.employeeId, "employeeId");
		if (seenEmployees.has(item.employeeId)) {
			throw new ValidationError({
				message: `Duplicate employee ${item.employeeId} in batch.`,
				field: "items",
				refusal: "duplicate_employee",
			});
		}
		seenEmployees.add(item.employeeId);
	}

	const sortedItems = [...input.items].sort((a, b) => a.employeeId.localeCompare(b.employeeId));
	const fingerprint = computeBatchRequestFingerprint({
		organizationId: input.organizationId,
		operationKind: input.operationKind,
		payload: input.payload,
		items: sortedItems,
	});
	const executionMode: ContractChangeBatchExecutionMode =
		sortedItems.length <= INLINE_BATCH_THRESHOLD ? "inline" : "async";
	const now = input.now ?? currentTimestamp();

	let committed: { batch: ContractChangeBatch; replayed: boolean };

	try {
		committed = await db.transaction(async (tx) => {
			const [existing] = await tx
				.select()
				.from(contractChangeBatch)
				.where(
					and(
						eq(contractChangeBatch.organizationId, input.organizationId),
						eq(contractChangeBatch.requestId, requestId),
					),
				)
				.limit(1);

			if (existing) {
				if (existing.requestFingerprint !== fingerprint) {
					throw new ConflictError({
						message: "This request ID was already used with a different batch payload.",
						conflictType: "request_conflict",
						details: { requestId },
					});
				}
				return { batch: existing, replayed: true };
			}

			const [created] = await tx
				.insert(contractChangeBatch)
				.values({
					organizationId: input.organizationId,
					requestId,
					requestFingerprint: fingerprint,
					operationKind: input.operationKind,
					executionMode,
					status: "pending",
					totalItems: sortedItems.length,
					completedItems: 0,
					failedItems: 0,
					skippedItems: 0,
					payload: input.payload,
					attemptCount: 0,
					createdBy: input.actorUserId,
					createdAt: now,
					updatedAt: now,
				})
				.returning();

			if (!created) {
				throw new Error("contract_change_batch insert returned no row");
			}

			for (let offset = 0; offset < sortedItems.length; offset += ITEM_INSERT_CHUNK_SIZE) {
				const slice = sortedItems.slice(offset, offset + ITEM_INSERT_CHUNK_SIZE);
				await tx.insert(contractChangeBatchItem).values(
					slice.map((item, idx) => ({
						organizationId: input.organizationId,
						batchId: created.id,
						employeeId: item.employeeId,
						itemIndex: offset + idx,
						operationDedupeKey: `${requestId}:${item.employeeId}`,
						status: "pending" as const,
						payload: item.payload,
						attemptCount: 0,
						createdAt: now,
						updatedAt: now,
					})),
				);
			}

			return { batch: created, replayed: false };
		});
	} catch (error) {
		if (!isPgUniqueViolation(error)) {
			throw error;
		}
		// Concurrent submission raced on `(organization_id, request_id)` — re-read and verify fingerprint.
		const [raced] = await db
			.select()
			.from(contractChangeBatch)
			.where(
				and(
					eq(contractChangeBatch.organizationId, input.organizationId),
					eq(contractChangeBatch.requestId, requestId),
				),
			)
			.limit(1);
		if (!raced) {
			throw error;
		}
		if (raced.requestFingerprint !== fingerprint) {
			throw new ConflictError({
				message: "This request ID was already used with a different batch payload.",
				conflictType: "request_conflict",
				details: { requestId },
			});
		}
		committed = { batch: raced, replayed: true };
	}

	const enqueue = input.enqueueAsyncJob ?? defaultEnqueueAsyncBatchJob;

	if (committed.replayed) {
		return replayExistingContractChangeBatch(db, {
			organizationId: input.organizationId,
			existingBatch: committed.batch,
			enqueueAsyncJob: enqueue,
			skipImmediateExecution: input.skipImmediateExecution,
			runnerOptions: input.runnerOptions,
		});
	}

	if (input.skipImmediateExecution) {
		return {
			batch: committed.batch,
			replayed: false,
			executionMode,
			recoveryNudged: false,
		};
	}

	if (executionMode === "inline") {
		const runResult = await runContractChangeBatch(db, {
			organizationId: input.organizationId,
			batchId: committed.batch.id,
			...input.runnerOptions,
		});
		return {
			batch: runResult.batch,
			replayed: false,
			executionMode: "inline",
			recoveryNudged: false,
		};
	}

	try {
		await enqueue({
			batchId: committed.batch.id,
			organizationId: input.organizationId,
		});
	} catch (enqueueError) {
		logger.warn(
			{ error: enqueueError, batchId: committed.batch.id, organizationId: input.organizationId },
			"Failed to enqueue async contract batch job; recovery sweeper will pick it up after 10s",
		);
	}

	return {
		batch: committed.batch,
		replayed: false,
		executionMode: "async",
		recoveryNudged: false,
	};
}

// ============================================
// PER-EMPLOYEE EXECUTION HELPERS
// ============================================

interface PriorSparseOperationalState {
	readonly workPolicyId: string | null;
	readonly weeklyContractMinutes: number | null;
	readonly scheduleMode: ScheduleMode | null;
	readonly customDays: readonly CustomWorkDay[];
	readonly workModel: WorkModel | null;
	readonly presenceOverride: PresenceOverride | null;
	readonly balanceMode: BalanceMode | null;
	readonly scheduleSource: ScheduleSource | null;
	readonly onCallHoursKind: OnCallHoursKind | null;
	readonly onCallWeeklyMinutes: number | null;
	readonly onCallDailyMinutes: number | null;
	readonly contractType: ContractType;
	readonly hourlyRate: number | null;
	readonly currency: string;
	readonly employmentProfile: EmploymentProfile;
	readonly arbzgScope: ArbzgScope;
	readonly divergedFields: ReadonlySet<OperationalDivergenceField>;
}

async function loadPriorSparseStateInTx(
	tx: ContractWriteTx,
	input: {
		organizationId: string;
		employeeId: string;
		effectiveFromDate: string;
	},
): Promise<PriorSparseOperationalState> {
	const resolved = await resolveEffectiveContractOnDay(tx, {
		organizationId: input.organizationId,
		employeeId: input.employeeId,
		date: input.effectiveFromDate,
	});
	if (!resolved) {
		throw new NotFoundError({
			message: "Employee not found",
			entityType: "employee",
			entityId: input.employeeId,
		});
	}

	const divergedFields = new Set<OperationalDivergenceField>();
	if (resolved.workPolicySource === "employee_override") divergedFields.add("workPolicy");
	if (resolved.weeklyContractMinutesSource === "employee_override") {
		divergedFields.add("weeklyContractMinutes");
	}
	if (resolved.scheduleModeSource === "employee_override") divergedFields.add("scheduleMode");
	if (resolved.workModelSource === "employee_override") divergedFields.add("workModel");
	if (resolved.presenceOverrideSource === "employee_override") {
		divergedFields.add("presenceOverride");
	}
	if (resolved.balanceModeSource === "employee_override") divergedFields.add("balanceMode");
	if (resolved.scheduleSourceSource === "employee_override") divergedFields.add("scheduleSource");

	let customDays: CustomWorkDay[] = [];
	if (
		divergedFields.has("scheduleMode") &&
		resolved.scheduleMode === "custom_days" &&
		resolved.employmentHistoryId
	) {
		const dayRows = await tx
			.select()
			.from(employeeEmploymentHistoryDay)
			.where(
				and(
					eq(employeeEmploymentHistoryDay.organizationId, input.organizationId),
					eq(employeeEmploymentHistoryDay.employmentHistoryId, resolved.employmentHistoryId),
				),
			);
		customDays = dayRows.map((d) => ({
			dayOfWeek: d.dayOfWeek,
			minutesPerDay: d.minutesPerDay,
			isWorkDay: d.isWorkDay,
			latestClockIn: d.latestClockIn,
		}));
	}

	return {
		workPolicyId: divergedFields.has("workPolicy") ? (resolved.workPolicy?.policyId ?? null) : null,
		weeklyContractMinutes: divergedFields.has("weeklyContractMinutes")
			? resolved.weeklyContractMinutes
			: null,
		scheduleMode: divergedFields.has("scheduleMode") ? resolved.scheduleMode : null,
		customDays,
		workModel: divergedFields.has("workModel") ? resolved.workModel : null,
		presenceOverride: divergedFields.has("presenceOverride") ? resolved.presenceOverride : null,
		balanceMode: divergedFields.has("balanceMode") ? resolved.balanceMode : null,
		scheduleSource: divergedFields.has("scheduleSource") ? resolved.scheduleSource : null,
		onCallHoursKind: resolved.onCallTerms?.hoursKind ?? null,
		onCallWeeklyMinutes: resolved.onCallTerms?.weeklyMinutes ?? null,
		onCallDailyMinutes: resolved.onCallTerms?.dailyMinutes ?? null,
		contractType: resolved.contractType,
		hourlyRate: resolved.hourlyRate,
		currency: resolved.currency,
		employmentProfile: resolved.employmentProfile,
		arbzgScope: resolved.arbzgScope,
		divergedFields,
	};
}

function customDaysEqual(a: readonly CustomWorkDay[], b: readonly CustomWorkDay[]): boolean {
	if (a.length !== b.length) return false;
	const sortDays = (days: readonly CustomWorkDay[]) =>
		[...days].sort((l, r) => l.dayOfWeek.localeCompare(r.dayOfWeek));
	const sa = sortDays(a);
	const sb = sortDays(b);
	for (let i = 0; i < sa.length; i++) {
		if (
			sa[i].dayOfWeek !== sb[i].dayOfWeek ||
			sa[i].minutesPerDay !== sb[i].minutesPerDay ||
			sa[i].isWorkDay !== sb[i].isWorkDay ||
			(sa[i].latestClockIn ?? null) !== (sb[i].latestClockIn ?? null)
		) {
			return false;
		}
	}
	return true;
}

interface LoadedTemplateVersionSnapshot {
	readonly id: string;
	readonly workPolicyId: string | null;
	readonly weeklyContractMinutes: number | null;
	readonly scheduleMode: ScheduleMode;
	readonly workModel: WorkModel | null;
	readonly presenceOverride: PresenceOverride;
	readonly balanceMode: BalanceMode;
	readonly scheduleSource: ScheduleSource;
	readonly defaultContractType: ContractType | null;
	readonly defaultEmploymentProfile: EmploymentProfile | null;
	readonly defaultArbzgScope: ArbzgScope | null;
	readonly defaultOnCallHoursKind: OnCallHoursKind | null;
	readonly defaultOnCallWeeklyMinutes: number | null;
	readonly defaultOnCallDailyMinutes: number | null;
	readonly defaultHourlyRate: number | null;
	readonly defaultCurrency: string | null;
	readonly customDays: readonly CustomWorkDay[];
}

async function loadTemplateVersionSnapshot(
	db: Pick<DatabaseClient, "select">,
	organizationId: string,
	templateVersionId: string,
): Promise<LoadedTemplateVersionSnapshot> {
	const [version] = await db
		.select()
		.from(contractTemplateVersion)
		.where(
			and(
				eq(contractTemplateVersion.id, templateVersionId),
				eq(contractTemplateVersion.organizationId, organizationId),
			),
		)
		.limit(1);
	if (!version) {
		throw new NotFoundError({
			message: "Contract template version not found",
			entityType: "contract_template_version",
			entityId: templateVersionId,
		});
	}
	const days = await db
		.select()
		.from(contractTemplateVersionDay)
		.where(
			and(
				eq(contractTemplateVersionDay.organizationId, organizationId),
				eq(contractTemplateVersionDay.templateVersionId, templateVersionId),
			),
		);
	return {
		id: version.id,
		workPolicyId: version.workPolicyId,
		weeklyContractMinutes: version.weeklyContractMinutes,
		scheduleMode: version.scheduleMode,
		workModel: version.workModel,
		presenceOverride: version.presenceOverride,
		balanceMode: version.balanceMode,
		scheduleSource: version.scheduleSource,
		defaultContractType: version.defaultContractType,
		defaultEmploymentProfile: version.defaultEmploymentProfile,
		defaultArbzgScope: version.defaultArbzgScope,
		defaultOnCallHoursKind: version.defaultOnCallHoursKind,
		defaultOnCallWeeklyMinutes: version.defaultOnCallWeeklyMinutes,
		defaultOnCallDailyMinutes: version.defaultOnCallDailyMinutes,
		defaultHourlyRate: version.defaultHourlyRate,
		defaultCurrency: version.defaultCurrency,
		customDays: days.map((d) => ({
			dayOfWeek: d.dayOfWeek,
			minutesPerDay: d.minutesPerDay,
			isWorkDay: d.isWorkDay,
			latestClockIn: d.latestClockIn,
		})),
	};
}

async function findExistingBatchHistoryInTx(
	tx: ContractWriteTx,
	organizationId: string,
	batchItemId: string,
): Promise<{ id: string } | null> {
	const [existing] = await tx
		.select({ id: employeeEmploymentHistory.id })
		.from(employeeEmploymentHistory)
		.where(
			and(
				eq(employeeEmploymentHistory.organizationId, organizationId),
				eq(employeeEmploymentHistory.sourceBatchItemId, batchItemId),
			),
		)
		.limit(1);
	return existing ?? null;
}

async function lockClaimableBatchItemInTx(
	tx: ContractWriteTx,
	organizationId: string,
	itemId: string,
): Promise<
	| { readonly claimable: true }
	| {
			readonly claimable: false;
			readonly status: ContractChangeBatchItemStatus;
			readonly result: Record<string, unknown> | null;
	  }
> {
	const [row] = await tx
		.select({
			status: contractChangeBatchItem.status,
			result: contractChangeBatchItem.result,
		})
		.from(contractChangeBatchItem)
		.where(
			and(
				eq(contractChangeBatchItem.id, itemId),
				eq(contractChangeBatchItem.organizationId, organizationId),
			),
		)
		.for("update");

	if (!row) {
		return { claimable: false, status: "skipped", result: null };
	}
	if (row.status !== "pending" && row.status !== "running") {
		return {
			claimable: false,
			status: row.status,
			result: (row.result as Record<string, unknown> | null) ?? null,
		};
	}
	return { claimable: true };
}

async function markBatchItemOutcomeInTx(
	tx: ContractWriteTx,
	input: {
		organizationId: string;
		itemId: string;
		status: "completed" | "skipped" | "failed";
		result?: Record<string, unknown> | null;
		errorCode?: string | null;
		errorMessage?: string | null;
		now: Date;
	},
): Promise<boolean> {
	const updated = await tx
		.update(contractChangeBatchItem)
		.set({
			status: input.status,
			result: input.result ?? null,
			errorCode: input.errorCode ?? null,
			errorMessage: input.errorMessage ?? null,
			attemptCount: sql`${contractChangeBatchItem.attemptCount} + 1`,
			processedAt: input.now,
			updatedAt: input.now,
		})
		.where(
			and(
				eq(contractChangeBatchItem.id, input.itemId),
				eq(contractChangeBatchItem.organizationId, input.organizationId),
				inArray(contractChangeBatchItem.status, ["pending", "running"]),
			),
		)
		.returning({ id: contractChangeBatchItem.id });
	return updated.length > 0;
}

function isSourceBatchItemUniqueViolation(error: unknown): boolean {
	let cursor: unknown = error;
	const seen = new Set<unknown>();
	while (cursor && typeof cursor === "object" && !seen.has(cursor)) {
		seen.add(cursor);
		const candidate = cursor as {
			code?: unknown;
			constraint?: unknown;
			detail?: unknown;
			message?: unknown;
			cause?: unknown;
		};
		if (candidate.code === "23505") {
			const hay =
				`${String(candidate.constraint ?? "")} ${String(candidate.detail ?? "")} ${String(candidate.message ?? "")}`.toLowerCase();
			if (hay.includes("source_batch_item_id") || hay.includes("batch_item")) {
				return true;
			}
		}
		cursor = candidate.cause;
	}
	return false;
}

async function executeSparseContractMutationInTx(
	tx: ContractWriteTx,
	input: {
		organizationId: string;
		actorUserId: string;
		item: ContractChangeBatchItem;
		effectiveFromDate: string;
		overwritePersonalDivergences: boolean;
		changes: BulkTermsUpdateChanges;
		sourceTemplateVersionId?: string | null;
		now: Date;
	},
): Promise<{
	status: ContractChangeBatchItemStatus;
	result: Record<string, unknown>;
	alreadyTerminal: boolean;
}> {
	// 0. Serialize concurrent runners on the batch item row first (strictly before locking
	//    `employee`), and exit immediately if another runner already finalized this item.
	const lockedItem = await lockClaimableBatchItemInTx(tx, input.organizationId, input.item.id);
	if (!lockedItem.claimable) {
		return {
			status: lockedItem.status,
			result: lockedItem.result ?? {},
			alreadyTerminal: true,
		};
	}

	// A1-20: Acquire the employee row lock BEFORE reading prior sparse state so concurrent
	// contract edits on other fields cannot commit between read and write and be clobbered.
	await tx.execute(sql`
		SELECT id
		FROM employee
		WHERE id = ${input.item.employeeId}::uuid
			AND organization_id = ${input.organizationId}
		FOR UPDATE
	`);

	// 1. Check crash-recovery deduplication FIRST before evaluating current divergences,
	//    because a pre-crash commit for this exact batch item would already appear on the employee!
	const existingHistory = await findExistingBatchHistoryInTx(
		tx,
		input.organizationId,
		input.item.id,
	);
	if (existingHistory) {
		const dedupResult = {
			employmentHistoryId: existingHistory.id,
			deduplicated: true,
		};
		await markBatchItemOutcomeInTx(tx, {
			organizationId: input.organizationId,
			itemId: input.item.id,
			status: "completed",
			result: dedupResult,
			now: input.now,
		});
		return { status: "completed", result: dedupResult, alreadyTerminal: false };
	}

	const prior = await loadPriorSparseStateInTx(tx, {
		organizationId: input.organizationId,
		employeeId: input.item.employeeId,
		effectiveFromDate: input.effectiveFromDate,
	});

	const preserve = !input.overwritePersonalDivergences;
	const preservedDivergenceFields: OperationalDivergenceField[] = [];
	let appliedAnyChange = false;

	const c = input.changes;

	// Work policy
	let nextWorkPolicyId = prior.workPolicyId;
	let nextClearPersonalPolicyPin = false;
	if (c.clearPersonalPolicyPin) {
		if (preserve && prior.divergedFields.has("workPolicy")) {
			preservedDivergenceFields.push("workPolicy");
		} else {
			nextWorkPolicyId = null;
			nextClearPersonalPolicyPin = true;
			if (prior.workPolicyId !== null) appliedAnyChange = true;
		}
	} else if (c.workPolicyId !== undefined) {
		if (preserve && prior.divergedFields.has("workPolicy")) {
			preservedDivergenceFields.push("workPolicy");
		} else {
			nextWorkPolicyId = c.workPolicyId;
			if (c.workPolicyId === null && input.overwritePersonalDivergences) {
				nextClearPersonalPolicyPin = true;
			}
			if (nextWorkPolicyId !== prior.workPolicyId || nextClearPersonalPolicyPin) {
				appliedAnyChange = true;
			}
		}
	}

	// Weekly contract minutes
	let nextWeeklyContractMinutes = prior.weeklyContractMinutes;
	if (c.weeklyContractMinutes !== undefined) {
		if (preserve && prior.divergedFields.has("weeklyContractMinutes")) {
			preservedDivergenceFields.push("weeklyContractMinutes");
		} else {
			nextWeeklyContractMinutes = c.weeklyContractMinutes;
			if (nextWeeklyContractMinutes !== prior.weeklyContractMinutes) appliedAnyChange = true;
		}
	}

	// Schedule mode & custom days
	let nextScheduleMode = prior.scheduleMode;
	let nextCustomDays: readonly CustomWorkDay[] | null =
		prior.scheduleMode === "custom_days" ? prior.customDays : null;
	if (c.scheduleMode !== undefined || c.customDays !== undefined) {
		if (preserve && prior.divergedFields.has("scheduleMode")) {
			preservedDivergenceFields.push("scheduleMode");
		} else {
			if (c.scheduleMode !== undefined) {
				nextScheduleMode = c.scheduleMode;
			}
			if (nextScheduleMode === "custom_days") {
				nextCustomDays = c.customDays ?? prior.customDays;
			} else {
				nextCustomDays = null;
			}
			if (
				nextScheduleMode !== prior.scheduleMode ||
				(nextScheduleMode === "custom_days" &&
					!customDaysEqual(nextCustomDays ?? [], prior.customDays))
			) {
				appliedAnyChange = true;
			}
		}
	}

	// Work model
	let nextWorkModel = prior.workModel;
	if (c.workModel !== undefined) {
		if (preserve && prior.divergedFields.has("workModel")) {
			preservedDivergenceFields.push("workModel");
		} else {
			nextWorkModel = c.workModel;
			if (nextWorkModel !== prior.workModel) appliedAnyChange = true;
		}
	}

	// Presence override (note: if workModel became 'remote' and presenceOverride wasn't explicitly diverged/set, let commitContractChangeInTx apply remote exempt default)
	let nextPresenceOverride: PresenceOverride | null | undefined = prior.presenceOverride;
	if (c.presenceOverride !== undefined) {
		if (preserve && prior.divergedFields.has("presenceOverride")) {
			preservedDivergenceFields.push("presenceOverride");
		} else {
			nextPresenceOverride = c.presenceOverride;
			if (nextPresenceOverride !== prior.presenceOverride) appliedAnyChange = true;
		}
	} else if (c.workModel === "remote" && !prior.divergedFields.has("presenceOverride")) {
		nextPresenceOverride = undefined;
	}

	// Balance mode
	let nextBalanceMode = prior.balanceMode;
	if (c.balanceMode !== undefined) {
		if (preserve && prior.divergedFields.has("balanceMode")) {
			preservedDivergenceFields.push("balanceMode");
		} else {
			nextBalanceMode = c.balanceMode;
			if (nextBalanceMode !== prior.balanceMode) appliedAnyChange = true;
		}
	}

	// Schedule source & on-call terms
	let nextScheduleSource = prior.scheduleSource;
	if (c.scheduleSource !== undefined) {
		if (preserve && prior.divergedFields.has("scheduleSource")) {
			preservedDivergenceFields.push("scheduleSource");
		} else {
			nextScheduleSource = c.scheduleSource;
			if (nextScheduleSource !== prior.scheduleSource) appliedAnyChange = true;
		}
	}

	let nextOnCallHoursKind: OnCallHoursKind | null = null;
	let nextOnCallWeeklyMinutes: number | null = null;
	let nextOnCallDailyMinutes: number | null = null;
	if (nextScheduleSource === "on_call") {
		nextOnCallHoursKind =
			c.onCallHoursKind !== undefined ? c.onCallHoursKind : prior.onCallHoursKind;
		nextOnCallWeeklyMinutes =
			c.onCallWeeklyMinutes !== undefined ? c.onCallWeeklyMinutes : prior.onCallWeeklyMinutes;
		nextOnCallDailyMinutes =
			c.onCallDailyMinutes !== undefined ? c.onCallDailyMinutes : prior.onCallDailyMinutes;
		if (
			nextOnCallHoursKind !== prior.onCallHoursKind ||
			nextOnCallWeeklyMinutes !== prior.onCallWeeklyMinutes ||
			nextOnCallDailyMinutes !== prior.onCallDailyMinutes
		) {
			appliedAnyChange = true;
		}
	}

	// Employee-owned legal/pay terms (not operational divergences; always applied when specified)
	if (
		(c.contractType !== undefined && c.contractType !== prior.contractType) ||
		(c.hourlyRate !== undefined && c.hourlyRate !== prior.hourlyRate) ||
		(c.currency !== undefined && c.currency !== prior.currency) ||
		(c.employmentProfile !== undefined && c.employmentProfile !== prior.employmentProfile) ||
		(c.arbzgScope !== undefined && c.arbzgScope !== prior.arbzgScope)
	) {
		appliedAnyChange = true;
	}

	if (!appliedAnyChange && preservedDivergenceFields.length > 0) {
		const skippedResult = {
			reason: "preserved_personal_divergences",
			preservedDivergenceFields,
		};
		await markBatchItemOutcomeInTx(tx, {
			organizationId: input.organizationId,
			itemId: input.item.id,
			status: "skipped",
			result: skippedResult,
			now: input.now,
		});
		return { status: "skipped", result: skippedResult, alreadyTerminal: false };
	}

	const commitResult = await commitContractChangeInTx(tx, {
		organizationId: input.organizationId,
		employeeId: input.item.employeeId,
		actorUserId: input.actorUserId,
		validFromDate: input.effectiveFromDate,
		reviewState: "confirmed",
		workPolicyId: nextWorkPolicyId,
		weeklyContractMinutes: nextWeeklyContractMinutes,
		scheduleMode: nextScheduleMode,
		customDays: nextCustomDays,
		workModel: nextWorkModel,
		presenceOverride: nextPresenceOverride,
		balanceMode: nextBalanceMode,
		scheduleSource: nextScheduleSource,
		contractType: c.contractType,
		hourlyRate: c.hourlyRate,
		currency: c.currency,
		employmentProfile: c.employmentProfile,
		arbzgScope: c.arbzgScope,
		onCallHoursKind: nextOnCallHoursKind,
		onCallWeeklyMinutes: nextOnCallWeeklyMinutes,
		onCallDailyMinutes: nextOnCallDailyMinutes,
		changeReason: c.changeReason ?? null,
		sourceTemplateVersionId: input.sourceTemplateVersionId ?? null,
		sourceBatchItemId: input.item.id,
		clearPersonalPolicyPin: nextClearPersonalPolicyPin,
		now: input.now,
	});

	const completedResult = {
		employmentHistoryId: commitResult.employmentHistory.id,
		workPolicyAssignmentId: commitResult.workPolicyAssignmentId,
		deduplicated: commitResult.deduplicated,
		mismatchConflictRecorded: commitResult.mismatchConflictRecorded,
		preservedDivergenceFields,
	};
	await markBatchItemOutcomeInTx(tx, {
		organizationId: input.organizationId,
		itemId: input.item.id,
		status: "completed",
		result: completedResult,
		now: input.now,
	});
	return { status: "completed", result: completedResult, alreadyTerminal: false };
}

function buildTemplateChanges(
	templateVersion: LoadedTemplateVersionSnapshot,
	changeReason: string | null,
): BulkTermsUpdateChanges {
	return {
		...(templateVersion.workPolicyId !== null
			? { workPolicyId: templateVersion.workPolicyId }
			: {}),
		...(templateVersion.weeklyContractMinutes !== null
			? { weeklyContractMinutes: templateVersion.weeklyContractMinutes }
			: {}),
		scheduleMode: templateVersion.scheduleMode,
		...(templateVersion.scheduleMode === "custom_days"
			? { customDays: templateVersion.customDays }
			: {}),
		...(templateVersion.workModel !== null ? { workModel: templateVersion.workModel } : {}),
		...(templateVersion.presenceOverride !== "inherit"
			? { presenceOverride: templateVersion.presenceOverride }
			: {}),
		balanceMode: templateVersion.balanceMode,
		scheduleSource: templateVersion.scheduleSource,
		...(templateVersion.defaultContractType !== null
			? { contractType: templateVersion.defaultContractType }
			: {}),
		...(templateVersion.defaultHourlyRate !== null
			? { hourlyRate: templateVersion.defaultHourlyRate }
			: {}),
		...(templateVersion.defaultCurrency !== null
			? { currency: templateVersion.defaultCurrency }
			: {}),
		...(templateVersion.defaultEmploymentProfile !== null
			? { employmentProfile: templateVersion.defaultEmploymentProfile }
			: {}),
		...(templateVersion.defaultArbzgScope !== null
			? { arbzgScope: templateVersion.defaultArbzgScope }
			: {}),
		...(templateVersion.scheduleSource === "on_call"
			? {
					onCallHoursKind: templateVersion.defaultOnCallHoursKind,
					onCallWeeklyMinutes: templateVersion.defaultOnCallWeeklyMinutes,
					onCallDailyMinutes: templateVersion.defaultOnCallDailyMinutes,
				}
			: {}),
		changeReason,
	};
}

function extractErrorDetails(error: unknown): { code: string; message: string } {
	if (
		error instanceof Error &&
		error.name === "DepartureCommandError" &&
		"code" in error &&
		typeof error.code === "string"
	) {
		return { code: error.code, message: error.message };
	}
	if (error instanceof ValidationError) {
		return { code: error.refusal ?? "validation_error", message: error.message };
	}
	if (error instanceof NotFoundError) {
		return { code: "not_found", message: error.message };
	}
	if (error instanceof ConflictError) {
		return { code: error.conflictType, message: error.message };
	}
	if (error instanceof Error) {
		return { code: "execution_error", message: error.message };
	}
	return { code: "execution_error", message: String(error) };
}

async function computeBatchItemCounts(
	db: Pick<DatabaseClient, "select">,
	organizationId: string,
	batchId: string,
): Promise<{
	pending: number;
	running: number;
	completed: number;
	skipped: number;
	failed: number;
}> {
	const rows = await db
		.select({
			status: contractChangeBatchItem.status,
			count: sql<number>`count(*)::int`,
		})
		.from(contractChangeBatchItem)
		.where(
			and(
				eq(contractChangeBatchItem.organizationId, organizationId),
				eq(contractChangeBatchItem.batchId, batchId),
			),
		)
		.groupBy(contractChangeBatchItem.status);

	const counts = { pending: 0, running: 0, completed: 0, skipped: 0, failed: 0 };
	for (const row of rows) {
		counts[row.status] = Number(row.count);
	}
	return counts;
}

/**
 * Unified durable batch runner executing BOTH `inline` (≤200) and `async` (>200)
 * `contract_change_batch` rows with 60s lease acquisition, heartbeat renewal every
 * 10 processed items, sorted-UUID employee processing, and atomic per-employee
 * deduplication (`source_batch_item_id` / departure `requestId = item.id`).
 */
export async function runContractChangeBatch(
	db: DatabaseClient,
	input: {
		readonly organizationId: string;
		readonly batchId: string;
	} & RunContractChangeBatchOptions,
): Promise<RunContractChangeBatchResult> {
	const nowFn = input.now ?? currentTimestamp;
	const leaseDurationMs = input.leaseDurationMs ?? BATCH_LEASE_DURATION_MS;
	const heartbeatInterval = input.heartbeatIntervalItems ?? BATCH_HEARTBEAT_INTERVAL_ITEMS;

	let leaseToken: string | null = input.existingLeaseToken ?? null;
	let claimedBatch: ContractChangeBatch | null = null;

	if (leaseToken) {
		// Caller (e.g. recovery sweeper) already acquired the lease atomically.
		const [row] = await db
			.select()
			.from(contractChangeBatch)
			.where(
				and(
					eq(contractChangeBatch.id, input.batchId),
					eq(contractChangeBatch.organizationId, input.organizationId),
					eq(contractChangeBatch.leaseToken, leaseToken),
					eq(contractChangeBatch.status, "running"),
				),
			)
			.limit(1);
		claimedBatch = row ?? null;
	} else {
		const claimNow = nowFn();
		const nextLeaseToken = randomUUID();
		const leaseExpiresAt = new Date(claimNow.getTime() + leaseDurationMs);

		claimedBatch = await db.transaction(async (tx) => {
			const locked = await tx.execute<{ id: string }>(sql`
				SELECT id
				FROM contract_change_batch
				WHERE id = ${input.batchId}::uuid
					AND organization_id = ${input.organizationId}
					AND (
						status = 'pending'
						OR (status = 'running' AND (lease_expires_at IS NULL OR lease_expires_at < ${claimNow}))
					)
				FOR UPDATE SKIP LOCKED
			`);

			if (locked.rows.length === 0) {
				return null;
			}

			const [updated] = await tx
				.update(contractChangeBatch)
				.set({
					status: "running",
					leaseToken: nextLeaseToken,
					leaseExpiresAt,
					heartbeatAt: claimNow,
					attemptCount: sql`${contractChangeBatch.attemptCount} + 1`,
					startedAt: sql`COALESCE(${contractChangeBatch.startedAt}, ${claimNow})`,
					updatedAt: claimNow,
				})
				.where(
					and(
						eq(contractChangeBatch.id, input.batchId),
						eq(contractChangeBatch.organizationId, input.organizationId),
					),
				)
				.returning();
			return updated ?? null;
		});

		if (claimedBatch) {
			leaseToken = nextLeaseToken;
		}
	}

	if (!claimedBatch || !leaseToken) {
		const current = await readBatchById(db, input.organizationId, input.batchId);
		if (!current) {
			throw new NotFoundError({
				message: "Contract change batch not found",
				entityType: "contract_change_batch",
				entityId: input.batchId,
			});
		}
		return {
			batchId: input.batchId,
			organizationId: input.organizationId,
			claimed: false,
			abortedEarly: false,
			leaseLost: false,
			processedInThisRun: 0,
			heartbeatsSent: 0,
			batch: current,
		};
	}

	// Preload shared batch-level metadata once (e.g. template version for `bulk_template_apply`)
	let templateSnapshot: LoadedTemplateVersionSnapshot | null = null;
	if (claimedBatch.operationKind === "bulk_template_apply") {
		const batchPayload = claimedBatch.payload as unknown as BulkTemplateApplyBatchPayload;
		templateSnapshot = await loadTemplateVersionSnapshot(
			db,
			input.organizationId,
			batchPayload.templateVersionId,
		);
	}

	let departureCommands: ReturnType<typeof createDepartureCommands> | null = null;
	if (claimedBatch.operationKind === "csv_departure_import") {
		const { EMPLOYEE_OFFBOARDING_RELEASE_READY } = await import("@/lib/employee-lifecycle/release");
		if (!EMPLOYEE_OFFBOARDING_RELEASE_READY) {
			throw new ValidationError({
				message: "Employee offboarding is not available yet.",
				field: "operationKind",
				refusal: "employee_offboarding_not_released",
			});
		}
		if (input.departureCommands) {
			departureCommands = input.departureCommands;
		} else {
			const [{ createDepartureClockOut }, { createDepartureCommands: makeDepartureCommands }] =
				await Promise.all([
					import("@/lib/employee-lifecycle/clock-out"),
					import("@/lib/employee-lifecycle/commands"),
				]);
			departureCommands = makeDepartureCommands({
				db,
				clock: systemClock,
				clockOut: input.departureClockOut ?? createDepartureClockOut(),
			});
		}
	}

	let processedInThisRun = 0;
	let processedSinceHeartbeat = 0;
	let heartbeatsSent = 0;
	let abortedEarly = false;
	let leaseLost = false;
	let anyContractMutationCompleted = false;

	const sendHeartbeat = async (): Promise<boolean> => {
		const hbNow = nowFn();
		const nextExpiry = new Date(hbNow.getTime() + leaseDurationMs);
		const counts = await computeBatchItemCounts(db, input.organizationId, input.batchId);
		const updated = await db
			.update(contractChangeBatch)
			.set({
				leaseExpiresAt: nextExpiry,
				heartbeatAt: hbNow,
				completedItems: counts.completed,
				failedItems: counts.failed,
				skippedItems: counts.skipped,
				updatedAt: hbNow,
			})
			.where(
				and(
					eq(contractChangeBatch.id, input.batchId),
					eq(contractChangeBatch.organizationId, input.organizationId),
					eq(contractChangeBatch.leaseToken, leaseToken),
					eq(contractChangeBatch.status, "running"),
				),
			)
			.returning({ id: contractChangeBatch.id });

		if (updated.length === 0) {
			leaseLost = true;
			return false;
		}
		heartbeatsSent += 1;
		input.onHeartbeat?.({
			batchId: input.batchId,
			leaseToken,
			processedInThisRun,
			leaseExpiresAt: nextExpiry,
		});
		return true;
	};

	while (!abortedEarly && !leaseLost) {
		const chunk = await db
			.select()
			.from(contractChangeBatchItem)
			.where(
				and(
					eq(contractChangeBatchItem.organizationId, input.organizationId),
					eq(contractChangeBatchItem.batchId, input.batchId),
					inArray(contractChangeBatchItem.status, ["pending", "running"]),
				),
			)
			.orderBy(asc(contractChangeBatchItem.employeeId))
			.limit(ITEM_FETCH_CHUNK_SIZE);

		if (chunk.length === 0) {
			break;
		}

		for (const item of chunk) {
			const itemNow = nowFn();
			let itemStatus: ContractChangeBatchItemStatus = "completed";
			let encounteredTerminalItem = false;

			try {
				if (claimedBatch.operationKind === "bulk_template_apply") {
					const batchPayload = claimedBatch.payload as unknown as BulkTemplateApplyBatchPayload;
					if (!templateSnapshot) {
						throw new Error("Template snapshot missing for bulk_template_apply");
					}
					const effectiveFromDate = parseIsoCalendarDate(
						batchPayload.effectiveFromDate,
						"effectiveFromDate",
					);
					const outcome = await db.transaction((tx) =>
						executeSparseContractMutationInTx(tx, {
							organizationId: input.organizationId,
							actorUserId: claimedBatch.createdBy,
							item,
							effectiveFromDate,
							overwritePersonalDivergences: batchPayload.overwritePersonalDivergences,
							changes: buildTemplateChanges(templateSnapshot, batchPayload.changeReason),
							sourceTemplateVersionId: templateSnapshot.id,
							now: itemNow,
						}),
					);
					itemStatus = outcome.status;
					if (outcome.alreadyTerminal) {
						encounteredTerminalItem = true;
					} else if (outcome.status === "completed") {
						anyContractMutationCompleted = true;
					}
				} else if (claimedBatch.operationKind === "bulk_adopt_default") {
					const batchPayload = claimedBatch.payload as unknown as BulkAdoptDefaultBatchPayload;
					const effectiveFromDate = parseIsoCalendarDate(
						batchPayload.effectiveFromDate,
						"effectiveFromDate",
					);
					const adoptOutcome = await db.transaction(async (tx) => {
						const lockedItem = await lockClaimableBatchItemInTx(tx, input.organizationId, item.id);
						if (!lockedItem.claimable) {
							return { status: lockedItem.status, alreadyTerminal: true };
						}
						// Lock employee before rechecking eligibility and committing adoption (A1-19).
						await tx.execute(sql`
							SELECT id
							FROM employee
							WHERE id = ${item.employeeId}::uuid
								AND organization_id = ${input.organizationId}
							FOR UPDATE
						`);
						const existingHistory = await findExistingBatchHistoryInTx(
							tx,
							input.organizationId,
							item.id,
						);
						if (existingHistory) {
							await markBatchItemOutcomeInTx(tx, {
								organizationId: input.organizationId,
								itemId: item.id,
								status: "completed",
								result: {
									employmentHistoryId: existingHistory.id,
									deduplicated: true,
								},
								now: itemNow,
							});
							return { status: "completed" as const, alreadyTerminal: false };
						}
						if (batchPayload.onlyLegacyTerms) {
							// A2-3 / A3-9: Evaluate migrated_legacy_terms strictly on the winning confirmed
							// terms row (matching resolve-contract.ts timeline truncation: the latest row with
							// valid_from_date <= effectiveFromDate in the active period scope must still cover
							// effectiveFromDate and have migrated_legacy_terms = true).
							const winningTerms = await tx.execute<{ is_legacy: boolean }>(sql`
								SELECT (
									(w.valid_until_date IS NULL OR w.valid_until_date > ${effectiveFromDate}::date)
									AND w.migrated_legacy_terms = true
								) AS is_legacy
								FROM (
									SELECT h.valid_until_date, h.migrated_legacy_terms
									FROM employee_employment_history h
									LEFT JOIN employee_employment_period open_p
										ON open_p.organization_id = h.organization_id
										AND open_p.employee_id = h.employee_id
										AND open_p.status = 'open'
									WHERE h.organization_id = ${input.organizationId}
										AND h.employee_id = ${item.employeeId}::uuid
										AND h.review_state = 'confirmed'
										AND h.valid_from_date <= ${effectiveFromDate}::date
										AND (
											(open_p.id IS NOT NULL AND h.employment_period_id = open_p.id)
											OR (
												h.employment_period_id IS NULL
												AND NOT EXISTS (
													SELECT 1
													FROM employee_employment_history ps
													WHERE ps.organization_id = h.organization_id
														AND ps.employee_id = h.employee_id
														AND ps.review_state = 'confirmed'
														AND open_p.id IS NOT NULL
														AND ps.employment_period_id = open_p.id
												)
											)
											OR open_p.id IS NULL
										)
									ORDER BY h.valid_from_date DESC, h.created_at DESC, h.id DESC
									LIMIT 1
								) w
							`);
							if (winningTerms.rows[0]?.is_legacy !== true) {
								await markBatchItemOutcomeInTx(tx, {
									organizationId: input.organizationId,
									itemId: item.id,
									status: "skipped",
									result: { reason: "not_legacy_terms" },
									now: itemNow,
								});
								return { status: "skipped" as const, alreadyTerminal: false };
							}
						}
						const commitResult = await adoptContractDefaultInTx(tx, {
							organizationId: input.organizationId,
							employeeId: item.employeeId,
							actorUserId: claimedBatch.createdBy,
							effectiveFromDate,
							keepDivergenceFields: batchPayload.keepDivergenceFields,
							changeReason: batchPayload.changeReason,
							sourceBatchItemId: item.id,
							now: itemNow,
						});
						await markBatchItemOutcomeInTx(tx, {
							organizationId: input.organizationId,
							itemId: item.id,
							status: "completed",
							result: {
								employmentHistoryId: commitResult.employmentHistory.id,
								workPolicyAssignmentId: commitResult.workPolicyAssignmentId,
								deduplicated: commitResult.deduplicated,
							},
							now: itemNow,
						});
						return { status: "completed" as const, alreadyTerminal: false };
					});
					itemStatus = adoptOutcome.status;
					if (adoptOutcome.alreadyTerminal) {
						encounteredTerminalItem = true;
					} else if (adoptOutcome.status === "completed") {
						anyContractMutationCompleted = true;
					}
				} else if (claimedBatch.operationKind === "bulk_terms_update") {
					const batchPayload = claimedBatch.payload as unknown as BulkTermsUpdateBatchPayload;
					const effectiveFromDate = parseIsoCalendarDate(
						batchPayload.effectiveFromDate,
						"effectiveFromDate",
					);
					const outcome = await db.transaction((tx) =>
						executeSparseContractMutationInTx(tx, {
							organizationId: input.organizationId,
							actorUserId: claimedBatch.createdBy,
							item,
							effectiveFromDate,
							overwritePersonalDivergences: batchPayload.overwritePersonalDivergences,
							changes: {
								...batchPayload.changes,
								changeReason: batchPayload.changes.changeReason ?? batchPayload.changeReason,
							},
							now: itemNow,
						}),
					);
					itemStatus = outcome.status;
					if (outcome.alreadyTerminal) {
						encounteredTerminalItem = true;
					} else if (outcome.status === "completed") {
						anyContractMutationCompleted = true;
					}
				} else if (claimedBatch.operationKind === "csv_contract_import") {
					const itemPayload = item.payload as unknown as CsvContractBatchItemPayload;
					const effectiveFromDate = parseIsoCalendarDate(
						itemPayload.effectiveFromDate,
						"effectiveFromDate",
					);
					const outcome = await db.transaction((tx) =>
						executeSparseContractMutationInTx(tx, {
							organizationId: input.organizationId,
							actorUserId: claimedBatch.createdBy,
							item,
							effectiveFromDate,
							overwritePersonalDivergences: itemPayload.overwritePersonalDivergences,
							changes: itemPayload.changes,
							now: itemNow,
						}),
					);
					itemStatus = outcome.status;
					if (outcome.alreadyTerminal) {
						encounteredTerminalItem = true;
					} else if (outcome.status === "completed") {
						anyContractMutationCompleted = true;
					}
				} else if (claimedBatch.operationKind === "csv_departure_import") {
					if (!departureCommands) {
						throw new Error("Departure commands missing for csv_departure_import");
					}
					const itemPayload = item.payload as unknown as CsvDepartureBatchItemPayload;
					const actor: LifecycleActor = {
						userId: claimedBatch.createdBy,
						organizationId: input.organizationId,
					};

					const [currentItemRow] = await db
						.select({ status: contractChangeBatchItem.status })
						.from(contractChangeBatchItem)
						.where(
							and(
								eq(contractChangeBatchItem.id, item.id),
								eq(contractChangeBatchItem.organizationId, input.organizationId),
							),
						)
						.limit(1);

					if (
						!currentItemRow ||
						(currentItemRow.status !== "pending" && currentItemRow.status !== "running")
					) {
						itemStatus = currentItemRow?.status ?? "skipped";
						encounteredTerminalItem = true;
					} else if (itemPayload.action === "skip_unchanged") {
						const updated = await db.transaction((tx) =>
							markBatchItemOutcomeInTx(tx, {
								organizationId: input.organizationId,
								itemId: item.id,
								status: "skipped",
								result: { action: "skip_unchanged", lastWorkingDay: itemPayload.lastWorkingDay },
								now: itemNow,
							}),
						);
						itemStatus = "skipped";
						if (!updated) encounteredTerminalItem = true;
					} else if (itemPayload.action === "schedule_departure") {
						const res = await departureCommands.scheduleDeparture(actor, {
							employeeId: item.employeeId,
							requestId: item.id,
							expectedRevision: itemPayload.expectedRevision ?? null,
							lastWorkingDay: itemPayload.lastWorkingDay,
							replacementEmployeeId: itemPayload.replacementEmployeeId,
							acknowledgeUnassignedDuties: itemPayload.acknowledgeUnassignedDuties,
						});
						const updated = await db.transaction((tx) =>
							markBatchItemOutcomeInTx(tx, {
								organizationId: input.organizationId,
								itemId: item.id,
								status: "completed",
								result: { action: "schedule_departure", ...res },
								now: itemNow,
							}),
						);
						itemStatus = "completed";
						if (!updated) encounteredTerminalItem = true;
					} else if (itemPayload.action === "offboard_immediately") {
						const res = await departureCommands.offboardImmediately(actor, {
							employeeId: item.employeeId,
							requestId: item.id,
							replacementEmployeeId: itemPayload.replacementEmployeeId,
							acknowledgeUnassignedDuties: itemPayload.acknowledgeUnassignedDuties,
						});
						if (res.status === "blocked") {
							const updated = await db.transaction((tx) =>
								markBatchItemOutcomeInTx(tx, {
									organizationId: input.organizationId,
									itemId: item.id,
									status: "failed",
									errorCode: res.reason,
									errorMessage: `Departure blocked: ${res.reason}`,
									result: { action: "offboard_immediately", ...res },
									now: itemNow,
								}),
							);
							itemStatus = "failed";
							if (!updated) encounteredTerminalItem = true;
						} else {
							const updated = await db.transaction((tx) =>
								markBatchItemOutcomeInTx(tx, {
									organizationId: input.organizationId,
									itemId: item.id,
									status: "completed",
									result: { action: "offboard_immediately", ...res },
									now: itemNow,
								}),
							);
							itemStatus = "completed";
							if (!updated) encounteredTerminalItem = true;
						}
					} else if (itemPayload.action === "record_past_departure") {
						const res = await departureCommands.recordPastDeparture(actor, {
							employeeId: item.employeeId,
							requestId: item.id,
							lastWorkingDay: itemPayload.lastWorkingDay,
							replacementEmployeeId: itemPayload.replacementEmployeeId,
							acknowledgeUnassignedDuties: itemPayload.acknowledgeUnassignedDuties,
						});
						if (res.status === "blocked") {
							const updated = await db.transaction((tx) =>
								markBatchItemOutcomeInTx(tx, {
									organizationId: input.organizationId,
									itemId: item.id,
									status: "failed",
									errorCode: res.reason,
									errorMessage: `Retrospective departure blocked: ${res.reason}`,
									result: { action: "record_past_departure", ...res },
									now: itemNow,
								}),
							);
							itemStatus = "failed";
							if (!updated) encounteredTerminalItem = true;
						} else {
							const updated = await db.transaction((tx) =>
								markBatchItemOutcomeInTx(tx, {
									organizationId: input.organizationId,
									itemId: item.id,
									status: "completed",
									result: { action: "record_past_departure", ...res },
									now: itemNow,
								}),
							);
							itemStatus = "completed";
							if (!updated) encounteredTerminalItem = true;
						}
					} else if (itemPayload.action === "correct_past_departure_date") {
						if (!itemPayload.expectedDepartureId || itemPayload.expectedRevision === null) {
							throw new ValidationError({
								message: "Missing effective departure metadata for past-date correction.",
								refusal: "departure_revision_conflict",
							});
						}
						const res = await departureCommands.correctPastDepartureDate(actor, {
							employeeId: item.employeeId,
							departureId: itemPayload.expectedDepartureId,
							expectedRevision: itemPayload.expectedRevision,
							lastWorkingDay: itemPayload.lastWorkingDay,
							requestId: item.id,
							reason: itemPayload.reason,
						});
						const updated = await db.transaction((tx) =>
							markBatchItemOutcomeInTx(tx, {
								organizationId: input.organizationId,
								itemId: item.id,
								status: "completed",
								result: { action: "correct_past_departure_date", ...res },
								now: itemNow,
							}),
						);
						itemStatus = "completed";
						if (!updated) encounteredTerminalItem = true;
					} else if (itemPayload.action === "record_historical_departure_date") {
						const res = await departureCommands.recordHistoricalDepartureDate(actor, {
							employeeId: item.employeeId,
							lastWorkingDay: itemPayload.lastWorkingDay,
							requestId: item.id,
							reason: itemPayload.reason,
						});
						const updated = await db.transaction((tx) =>
							markBatchItemOutcomeInTx(tx, {
								organizationId: input.organizationId,
								itemId: item.id,
								status: "completed",
								result: { action: "record_historical_departure_date", ...res },
								now: itemNow,
							}),
						);
						itemStatus = "completed";
						if (!updated) encounteredTerminalItem = true;
					}
				}
			} catch (itemError) {
				if (isSourceBatchItemUniqueViolation(itemError)) {
					const deduped = await db.transaction(async (tx) => {
						const lockedItem = await lockClaimableBatchItemInTx(tx, input.organizationId, item.id);
						if (!lockedItem.claimable) {
							return { status: lockedItem.status, alreadyTerminal: true };
						}
						const existingHistory = await findExistingBatchHistoryInTx(
							tx,
							input.organizationId,
							item.id,
						);
						if (!existingHistory) {
							return null;
						}
						const updated = await markBatchItemOutcomeInTx(tx, {
							organizationId: input.organizationId,
							itemId: item.id,
							status: "completed",
							result: {
								employmentHistoryId: existingHistory.id,
								deduplicated: true,
							},
							now: itemNow,
						});
						return { status: "completed" as const, alreadyTerminal: !updated };
					});
					if (deduped) {
						itemStatus = deduped.status;
						if (deduped.alreadyTerminal) {
							encounteredTerminalItem = true;
						}
					} else {
						const { code, message } = extractErrorDetails(itemError);
						itemStatus = "failed";
						const updated = await db.transaction((tx) =>
							markBatchItemOutcomeInTx(tx, {
								organizationId: input.organizationId,
								itemId: item.id,
								status: "failed",
								errorCode: code,
								errorMessage: message,
								now: itemNow,
							}),
						);
						if (!updated) encounteredTerminalItem = true;
					}
				} else {
					const { code, message } = extractErrorDetails(itemError);
					itemStatus = "failed";
					const updated = await db.transaction((tx) =>
						markBatchItemOutcomeInTx(tx, {
							organizationId: input.organizationId,
							itemId: item.id,
							status: "failed",
							errorCode: code,
							errorMessage: message,
							now: itemNow,
						}),
					);
					if (!updated) encounteredTerminalItem = true;
				}
			}

			if (encounteredTerminalItem) {
				const stillOwnsLease = await sendHeartbeat();
				processedSinceHeartbeat = 0;
				if (!stillOwnsLease) {
					break;
				}
				continue;
			}

			processedInThisRun += 1;
			processedSinceHeartbeat += 1;

			if (processedSinceHeartbeat >= heartbeatInterval) {
				const stillOwnsLease = await sendHeartbeat();
				processedSinceHeartbeat = 0;
				if (!stillOwnsLease) {
					break;
				}
			}

			if (input.onAfterItemProcessed) {
				const hookOutcome = await input.onAfterItemProcessed({
					batchId: input.batchId,
					itemId: item.id,
					employeeId: item.employeeId,
					processedInThisRun,
					status: itemStatus,
				});
				if (hookOutcome?.stopExecution) {
					abortedEarly = true;
					break;
				}
			}
		}

		if (!abortedEarly && !leaseLost && processedSinceHeartbeat > 0) {
			const stillOwnsLease = await sendHeartbeat();
			processedSinceHeartbeat = 0;
			if (!stillOwnsLease) {
				break;
			}
		}
	}

	if (!abortedEarly && !leaseLost) {
		const finalNow = nowFn();
		const counts = await computeBatchItemCounts(db, input.organizationId, input.batchId);
		if (counts.pending === 0 && counts.running === 0) {
			const finalStatus: ContractChangeBatchStatus =
				counts.failed === 0
					? "completed"
					: counts.completed > 0 || counts.skipped > 0
						? "completed_with_errors"
						: "failed";

			await db
				.update(contractChangeBatch)
				.set({
					status: finalStatus,
					completedItems: counts.completed,
					failedItems: counts.failed,
					skippedItems: counts.skipped,
					leaseToken: null,
					leaseExpiresAt: null,
					heartbeatAt: finalNow,
					completedAt: finalNow,
					result: {
						totalItems: claimedBatch.totalItems,
						completedItems: counts.completed,
						skippedItems: counts.skipped,
						failedItems: counts.failed,
					},
					updatedAt: finalNow,
				})
				.where(
					and(
						eq(contractChangeBatch.id, input.batchId),
						eq(contractChangeBatch.organizationId, input.organizationId),
						eq(contractChangeBatch.leaseToken, leaseToken),
					),
				);
		}
	}

	if (anyContractMutationCompleted && !input.skipBalanceDirtyNotification) {
		try {
			const { markOrganizationWorkBalancesDirty } = await import("@/lib/work-balance/service");
			await markOrganizationWorkBalancesDirty({ organizationId: input.organizationId });
		} catch {
			// Best-effort post-commit work balance invalidation.
		}
	}

	const finalBatch = await readBatchById(db, input.organizationId, input.batchId);
	if (!finalBatch) {
		throw new NotFoundError({
			message: "Contract change batch not found after run",
			entityType: "contract_change_batch",
			entityId: input.batchId,
		});
	}

	return {
		batchId: input.batchId,
		organizationId: input.organizationId,
		claimed: true,
		abortedEarly,
		leaseLost,
		processedInThisRun,
		heartbeatsSent,
		batch: finalBatch,
	};
}

/**
 * Periodic crash-recovery sweeper claiming stalled `pending` batches older than 10s
 * or `running` batches whose lease has expired (`lease_expires_at < now()`) across
 * BOTH `inline` and `async` execution modes via `FOR UPDATE SKIP LOCKED`, then resuming
 * remaining pending items safely to completion.
 */
export async function runContractChangeBatchRecovery(
	db: DatabaseClient,
	options: {
		readonly now?: () => Date;
		readonly pendingAgeMs?: number;
		readonly leaseDurationMs?: number;
		readonly limit?: number;
		readonly organizationId?: string;
		readonly runnerOptions?: Omit<RunContractChangeBatchOptions, "existingLeaseToken">;
	} = {},
): Promise<ContractChangeBatchRecoveryResult> {
	const nowFn = options.now ?? currentTimestamp;
	const claimNow = nowFn();
	const pendingAgeMs = options.pendingAgeMs ?? RECOVERY_PENDING_AGE_MS;
	const leaseDurationMs = options.leaseDurationMs ?? BATCH_LEASE_DURATION_MS;
	const limit = options.limit ?? 20;
	const pendingCutoff = new Date(claimNow.getTime() - pendingAgeMs);
	const leaseExpiresAt = new Date(claimNow.getTime() + leaseDurationMs);

	const claimedBatches = await db.transaction(async (tx) => {
		const orgFilter = options.organizationId
			? sql`AND organization_id = ${options.organizationId}`
			: sql``;

		const rows = await tx.execute<{ id: string; organization_id: string }>(sql`
			SELECT id, organization_id
			FROM contract_change_batch
			WHERE (
				(status = 'pending' AND created_at <= ${pendingCutoff})
				OR
				(status = 'running' AND (lease_expires_at IS NULL OR lease_expires_at < ${claimNow}))
			)
			${orgFilter}
			ORDER BY created_at ASC, id ASC
			FOR UPDATE SKIP LOCKED
			LIMIT ${limit}
		`);

		const claimed: { id: string; organizationId: string; leaseToken: string }[] = [];
		for (const row of rows.rows) {
			const leaseToken = randomUUID();
			await tx
				.update(contractChangeBatch)
				.set({
					status: "running",
					leaseToken,
					leaseExpiresAt,
					heartbeatAt: claimNow,
					attemptCount: sql`${contractChangeBatch.attemptCount} + 1`,
					startedAt: sql`COALESCE(${contractChangeBatch.startedAt}, ${claimNow})`,
					updatedAt: claimNow,
				})
				.where(
					and(
						eq(contractChangeBatch.id, row.id),
						eq(contractChangeBatch.organizationId, row.organization_id),
					),
				);
			claimed.push({
				id: row.id,
				organizationId: row.organization_id,
				leaseToken,
			});
		}
		return claimed;
	});

	let recovered = 0;
	let completed = 0;
	let completedWithErrors = 0;
	let failed = 0;
	const errors: { batchId: string; organizationId: string; error: string }[] = [];

	for (const batch of claimedBatches) {
		try {
			const outcome = await runContractChangeBatch(db, {
				organizationId: batch.organizationId,
				batchId: batch.id,
				existingLeaseToken: batch.leaseToken,
				now: nowFn,
				leaseDurationMs,
				...options.runnerOptions,
			});
			recovered += 1;
			if (outcome.batch.status === "completed") completed += 1;
			else if (outcome.batch.status === "completed_with_errors") completedWithErrors += 1;
			else if (outcome.batch.status === "failed") failed += 1;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			errors.push({ batchId: batch.id, organizationId: batch.organizationId, error: message });
			await db
				.update(contractChangeBatch)
				.set({
					lastError: message,
					updatedAt: nowFn(),
				})
				.where(
					and(
						eq(contractChangeBatch.id, batch.id),
						eq(contractChangeBatch.organizationId, batch.organizationId),
						eq(contractChangeBatch.leaseToken, batch.leaseToken),
					),
				);
			logger.error(
				{ error, batchId: batch.id, organizationId: batch.organizationId },
				"Failed to recover stalled contract change batch",
			);
		}
	}

	return {
		scanned: claimedBatches.length,
		recovered,
		completed,
		completedWithErrors,
		failed,
		errors,
	};
}

// ============================================
// BATCH LIST & DETAIL QUERIES
// ============================================

export async function listContractChangeBatches(
	db: Pick<DatabaseClient, "select">,
	organizationId: string,
	options: {
		readonly operationKind?: ContractChangeBatchOperationKind;
		readonly status?: ContractChangeBatchStatus;
		readonly limit?: number;
		readonly offset?: number;
	} = {},
): Promise<readonly ContractChangeBatch[]> {
	const limit = Math.min(Math.max(options.limit ?? 25, 1), 100);
	const offset = Math.max(options.offset ?? 0, 0);

	const conditions = [eq(contractChangeBatch.organizationId, organizationId)];
	if (options.operationKind) {
		conditions.push(eq(contractChangeBatch.operationKind, options.operationKind));
	}
	if (options.status) {
		conditions.push(eq(contractChangeBatch.status, options.status));
	}

	return db
		.select()
		.from(contractChangeBatch)
		.where(and(...conditions))
		.orderBy(desc(contractChangeBatch.createdAt), desc(contractChangeBatch.id))
		.limit(limit)
		.offset(offset);
}

export interface ContractChangeBatchDetailItem extends ContractChangeBatchItem {
	readonly employeeFirstName: string | null;
	readonly employeeLastName: string | null;
	readonly employeeNumber: string | null;
}

export interface ContractChangeBatchDetail {
	readonly batch: ContractChangeBatch;
	readonly items: readonly ContractChangeBatchDetailItem[];
	readonly totalMatchingItems: number;
}

export async function getContractChangeBatch(
	db: Pick<DatabaseClient, "select">,
	organizationId: string,
	batchId: string,
	options: {
		readonly itemStatus?: ContractChangeBatchItemStatus;
		readonly limit?: number;
		readonly offset?: number;
	} = {},
): Promise<ContractChangeBatchDetail | null> {
	const batch = await readBatchById(db, organizationId, batchId);
	if (!batch) return null;

	const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
	const offset = Math.max(options.offset ?? 0, 0);

	const itemConditions = [
		eq(contractChangeBatchItem.organizationId, organizationId),
		eq(contractChangeBatchItem.batchId, batchId),
	];
	if (options.itemStatus) {
		itemConditions.push(eq(contractChangeBatchItem.status, options.itemStatus));
	}

	const [countRow, itemRows] = await Promise.all([
		db
			.select({ count: sql<number>`count(*)::int` })
			.from(contractChangeBatchItem)
			.where(and(...itemConditions)),
		db
			.select({
				item: contractChangeBatchItem,
				employeeFirstName: user.firstName,
				employeeLastName: user.lastName,
				employeeNumber: employee.employeeNumber,
			})
			.from(contractChangeBatchItem)
			.leftJoin(
				employee,
				and(
					eq(employee.id, contractChangeBatchItem.employeeId),
					eq(employee.organizationId, contractChangeBatchItem.organizationId),
				),
			)
			.leftJoin(user, eq(user.id, employee.userId))
			.where(and(...itemConditions))
			.orderBy(asc(contractChangeBatchItem.itemIndex))
			.limit(limit)
			.offset(offset),
	]);

	return {
		batch,
		items: itemRows.map((row) => ({
			...row.item,
			employeeFirstName: row.employeeFirstName,
			employeeLastName: row.employeeLastName,
			employeeNumber: row.employeeNumber,
		})),
		totalMatchingItems: Number(countRow[0]?.count ?? 0),
	};
}
