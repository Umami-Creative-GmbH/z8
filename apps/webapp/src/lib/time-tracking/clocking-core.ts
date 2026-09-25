/**
 * Raw canonical clocking: guarded entry/period writes, hash chain, action-id
 * replay and caller-owned transactions. Free of the app database singleton and
 * `server-only`, so transaction-bound callers (employee departures, workers)
 * can use it directly. Request paths use the access-coordinated
 * `clockingService` from `./clocking-service`.
 */
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import type { db } from "@/db";
import { member } from "@/db/auth-schema";
import { employee, timeEntry, workPeriod } from "@/db/schema";
import { dateFromInstant, type Instant, instantFromDate } from "@/lib/datetime/temporal-core";
import type { TimeEntryAppendOperation } from "@/db/schema/time-entry-append";
import type { AppendScope } from "./append-lineage";
import { calculateHash } from "./blockchain";
import {
	type AppendPredecessor,
	admitTimeEntryAppend,
	type TimeEntryAppendAdmissionResult,
	TimeEntryAppendReviewRequiredError,
} from "./time-entry-append";
import type { TimeEntryTimezoneSource } from "./timezone-capture";
import type { WorkTransactionAdmission, WorkTransactionScope } from "./work-transaction";

export { TimeEntryAppendReviewRequiredError } from "./time-entry-append";

export class ClockingConflictError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ClockingConflictError";
	}
}

export class ClockingOrganizationError extends Error {
	constructor() {
		super("Employee does not belong to organization");
		this.name = "ClockingOrganizationError";
	}
}

export class ClockingAccessError extends Error {
	constructor(
		readonly code: "active_membership_required" | "employee_required",
	) {
		super(
			code === "active_membership_required"
				? "Approved active organization membership required"
				: "Active employee record required for the organization",
		);
	}
}

export type ClockingAction = {
	instant: Instant;
	utcOffsetMinutes: number;
	timezone: string;
	timezoneSource: TimeEntryTimezoneSource;
};

export type ClockingInput = {
	employeeId: string;
	organizationId: string;
	createdBy: string;
	actionId?: string;
	action: ClockingAction;
	source: { ipAddress: string | null; deviceInfo: string | null };
	notes?: string;
	location?: string;
	transaction?: unknown;
	coordination?: WorkTransactionScope;
};

type ClockInInput = ClockingInput & {
	workLocationType: "office" | "remote" | "home" | "other";
};
type ClockOutInput = ClockingInput & {
	workPeriodId?: string;
	projectId?: string | null;
	workCategoryId?: string | null;
	canonicalRecordId?: string | null;
	approvalStatus?: "approved" | "pending";
	pendingChanges?: Record<string, unknown> | null;
	beforePeriodClose?: (context: {
		transaction: unknown;
		activePeriod: ActivePeriod;
		durationMinutes: number;
	}) => Promise<Record<string, unknown> | undefined>;
	afterPeriodClose?: (context: {
		transaction: unknown;
		activePeriod: ActivePeriod;
		durationMinutes: number;
		entry: Entry;
		period: { id: string };
	}) => Promise<unknown>;
};

type ActivePeriod = { id: string; startTime: Date };
export type Entry = { id: string; [key: string]: unknown };
type CompletedPeriod = {
	id: string;
	startTime: Date;
	endTime: Date;
	durationMinutes: number;
	projectId: string | null;
	workCategoryId: string | null;
};

