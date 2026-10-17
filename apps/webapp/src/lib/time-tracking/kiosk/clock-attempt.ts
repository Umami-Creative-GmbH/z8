import "server-only";

import { and, eq } from "drizzle-orm";
import { kioskClockAttempt } from "@/db/schema";
import { dateFromInstant, type Instant, instantFromDate } from "@/lib/datetime/temporal-core";
import type { WorkTransactionClient } from "../work-transaction";
import type { KioskClockAction } from "./protocol";

/**
 * The terminal record of an online kiosk clock attempt (#1363, spec #889): how
 * a kiosk that lost an action's reply learns what became of it, read-only
 * toward work. One row per (organization, kiosk, operation), written once:
 *
 * - Clocking claims the attempt as `committed` inside the action's own work
 *   transaction, after its writer executed (`claimKioskClockAttempt`), so the
 *   row commits or rolls back with the work, in both admissions.
 * - The outcome lookup (`resolveKioskClockAttempt`) closes an attempt nothing
 *   has claimed as `not_recorded`. The original request, should it still be on
 *   its way, then finds the closed row at its claim and rolls back its work.
 *
 * Both write the same unique key, so PostgreSQL decides who was first: a lookup
 * racing an in-flight claim waits for that transaction and then reads its
 * outcome, and a claim after a closure fails. A missing row is therefore never
 * read as "nothing was recorded" on its own: only a written `not_recorded` is.
 */

export type KioskAttemptScope = {
	organizationId: string;
	kioskId: string;
	operationId: string;
};

/** When a recorded action took effect, as its reply named it. */
export type KioskAttemptEventTime = { instant: Instant; zone: string };

export type KioskAttemptResolution =
	| {
			state: "committed";
			employeeId: string;
			action: KioskClockAction;
			at: KioskAttemptEventTime;
	  }
	| { state: "not_recorded" };

/** The attempt was closed as not recorded before it could commit; its work rolls back. */
export class KioskAttemptClosedError extends Error {
	constructor() {
		super("The kiosk clock attempt was already resolved as not recorded");
		this.name = "KioskAttemptClosedError";
	}
}

type AttemptWriter = Pick<WorkTransactionClient, "insert">;
type AttemptReader = Pick<WorkTransactionClient, "select">;

function scopeOf(scope: KioskAttemptScope) {
	return and(
		eq(kioskClockAttempt.organizationId, scope.organizationId),
		eq(kioskClockAttempt.kioskId, scope.kioskId),
		eq(kioskClockAttempt.operationId, scope.operationId),
	);
}

const uniqueTarget = [
	kioskClockAttempt.organizationId,
	kioskClockAttempt.kioskId,
	kioskClockAttempt.operationId,
];

/**
 * Claims an executed attempt as committed, inside its work transaction. Throws
 * `KioskAttemptClosedError` when a lookup already closed it: the caller's work
 * transaction must roll back, so nothing of the attempt is ever recorded.
 */
export async function claimKioskClockAttempt(
	tx: AttemptWriter,
	claim: KioskAttemptScope & {
		employeeId: string;
		action: KioskClockAction;
		at: KioskAttemptEventTime;
	},
): Promise<void> {
	const claimed = await tx
		.insert(kioskClockAttempt)
		.values({
			organizationId: claim.organizationId,
			kioskId: claim.kioskId,
			operationId: claim.operationId,
			state: "committed",
			employeeId: claim.employeeId,
			action: claim.action,
			eventAt: dateFromInstant(claim.at.instant),
			eventZone: claim.at.zone,
		})
		.onConflictDoNothing({ target: uniqueTarget })
		.returning({ id: kioskClockAttempt.id });
	// An executed attempt never finds its own claim: a retry of a committed one replays.
	if (claimed.length === 0) throw new KioskAttemptClosedError();
}

/**
 * The terminal outcome of an attempt at its kiosk: its committed record, or,
 * when nothing claimed it, `not_recorded`, written first so that the attempt
 * can never commit afterwards. Waits for an in-flight claim of the same attempt.
 * Never runs, retries or changes work.
 */
export async function resolveKioskClockAttempt(
	database: AttemptWriter & AttemptReader,
	scope: KioskAttemptScope,
): Promise<KioskAttemptResolution> {
	await database
		.insert(kioskClockAttempt)
		.values({ ...scope, state: "not_recorded" })
		.onConflictDoNothing({ target: uniqueTarget });
	const [row] = await database
		.select({
			state: kioskClockAttempt.state,
			employeeId: kioskClockAttempt.employeeId,
			action: kioskClockAttempt.action,
			eventAt: kioskClockAttempt.eventAt,
			eventZone: kioskClockAttempt.eventZone,
		})
		.from(kioskClockAttempt)
		.where(scopeOf(scope))
		.limit(1);
	if (!row) throw new Error("The kiosk clock attempt was not resolved");
	if (row.state !== "committed") return { state: "not_recorded" };
	if (!row.employeeId || !row.action || !row.eventAt || !row.eventZone) {
		throw new Error("A committed kiosk clock attempt is incomplete");
	}
	return {
		state: "committed",
		employeeId: row.employeeId,
		action: row.action,
		at: { instant: instantFromDate(row.eventAt), zone: row.eventZone },
	};
}
