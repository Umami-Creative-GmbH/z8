import "server-only";

import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { employee, timeEntry, workPeriod } from "@/db/schema";
import { dateFromInstant, type Instant } from "@/lib/datetime/temporal-core";
import { calculateHash } from "./blockchain";
import type { TimeEntryTimezoneSource } from "./timezone-capture";

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

export type ClockingAction = {
	instant: Instant;
	utcOffsetMinutes: number;
	timezone: string;
	timezoneSource: TimeEntryTimezoneSource;
};

type ClockingInput = {
	employeeId: string;
	organizationId: string;
	createdBy: string;
	actionId?: string;
	action: ClockingAction;
	source: { ipAddress: string | null; deviceInfo: string | null };
	notes?: string;
	location?: string;
};

type ClockInInput = ClockingInput & { workLocationType: "office" | "remote" | "home" | "other" };
type ClockOutInput = ClockingInput & {
	workPeriodId?: string;
	projectId?: string | null;
	workCategoryId?: string | null;
	canonicalRecordId?: string | null;
	approvalStatus?: "approved" | "pending";
	pendingChanges?: Record<string, unknown> | null;
};

type ActivePeriod = { id: string; startTime: Date };
type Entry = { id: string; [key: string]: unknown };

type ClockingStore = {
	lockEmployee(employeeId: string): Promise<void>;
	isOrganizationMember(employeeId: string, organizationId: string): Promise<boolean>;
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
	getLatestHash(employeeId: string, organizationId: string): Promise<string | null>;
	insertEntry(entry: Record<string, unknown>): Promise<Entry>;
	insertActivePeriod(period: Record<string, unknown>): Promise<{ id: string }>;
	closeActivePeriod(
		periodId: string,
		patch: Record<string, unknown>,
	): Promise<{ id: string } | null>;
};

export type ClockingDependencies = {
	transaction<T>(callback: (store: ClockingStore) => Promise<T>): Promise<T>;
};

function entryValues(
	input: ClockingInput,
	type: "clock_in" | "clock_out",
	previousHash: string | null,
) {
	const timestamp = dateFromInstant(input.action.instant);
	return {
		...(input.actionId ? { id: input.actionId } : {}),
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

export function createClockingService(deps: ClockingDependencies) {
	async function withinEmployeeTransaction<T>(
		input: ClockingInput,
		callback: (store: ClockingStore) => Promise<T>,
	): Promise<T> {
		return deps.transaction(async (store) => {
			await store.lockEmployee(input.employeeId);
			if (!(await store.isOrganizationMember(input.employeeId, input.organizationId))) {
				throw new ClockingOrganizationError();
			}
			return callback(store);
		});
	}

	return {
		clockIn: async (input: ClockInInput) =>
			withinEmployeeTransaction(input, async (store) => {
				const existingEntry = await store.getEntryByActionId(
					input.employeeId,
					input.organizationId,
					input.actionId,
				);
				if (existingEntry) return { entry: existingEntry } as never;
				if (await store.getActivePeriod(input.employeeId, input.organizationId)) {
					throw new ClockingConflictError("Active work period already exists");
				}
				const entry = await store.insertEntry(
					entryValues(
						input,
						"clock_in",
						await store.getLatestHash(input.employeeId, input.organizationId),
					),
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
				if (existingEntry) return { entry: existingEntry } as never;
				const activePeriod = await store.getActivePeriod(
					input.employeeId,
					input.organizationId,
					input.workPeriodId,
				);
				if (!activePeriod) throw new ClockingConflictError("No active work period found");
				const timestamp = dateFromInstant(input.action.instant);
				const entry = await store.insertEntry(
					entryValues(
						input,
						"clock_out",
						await store.getLatestHash(input.employeeId, input.organizationId),
					),
				);
				const durationMinutes = Math.round(
					(timestamp.getTime() - activePeriod.startTime.getTime()) / 60_000,
				);
				const period = await store.closeActivePeriod(activePeriod.id, {
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
				});
				if (!period) throw new ClockingConflictError("Active work period changed");
				return { entry, period, activePeriod, durationMinutes };
			}),
	};
}

export const clockingService = createClockingService({
	transaction: (callback) =>
		db.transaction(async (tx) =>
			callback({
				lockEmployee: async (employeeId) => {
					await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${employeeId}, 0))`);
				},
				isOrganizationMember: async (employeeId, organizationId) => {
					const [member] = await tx
						.select({ id: employee.id })
						.from(employee)
						.where(and(eq(employee.id, employeeId), eq(employee.organizationId, organizationId)))
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
				closeActivePeriod: async (periodId, patch) => {
					const [period] = await tx
						.update(workPeriod)
						.set(patch as never)
						.where(
							and(
								eq(workPeriod.id, periodId),
								eq(workPeriod.isActive, true),
								isNull(workPeriod.endTime),
							),
						)
						.returning({ id: workPeriod.id });
					return period ?? null;
				},
			}),
		),
});