export type ClockingStore = {
	transaction?: unknown;
	lockEmployee(employeeId: string): Promise<void>;
	isOrganizationMember(
		employeeId: string,
		organizationId: string,
	): Promise<boolean>;
	getEntryByActionId(
		employeeId: string,
		organizationId: string,
		actionId?: string,
	): Promise<Entry | null>;
	getActivePeriod(
		employeeId: string,
		organizationId: string,
		workPeriodId?: string,
	): Promise<ActivePeriod | null>;
	getCompletedPeriodByClockOutActionId?(
		employeeId: string,
		organizationId: string,
		actionId: string,
		workPeriodId?: string,
	): Promise<CompletedPeriod | null>;
	getLatestHash(
		employeeId: string,
		organizationId: string,
	): Promise<string | null>;
	/** Evidence-based admission; used only when the outer scope has adopted appends. */
	admitAppend?(
		scope: AppendScope,
		operation: TimeEntryAppendOperation,
	): Promise<TimeEntryAppendAdmissionResult>;
	insertEntry(entry: Record<string, unknown>): Promise<Entry>;
	insertActivePeriod(period: Record<string, unknown>): Promise<{ id: string }>;
	closeActivePeriod(
		periodId: string,
		employeeId: string,
		organizationId: string,
		patch: Record<string, unknown>,
	): Promise<{ id: string } | null>;
};

export type ClockingDependencies = {
	transaction<T>(callback: (store: ClockingStore) => Promise<T>): Promise<T>;
	storeForTransaction?: (transaction: unknown) => ClockingStore;
	storeForCoordinatedTransaction?: (
		context: WorkTransactionScope,
	) => ClockingStore;
	findApprovedMembership?: (
		userId: string,
		organizationId: string,
	) => Promise<boolean>;
	findActiveEmployee?: (
		userId: string,
		organizationId: string,
	) => Promise<Pick<
		typeof employee.$inferSelect,
		"id" | "organizationId"
	> | null>;
	/**
	 * Runs under the employee lock, so a clock action that raced a departure
	 * sees it. Throws ClockingAccessError to refuse; a replay of an action that
	 * is already recorded skips it. Transaction-bound system
	 * callers (the departure clock-out itself) omit it.
	 */
	assertEmployeeMayClock?: (
		store: ClockingStore,
		input: { employeeId: string; organizationId: string },
	) => Promise<void>;
};

/**
 * Legacy writers link only the latest-created hash. An admitted append links its
 * exact predecessor, persisted as both the ID and the hash link.
 */
type EntryLink =
	| { kind: "legacy"; previousHash: string | null }
	| { kind: "admitted"; predecessor: AppendPredecessor | null };

function entryValues(input: ClockingInput, type: "clock_in" | "clock_out", link: EntryLink) {
	const timestamp = dateFromInstant(input.action.instant);
	const previousHash =
		link.kind === "admitted" ? (link.predecessor?.hash ?? null) : link.previousHash;
	return {
		...(input.actionId ? { id: input.actionId } : {}),
		...(link.kind === "admitted" ? { previousEntryId: link.predecessor?.id ?? null } : {}),
		employeeId: input.employeeId,
		organizationId: input.organizationId,
		type,
		timestamp,
		hash: calculateHash({
			employeeId: input.employeeId,
			type,
			timestamp: timestamp.toISOString(),
			previousHash,
		}),
		previousHash,
		createdBy: input.createdBy,
		ipAddress: input.source.ipAddress,
		deviceInfo: input.source.deviceInfo,
		notes: input.notes,
		location: input.location,
		utcOffsetMinutes: input.action.utcOffsetMinutes,
		timezone: input.action.timezone,
		timezoneSource: input.action.timezoneSource,
	};
}

/** How a clock entry was linked: the admission mode and the exact predecessor it follows. */
export type AppendedClockEntry = {
	entry: Entry;
	admission: WorkTransactionAdmission;
	previousEntryId: string | null;
	previousHash: string | null;
};

/**
 * Inserts one clock entry under the caller's employee coordination. Legacy
 * admission links the latest-created hash; append admission links the exact
 * predecessor admitted from evidence and advances the append position.
 */
