/**
 * A fake of work records' `applyWorkRecordChange` for the time-correction
 * mock-database harnesses (#1227). It writes the outline of a change through
 * the harness database (adopted entries, the work period, the canonical work
 * record and its detail) with the times the adopted entries carry, so the
 * harnesses' durable states, rollbacks, failure points and legacy captures
 * follow a decision. It checks nothing: record agreement, compare-and-set and
 * the effects are work records' and are verified against PostgreSQL.
 */
import { asc, eq, inArray } from "drizzle-orm";
import { timeEntry, timeRecord, timeRecordWork, workPeriod } from "@/db/schema";
import type {
	AmendWorkRecord,
	AttachWorkRecord,
	DeleteWorkRecord,
} from "@/lib/time-tracking/work-records";

type Locked = { for(mode: string): Promise<Record<string, unknown>[]> };
type HarnessDatabase = {
	select(): {
		from(table: unknown): {
			where(condition: unknown): Locked & { orderBy?(order: unknown): Locked };
		};
	};
	update(table: unknown): {
		set(values: Record<string, unknown>): {
			where(condition: unknown): { returning(columns?: unknown): Promise<unknown[]> };
		};
	};
};

export const FAKE_CANONICAL_RECORD_ID = "fake-work-record";
export const FAKE_DIRTY_FROM_DATE = "2026-07-19";

/** `workRecordScopeForFinalizer` over a harness database, without guards. */
export async function fakeFinalizerScope(db: object) {
	return { db, admission: "legacy" as const, assertEmployee: () => undefined };
}

/**
 * An ordinary decision (#1227): both records take the decided approval state.
 * A write that misses its harness row comes back as a stale outcome.
 */
export async function fakeApprovalDecision(
	database: object,
	change: Pick<AmendWorkRecord, "approval" | "actorUserId" | "expected">,
): Promise<unknown> {
	const db = database as HarnessDatabase;
	const updatedAt = new Date();
	for (const [table, values] of [
		[workPeriod, { approvalStatus: change.approval, pendingChanges: null, updatedAt }],
		[timeRecord, { approvalState: change.approval, updatedAt, updatedBy: change.actorUserId }],
	] as const) {
		const rows = await db.update(table).set(values).where(undefined).returning();
		if (!Array.isArray(rows) || rows.length !== 1) {
			return { kind: "stale", current: { revision: change.expected.revision } };
		}
	}
	return {
		kind: "amended",
		after: { ...change.expected, revision: change.expected.revision + 1 },
		effects: { workBalanceDirtyFromDate: FAKE_DIRTY_FROM_DATE },
	};
}

async function write(
	db: HarnessDatabase,
	table: unknown,
	values: Record<string, unknown>,
): Promise<void> {
	// Work records' own compare-and-set is verified against PostgreSQL.
	await db.update(table).set(values).where(undefined).returning();
}

/** The harness's rows of a table, or none when it does not model the read. */
async function rowsOf(
	db: HarnessDatabase,
	table: unknown,
	condition: unknown,
): Promise<Record<string, unknown>[]> {
	try {
		const where = db.select().from(table).where(condition);
		const rows = await (where.orderBy ? where.orderBy(asc(timeEntry.id)) : where).for("update");
		return Array.isArray(rows) ? rows : [];
	} catch {
		return [];
	}
}

/** The adopted correction becomes current and supersedes the endpoint it replaces. */
async function adopt(db: HarnessDatabase, adopted: string) {
	await write(db, timeEntry, { isSuperseded: false, supersededById: null });
	await write(db, timeEntry, { isSuperseded: true, supersededById: adopted });
}

function minutesBetween(start: unknown, end: unknown): number | undefined {
	return start instanceof Date && end instanceof Date
		? Math.floor((end.getTime() - start.getTime()) / 60_000)
		: undefined;
}

