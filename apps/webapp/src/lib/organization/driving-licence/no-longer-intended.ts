import "server-only";
import { createHash } from "node:crypto";
import { and, asc, eq, inArray, ne, sql } from "drizzle-orm";
import { user } from "@/db/auth-schema";
import { employee, employeeEmploymentPeriod } from "@/db/schema";
import {
	drivingAuthorization,
	drivingAuthorizationEvent,
} from "@/db/schema/driving-licence-checks";
import { drivingLicencePolicy } from "@/db/schema/driving-licence-policy";
import { dateFromInstant, type Instant, systemClock } from "@/lib/datetime/temporal-core";
import { employeeHasOrganizationAccess } from "@/lib/employee-lifecycle/access";
import { NO_LONGER_INTENDED } from "./check-types";
import type { DrivingLicenceEnding } from "./intended-driver-rules";
import { intendedDriverCondition } from "./intended-drivers";
import { lockDrivingLicenceOrganization } from "./locks";
import {
	beginDrivingLicenceRetentionChange,
	finishDrivingLicenceRetentionChange,
} from "./retention-state";
import type { DrivingLicenceDatabase, DrivingLicenceTransaction } from "./verifiers";

/**
 * "End authorization because no longer intended" (#1425, Organization ADR 0005). Whatever
 * takes intended-driver status away (an assignment change or exclusion, a move to another
 * primary team, a team deletion) wraps its write in `begin…` / `finish…` inside one
 * transaction: begin takes the driving licence organization lock and notes the intended
 * drivers holding a current class authorization; finish ends the authorizations of those no
 * longer intended after the write. A preview runs the same write and `preview…` in a
 * transaction it rolls back (`previewDrivingLicenceEndingByRollback`), so it lists exactly
 * what the save ends. Nothing here creates an authorization.
 */

export interface DrivingLicenceIntendedDriverChange {
	organizationId: string;
	/** Intended drivers holding a current class authorization before the write. */
	before: string[];
}

/**
 * Class authorizations of the current employment that have not ended (what the effective
 * reader shows as active or suspended), with the employee's name.
 */
async function currentAuthorizations(
	database: DrivingLicenceDatabase,
	organizationId: string,
	now: Instant,
	filter: { employeeIds?: readonly string[]; intendedOnly?: boolean },
) {
	if (filter.employeeIds && !filter.employeeIds.length) return [];
	return database
		.select({
			employeeId: drivingAuthorization.employeeId,
			name: user.name,
			classCode: drivingAuthorization.classCode,
			employmentPeriodId: drivingAuthorization.employmentPeriodId,
		})
		.from(drivingAuthorization)
		.innerJoin(
			employee,
			and(
				eq(employee.id, drivingAuthorization.employeeId),
				eq(employee.organizationId, organizationId),
			),
		)
		.innerJoin(user, eq(user.id, employee.userId))
		.leftJoin(
			employeeEmploymentPeriod,
			and(
				eq(employeeEmploymentPeriod.employeeId, employee.id),
				eq(employeeEmploymentPeriod.organizationId, organizationId),
				eq(employeeEmploymentPeriod.status, "open"),
			),
		)
		.where(
			and(
				eq(drivingAuthorization.organizationId, organizationId),
				ne(drivingAuthorization.state, "ended"),
				sql`${drivingAuthorization.employmentPeriodId} is not distinct from ${employeeEmploymentPeriod.id}`,
				employeeHasOrganizationAccess(now),
				filter.employeeIds ? inArray(employee.id, [...filter.employeeIds]) : undefined,
				filter.intendedOnly ? intendedDriverCondition(organizationId) : undefined,
			),
		)
		.orderBy(asc(user.name), asc(employee.id), asc(drivingAuthorization.classCode));
}

/**
 * Starts a change that may take intended-driver status away, before its first write. Takes
 * the driving licence organization lock (after any authorization-mutation protection the
 * caller holds). `employeeIds` narrows the change to the employees it can affect. Returns
 * null when driving licence control was never set up: then nobody holds an authorization.
 */
export async function beginDrivingLicenceIntendedDriverChange(
	tx: DrivingLicenceTransaction,
	organizationId: string,
	now: Instant,
	employeeIds?: readonly string[],
): Promise<DrivingLicenceIntendedDriverChange | null> {
	const [policy] = await tx
		.select({ organizationId: drivingLicencePolicy.organizationId })
		.from(drivingLicencePolicy)
		.where(eq(drivingLicencePolicy.organizationId, organizationId));
	if (!policy) return null;
	await lockDrivingLicenceOrganization(tx, organizationId);
	const rows = await currentAuthorizations(tx, organizationId, now, {
		employeeIds,
		intendedOnly: true,
	});
	return { organizationId, before: [...new Set(rows.map((row) => row.employeeId))] };
}