export async function appendClockEntry(
	store: ClockingStore,
	input: ClockingInput,
	type: "clock_in" | "clock_out",
	admission: WorkTransactionAdmission,
): Promise<AppendedClockEntry> {
	if (admission === "append") {
		if (!store.admitAppend) {
			throw new Error("Append admission is unavailable");
		}
		const appendAdmission = await store.admitAppend(
			{ organizationId: input.organizationId, employeeId: input.employeeId },
			type === "clock_in" ? "live_clock_in" : "live_clock_out",
		);
		if (appendAdmission.kind === "review_required") {
			throw new TimeEntryAppendReviewRequiredError(appendAdmission.requirement);
		}
		const values = entryValues(input, type, {
			kind: "admitted",
			predecessor: appendAdmission.append.predecessor,
		});
		const entry = await store.insertEntry(values);
		const previousEntryId = values.previousEntryId ?? null;
		await appendAdmission.append.record({
			id: entry.id,
			hash: values.hash,
			previousEntryId,
			previousHash: values.previousHash,
		});
		return { entry, admission, previousEntryId, previousHash: values.previousHash };
	}
	const values = entryValues(input, type, {
		kind: "legacy",
		previousHash: await store.getLatestHash(input.employeeId, input.organizationId),
	});
	return {
		entry: await store.insertEntry(values),
		admission,
		previousEntryId: null,
		previousHash: values.previousHash,
	};
}