export async function fakeWorkRecordChange(
	database: object,
	change: AmendWorkRecord | DeleteWorkRecord | AttachWorkRecord,
): Promise<unknown> {
	const db = database as HarnessDatabase;
	const after = { ...change.expected, revision: change.expected.revision + 1 };
	const effects = { workBalanceDirtyFromDate: FAKE_DIRTY_FROM_DATE };
	const updatedAt = new Date();
	if (change.kind === "attach") {
		return {
			kind: "attached",
			after,
			segment: { canonicalRecordId: FAKE_CANONICAL_RECORD_ID, durationMinutes: 0 },
			effects,
		};
	}
	const [period] = await rowsOf(db, workPeriod, eq(workPeriod.id, change.expected.workPeriodId));
	const adoptedIn =
		change.kind === "delete"
			? change.markers.clockIn.adopt
			: change.times?.clockIn && "adopt" in change.times.clockIn
				? change.times.clockIn.adopt
				: null;
	const adoptedOut =
		change.kind === "delete"
			? change.markers.clockOut.adopt
			: change.times?.clockOut && "adopt" in change.times.clockOut
				? change.times.clockOut.adopt
				: null;
	const adoptedIds = [adoptedIn, adoptedOut].filter((id): id is string => id !== null);
	const entries = adoptedIds.length
		? await rowsOf(db, timeEntry, inArray(timeEntry.id, adoptedIds))
		: [];
	const instantOf = (id: string | null) =>
		entries.find((entry) => entry.id === id)?.timestamp as Date | undefined;
	const startTime = adoptedIn ? (instantOf(adoptedIn) ?? period?.startTime) : period?.startTime;
	const endTime = adoptedOut ? (instantOf(adoptedOut) ?? period?.endTime) : period?.endTime;
	const durationMinutes =
		change.kind === "delete"
			? 0
			: adoptedIn || adoptedOut
				? minutesBetween(startTime, endTime)
				: (period?.durationMinutes as number | undefined);
	const times = {
		...(startTime instanceof Date ? { startTime } : {}),
		...(endTime instanceof Date ? { endTime } : {}),
		...(durationMinutes !== undefined ? { durationMinutes } : {}),
	};
	const segment = {
		canonicalRecordId:
			(period?.canonicalRecordId as string | undefined) ?? FAKE_CANONICAL_RECORD_ID,
		durationMinutes: durationMinutes ?? 0,
	};
	if (adoptedIn) await adopt(db, adoptedIn);
	if (adoptedOut) await adopt(db, adoptedOut);
	const record = {
		...(times.startTime ? { startAt: times.startTime } : {}),
		...(times.endTime ? { endAt: times.endTime } : {}),
		...(durationMinutes !== undefined ? { durationMinutes } : {}),
	};

	if (change.kind === "delete") {
		await write(db, workPeriod, {
			clockInId: adoptedIn,
			clockOutId: adoptedOut,
			...times,
			graphRevision: after.revision,
			updatedAt: new Date(change.deletion.at.epochMilliseconds),
			deletedAt: new Date(change.deletion.at.epochMilliseconds),
			deletedBy: change.actorUserId,
			deletionReason: change.deletion.reason,
			deletionApprovalRequestId: change.deletion.approvalRequestId,
		});
		await write(db, timeRecord, { ...record, updatedAt, updatedBy: change.actorUserId });
		return { kind: "deleted", revision: after.revision, sentinel: segment, effects };
	}

	const { project: _project, ...attribution } = change.attribution ?? {};
	const detail = {
		...(attribution.workLocationType !== undefined
			? { workLocationType: attribution.workLocationType }
			: {}),
		...(attribution.workCategoryId !== undefined
			? { workCategoryId: attribution.workCategoryId }
			: {}),
	};
	await write(db, workPeriod, {
		...(adoptedIn ? { clockInId: adoptedIn } : {}),
		...(adoptedOut ? { clockOutId: adoptedOut } : {}),
		...times,
		...detail,
		...(change.approval ? { approvalStatus: change.approval, pendingChanges: null } : {}),
		graphRevision: after.revision,
		updatedAt,
	});
	await write(db, timeRecord, {
		...record,
		...(change.approval ? { approvalState: change.approval } : {}),
		updatedAt,
		updatedBy: change.actorUserId,
	});
	if (Object.keys(detail).length > 0) await write(db, timeRecordWork, detail);
	return {
		kind: "amended",
		after,
		segment,
		changes: {
			clockIn: adoptedIn !== null,
			clockOut: adoptedOut !== null,
			attribution: [],
			approval: Boolean(change.approval),
		},
		effects,
	};
}