/**
 * After the change's write: the employees of `change.before` who are no longer intended
 * drivers, each with the classes that end. Read-only.
 */
export async function previewDrivingLicenceIntendedDriverChange(
	tx: DrivingLicenceTransaction,
	change: DrivingLicenceIntendedDriverChange | null,
	now: Instant,
): Promise<DrivingLicenceEnding[]> {
	if (!change?.before.length) return [];
	const { organizationId } = change;
	const still = await tx
		.select({ id: employee.id })
		.from(employee)
		.where(
			and(
				eq(employee.organizationId, organizationId),
				inArray(employee.id, change.before),
				intendedDriverCondition(organizationId),
			),
		);
	const intended = new Set(still.map((row) => row.id));
	const losing = change.before.filter((id) => !intended.has(id));
	const rows = await currentAuthorizations(tx, organizationId, now, { employeeIds: losing });
	const endings = new Map<string, DrivingLicenceEnding>();
	for (const row of rows) {
		const item = endings.get(row.employeeId) ?? {
			employeeId: row.employeeId,
			name: row.name ?? row.employeeId,
			classCodes: [],
		};
		item.classCodes.push(row.classCode);
		endings.set(row.employeeId, item);
	}
	return [...endings.values()];
}

/** After the change's write: ends what `preview…` lists and returns it. */
export async function finishDrivingLicenceIntendedDriverChange(
	tx: DrivingLicenceTransaction,
	change: DrivingLicenceIntendedDriverChange | null,
	input: { actorUserId: string; now: Instant },
): Promise<DrivingLicenceEnding[]> {
	const endings = await previewDrivingLicenceIntendedDriverChange(tx, change, input.now);
	if (change && endings.length)
		await endDrivingAuthorizationNoLongerIntended(tx, {
			organizationId: change.organizationId,
			endings,
			actorUserId: input.actorUserId,
			now: input.now,
		});
	return endings;
}

/**
 * The domain operation. Caller holds the driving licence organization lock and passes what
 * `preview…` returned. Ends the listed class authorizations at `now` with an attributable
 * `ended` event each, starts the retention period of the check records that no longer
 * support an active authorization, and sends the employee and their verifiers the end notice
 * while the feature is on. A person-wide impediment stays: it is not an authorization.
 */
export async function endDrivingAuthorizationNoLongerIntended(
	tx: DrivingLicenceTransaction,
	input: {
		organizationId: string;
		endings: readonly DrivingLicenceEnding[];
		actorUserId: string;
		now: Instant;
	},
) {
	const { organizationId, now } = input;
	const activeBefore = await beginDrivingLicenceRetentionChange(tx, organizationId, now);
	const notices: Array<{ employeeId: string; employmentPeriodId: string | null; codes: string[] }> =
		[];
	for (const item of input.endings) {
		const rows = await tx
			.update(drivingAuthorization)
			.set({
				state: "ended",
				suspensionReason: NO_LONGER_INTENDED,
				suspendedAt: dateFromInstant(now),
			})
			.where(
				and(
					eq(drivingAuthorization.organizationId, organizationId),
					eq(drivingAuthorization.employeeId, item.employeeId),
					inArray(drivingAuthorization.classCode, item.classCodes),
					ne(drivingAuthorization.state, "ended"),
				),
			)
			.returning({
				classCode: drivingAuthorization.classCode,
				checkId: drivingAuthorization.supportingCheckId,
				employmentPeriodId: drivingAuthorization.employmentPeriodId,
			});
		if (!rows.length) continue;
		rows.sort((a, b) => a.classCode.localeCompare(b.classCode));
		await tx.insert(drivingAuthorizationEvent).values(
			rows.map((row) => ({
				organizationId,
				employeeId: item.employeeId,
				employmentPeriodId: row.employmentPeriodId,
				classCode: row.classCode,
				checkId: row.checkId,
				kind: "ended",
				reason: NO_LONGER_INTENDED,
				effectiveAt: dateFromInstant(now),
				recordedAt: dateFromInstant(now),
				actorUserId: input.actorUserId,
			})),
		);
		notices.push({
			employeeId: item.employeeId,
			employmentPeriodId: rows[0].employmentPeriodId,
			codes: rows.map((row) => row.classCode),
		});
	}
	await finishDrivingLicenceRetentionChange(tx, organizationId, now, activeBefore);
	const [policy] = await tx
		.select({ enabled: drivingLicencePolicy.enabled })
		.from(drivingLicencePolicy)
		.where(eq(drivingLicencePolicy.organizationId, organizationId));
	// While the feature is off no notifications are created.
	if (!policy?.enabled || !notices.length) return;
	// Loaded on use: team and employee actions import this module, the notification stack
	// only matters once something ends.
	const { deliverDrivingLicenceOccasion } = await import("./reminders");
	for (const notice of notices)
		await deliverDrivingLicenceOccasion(
			tx,
			{
				organizationId,
				employeeId: notice.employeeId,
				employmentPeriodId: notice.employmentPeriodId,
				key: `ended:${notice.employmentPeriodId}:${now.toString()}:${notice.codes.join("+")}`,
				kind: "ended",
				classCode: notice.codes.join(", "),
				validThrough: null,
				leadDays: null,
			},
			now,
		);
}