export function createClockingService(deps: ClockingDependencies) {
	async function withinEmployeeTransaction<T>(
		input: ClockingInput,
		callback: (store: ClockingStore) => Promise<T>,
	): Promise<T> {
		const operation = async (store: ClockingStore) => {
			if (input.coordination) {
				input.coordination.assertEmployee(
					input.organizationId,
					input.employeeId,
				);
				if (store.transaction !== input.coordination.db) {
					throw new Error("Clocking transaction context changed");
				}
			} else {
				await store.lockEmployee(input.employeeId);
			}
			if (
				!(await store.isOrganizationMember(
					input.employeeId,
					input.organizationId,
				))
			) {
				throw new ClockingOrganizationError();
			}
			if (deps.assertEmployeeMayClock) {
				// An already-recorded action replays idempotently; only new writes need access.
				const replayed = await store.getEntryByActionId(
					input.employeeId,
					input.organizationId,
					input.actionId,
				);
				if (!replayed) await deps.assertEmployeeMayClock(store, input);
			}
			return callback(store);
		};
		if (input.coordination && input.transaction !== undefined) {
			throw new Error("Clocking accepts only one transaction context");
		}
		if (input.coordination) {
			input.coordination.assertEmployee(input.organizationId, input.employeeId);
			if (!deps.storeForCoordinatedTransaction) {
				throw new Error("Coordinated clocking transactions are unavailable");
			}
			return operation(deps.storeForCoordinatedTransaction(input.coordination));
		}
		if (input.transaction !== undefined) {
			if (!deps.storeForTransaction) {
				throw new Error("Caller-owned clocking transactions are unavailable");
			}
			return operation(deps.storeForTransaction(input.transaction));
		}
		return deps.transaction(operation);
	}

	return {
		requireActor: async (input: {
			userId: string;
			activeOrganizationId: string | null | undefined;
		}) => {
			if (
				!input.activeOrganizationId ||
				!deps.findApprovedMembership ||
				!deps.findActiveEmployee
			) {
				throw new ClockingAccessError("active_membership_required");
			}
			const organizationId = input.activeOrganizationId;
			if (!(await deps.findApprovedMembership(input.userId, organizationId))) {
				throw new ClockingAccessError("active_membership_required");
			}
			const employeeRecord = await deps.findActiveEmployee(
				input.userId,
				organizationId,
			);
			if (!employeeRecord || employeeRecord.organizationId !== organizationId) {
				throw new ClockingAccessError("employee_required");
			}
			return { employee: employeeRecord, organizationId, userId: input.userId };
		},
		clockIn: async (input: ClockInInput) =>
			withinEmployeeTransaction(input, async (store) => {
				const existingEntry = await store.getEntryByActionId(
					input.employeeId,
					input.organizationId,
					input.actionId,
				);
				if (existingEntry) return { entry: existingEntry } as never;
				if (
					await store.getActivePeriod(input.employeeId, input.organizationId)
				) {
					throw new ClockingConflictError("Active work period already exists");
				}
				const { entry } = await appendClockEntry(
					store,
					input,
					"clock_in",
					input.coordination?.admission ?? "legacy",
				);
				const period = await store.insertActivePeriod({
					employeeId: input.employeeId,
					organizationId: input.organizationId,
					clockInId: entry.id,
					startTime: dateFromInstant(input.action.instant),
					isActive: true,
					workLocationType: input.workLocationType,
				});
				return { entry, period };
			}),
		clockOut: async (input: ClockOutInput) =>
			withinEmployeeTransaction(input, async (store) => {
				const existingEntry = await store.getEntryByActionId(
					input.employeeId,
					input.organizationId,
					input.actionId,
				);
				if (existingEntry) {
					if (
						existingEntry.type !== "clock_out" ||
						!input.actionId ||
						!store.getCompletedPeriodByClockOutActionId
					) {
						throw new ClockingConflictError("Clock-out action id collision");
					}
					const period = await store.getCompletedPeriodByClockOutActionId(
						input.employeeId,
						input.organizationId,
						input.actionId,
						input.workPeriodId,
					);
					if (
						!period ||
						period.projectId !== (input.projectId ?? null) ||
						period.workCategoryId !== (input.workCategoryId ?? null)
					) {
						throw new ClockingConflictError("Clock-out action id collision");
					}
					return {
						entry: existingEntry,
						period,
						activePeriod: { id: period.id, startTime: period.startTime },
						durationMinutes: period.durationMinutes,
						transactionResult: undefined,
						disposition: "replayed" as const,
					};
				}
				const activePeriod = await store.getActivePeriod(
					input.employeeId,
					input.organizationId,
					input.workPeriodId,
				);
				if (!activePeriod)
					throw new ClockingConflictError("No active work period found");
				const timestamp = dateFromInstant(input.action.instant);
				const elapsedMinutes = input.action.instant
					.since(instantFromDate(activePeriod.startTime))
					.total({ unit: "minutes" });
				if (elapsedMinutes < 0) {
					throw new ClockingConflictError("Clock-out precedes clock-in");
				}
				const durationMinutes = Math.round(elapsedMinutes);
				if (
					(input.beforePeriodClose || input.afterPeriodClose) &&
					!store.transaction
				) {
					throw new Error("Clock-out transaction context is unavailable");
				}
				const additionalPeriodPatch = input.beforePeriodClose
					? await input.beforePeriodClose({
							transaction: store.transaction,
							activePeriod,
							durationMinutes,
						})
					: undefined;
				const entry = await store.insertEntry(
					entryValues(input, "clock_out", {
						kind: "legacy",
						previousHash: await store.getLatestHash(input.employeeId, input.organizationId),
					}),
				);
				const period = await store.closeActivePeriod(
					activePeriod.id,
					input.employeeId,
					input.organizationId,
					{
						clockOutId: entry.id,
						endTime: timestamp,
						durationMinutes,
						isActive: false,
						projectId: input.projectId ?? null,
						workCategoryId: input.workCategoryId ?? null,
						canonicalRecordId: input.canonicalRecordId ?? null,
						approvalStatus: input.approvalStatus ?? "approved",
						pendingChanges: input.pendingChanges ?? null,
						updatedAt: new Date(),
						...additionalPeriodPatch,
					},
				);
				if (!period)
					throw new ClockingConflictError("Active work period changed");
				const transactionResult = input.afterPeriodClose
					? await input.afterPeriodClose({
							transaction: store.transaction,
							activePeriod,
							durationMinutes,
							entry,
							period,
						})
					: undefined;
				return {
					entry,
					period,
					activePeriod,
					durationMinutes,
					transactionResult,
					disposition: "executed" as const,
				};
			}),
	};
}

export type ClockingTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

// Same shape as WorkTransactionClient, derived here from `db.transaction` so the
// approval write-boundary scanner (per-file analysis) still sees these writes.
type ClockingStoreClient = Pick<
	ClockingTransaction,
	"execute" | "query" | "select" | "insert" | "update" | "delete"
>;