type IntendedDriverWriteScope = {
	organizationId: string;
	/** The employees whose primary team the write can change; omit when any can change. */
	employeeIds?: readonly string[];
};

/**
 * Runs `write` (inside the caller's transaction, after its authorization-mutation protection)
 * between `begin…` and `finish…`: for writes outside driving licence control that can change
 * who is an intended driver, such as primary-team changes and team deletion.
 */
export async function runDrivingLicenceIntendedDriverWrite<Tx extends DrivingLicenceTransaction, T>(
	tx: Tx,
	scope: IntendedDriverWriteScope & { actorUserId: string },
	write: (tx: Tx) => Promise<T>,
): Promise<T> {
	const now = systemClock.nowInstant();
	const change = await beginDrivingLicenceIntendedDriverChange(
		tx,
		scope.organizationId,
		now,
		scope.employeeIds,
	);
	const result = await write(tx);
	await finishDrivingLicenceIntendedDriverChange(tx, change, {
		actorUserId: scope.actorUserId,
		now,
	});
	return result;
}

/**
 * The warning for such a write: runs it in a transaction opened by `transaction` (the same
 * protection as the real write) and rolls it back, returning who would lose which classes.
 */
export async function previewDrivingLicenceIntendedDriverWrite<
	Tx extends DrivingLicenceTransaction,
>(
	scope: IntendedDriverWriteScope,
	transaction: (work: (tx: Tx) => Promise<void>) => Promise<unknown>,
	write: (tx: Tx) => Promise<unknown>,
): Promise<DrivingLicenceEnding[]> {
	return previewDrivingLicenceEndingByRollback((rollBack) =>
		transaction(async (tx) => {
			const now = systemClock.nowInstant();
			const change = await beginDrivingLicenceIntendedDriverChange(
				tx,
				scope.organizationId,
				now,
				scope.employeeIds,
			);
			await write(tx);
			rollBack(await previewDrivingLicenceIntendedDriverChange(tx, change, now));
		}),
	);
}

/** The token a save compares with the preview the admin confirmed. */
export function drivingLicenceEndingToken(endings: readonly DrivingLicenceEnding[]) {
	return createHash("sha256")
		.update(
			JSON.stringify(endings.map((item) => [item.employeeId, [...item.classCodes].sort()]).sort()),
		)
		.digest("hex");
}

class DrivingLicenceEndingPreviewResult extends Error {
	constructor(readonly endings: DrivingLicenceEnding[]) {
		super("driving_licence_ending_preview");
	}
}

/**
 * Runs `change` (which writes the change, then returns `preview…`'s result from inside its
 * transaction) and rolls the transaction back, returning the preview. `change` must throw
 * through `rollBack(endings)`.
 */
export async function previewDrivingLicenceEndingByRollback(
	change: (rollBack: (endings: DrivingLicenceEnding[]) => never) => Promise<unknown>,
): Promise<DrivingLicenceEnding[]> {
	try {
		await change((endings) => {
			throw new DrivingLicenceEndingPreviewResult(endings);
		});
	} catch (error) {
		if (error instanceof DrivingLicenceEndingPreviewResult) return error.endings;
		throw error;
	}
	throw new Error("The preview did not roll back");
}