export function createDatabaseClockingStore(tx: ClockingStoreClient): ClockingStore {
	return {
		transaction: tx,
		lockEmployee: async (employeeId) => {
			await tx.execute(
				sql`select pg_advisory_xact_lock(hashtextextended(${employeeId}, 0))`,
			);
		},
		isOrganizationMember: async (employeeId, organizationId) => {
			const [member] = await tx
				.select({ id: employee.id })
				.from(employee)
				.where(
					and(
						eq(employee.id, employeeId),
						eq(employee.organizationId, organizationId),
					),
				)
				.limit(1);
			return Boolean(member);
		},
		getEntryByActionId: async (employeeId, organizationId, actionId) => {
			if (!actionId) return null;
			const [entry] = await tx
				.select()
				.from(timeEntry)
				.where(
					and(
						eq(timeEntry.id, actionId),
						eq(timeEntry.employeeId, employeeId),
						eq(timeEntry.organizationId, organizationId),
					),
				)
				.limit(1);
			return entry ?? null;
		},
		getActivePeriod: async (employeeId, organizationId, workPeriodId) => {
			const [period] = await tx
				.select({ id: workPeriod.id, startTime: workPeriod.startTime })
				.from(workPeriod)
				.where(
					and(
						eq(workPeriod.employeeId, employeeId),
						eq(workPeriod.organizationId, organizationId),
						eq(workPeriod.isActive, true),
						isNull(workPeriod.endTime),
						...(workPeriodId ? [eq(workPeriod.id, workPeriodId)] : []),
					),
				)
				.limit(1);
			return period ?? null;
		},
		getCompletedPeriodByClockOutActionId: async (
			employeeId,
			organizationId,
			actionId,
			workPeriodId,
		) => {
			const [period] = await tx
				.select({
					id: workPeriod.id,
					startTime: workPeriod.startTime,
					endTime: workPeriod.endTime,
					durationMinutes: workPeriod.durationMinutes,
					projectId: workPeriod.projectId,
					workCategoryId: workPeriod.workCategoryId,
				})
				.from(workPeriod)
				.where(
					and(
						eq(workPeriod.employeeId, employeeId),
						eq(workPeriod.organizationId, organizationId),
						eq(workPeriod.clockOutId, actionId),
						eq(workPeriod.isActive, false),
						...(workPeriodId ? [eq(workPeriod.id, workPeriodId)] : []),
					),
				)
				.limit(1);
			if (
				!period ||
				!(period.endTime instanceof Date) ||
				period.durationMinutes === null
			) {
				return null;
			}
			return {
				...period,
				endTime: period.endTime,
				durationMinutes: period.durationMinutes,
			};
		},
		getLatestHash: async (employeeId, organizationId) => {
			const [latest] = await tx
				.select({ hash: timeEntry.hash })
				.from(timeEntry)
				.where(
					and(
						eq(timeEntry.employeeId, employeeId),
						eq(timeEntry.organizationId, organizationId),
					),
				)
				.orderBy(desc(timeEntry.createdAt))
				.limit(1);
			return latest?.hash ?? null;
		},
		admitAppend: (scope, operation) => admitTimeEntryAppend(tx, scope, operation),
		insertEntry: async (values) => {
			const [entry] = await tx
				.insert(timeEntry)
				.values(values as never)
				.returning();
			if (!entry) throw new Error("Failed to create time entry");
			return entry;
		},
		insertActivePeriod: async (values) => {
			const [period] = await tx
				.insert(workPeriod)
				.values(values as never)
				.returning({ id: workPeriod.id });
			if (!period) throw new Error("Failed to create work period");
			return period;
		},
		closeActivePeriod: async (periodId, employeeId, organizationId, patch) => {
			const [period] = await tx
				.update(workPeriod)
				.set(patch as never)
				.where(
					and(
						eq(workPeriod.id, periodId),
						eq(workPeriod.employeeId, employeeId),
						eq(workPeriod.organizationId, organizationId),
						eq(workPeriod.isActive, true),
						isNull(workPeriod.endTime),
					),
				)
				.returning({ id: workPeriod.id });
			return period ?? null;
		},
	};
}
