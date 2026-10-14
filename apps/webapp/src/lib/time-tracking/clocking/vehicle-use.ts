import "server-only";

import { and, eq, isNull } from "drizzle-orm";
import { workPeriod } from "@/db/schema";
import type { ClosingVehicleUse } from "../close-active-work";
import {
	breakVehicleUse,
	clockInVehicleUse,
	clockOutVehicleUse,
} from "../vehicle-use/clock-vehicle-use";
import { resolveVehicleUseMode } from "../vehicle-use/resolver";
import {
	organizationVehicleIdOf,
	sameWorkVehicleUse,
	vehicleUseColumns,
	vehicleUseFromColumns,
	type WorkVehicleUse,
} from "../vehicle-use/work-vehicle-use";
import {
	assertVehiclePickable,
	workVehicleUseRefusalCodeOf,
} from "../vehicle-use/work-vehicle-use-eligibility";
import { vehicleUseSelectColumns } from "../vehicle-use/work-vehicle-use-sql";
import type { WorkTransactionClient } from "../work-transaction";
import type { BreakClosure } from "./break";
import type { BreakCommand, ClockInCommand, ClockOutCommand } from "./types";
import { acceptsClockVehicleUse } from "./vehicle-use-eligibility";

/**
 * Vehicle use of executed clock events (#1122, Time Tracking ADR 0009), inside
 * the command's work transaction and only for an executed event: a replay writes
 * nothing. Vehicle use is work attribution. Live work takes it here, after the
 * start; work a clock-out or break completes takes it as part of the completed
 * work that work records creates (#1222), decided under the live work's lock. The
 * configuration and a newly picked vehicle are read `FOR SHARE`, so a concurrent
 * change waits for this commit.
 *
 * Nothing here refuses the clock event: an ineligible command, vehicle use off
 * for the employee, an archived or unknown vehicle, or readings that cannot be
 * recorded drop the supplied vehicle use, and the work keeps what it had.
 */

type Scope = { organizationId: string; employeeId: string };

async function vehicleUseOn(db: WorkTransactionClient, scope: Scope): Promise<boolean> {
	return (await resolveVehicleUseMode(db, scope, { lock: "share" })) !== "off";
}

async function readPeriod(
	db: WorkTransactionClient,
	scope: Scope,
	where: { id: string } | { clockInId: string },
) {
	const [period] = await db
		.select({
			id: workPeriod.id,
			...vehicleUseSelectColumns(workPeriod),
		})
		.from(workPeriod)
		.where(
			and(
				eq(workPeriod.organizationId, scope.organizationId),
				eq(workPeriod.employeeId, scope.employeeId),
				"id" in where ? eq(workPeriod.id, where.id) : eq(workPeriod.clockInId, where.clockInId),
			),
		)
		.limit(1);
	return period ? { ...period, use: vehicleUseFromColumns(period) } : null;
}

type Period = NonNullable<Awaited<ReturnType<typeof readPeriod>>>;

/** A newly picked organization vehicle must be pickable; anything else is dropped. */
async function pickable(
	db: WorkTransactionClient,
	scope: Scope,
	current: WorkVehicleUse | null,
	resulting: WorkVehicleUse | null,
): Promise<boolean> {
	const vehicleId = organizationVehicleIdOf(resulting);
	if (!vehicleId || vehicleId === organizationVehicleIdOf(current)) return true;
	try {
		await assertVehiclePickable(db, scope.organizationId, vehicleId);
		return true;
	} catch (error) {
		if (workVehicleUseRefusalCodeOf(error)) return false;
		throw error;
	}
}

/** Writes vehicle use to live work, when it changes. Completed work's is work records'. */
async function writeLive(
	db: WorkTransactionClient,
	scope: Scope,
	period: Period,
	use: WorkVehicleUse | null,
) {
	if (sameWorkVehicleUse(period.use, use)) return;
	const columns = vehicleUseColumns(use);
	await db
		.update(workPeriod)
		.set({
			vehicleKind: columns.vehicleKind,
			vehicleId: columns.vehicleId,
			odometerStartKm: columns.odometerStartKm,
			odometerEndKm: columns.odometerEndKm,
			drivenDistanceKm: columns.drivenDistanceKm,
			updatedAt: new Date(),
		})
		.where(
			and(
				eq(workPeriod.id, period.id),
				eq(workPeriod.organizationId, scope.organizationId),
				eq(workPeriod.employeeId, scope.employeeId),
				eq(workPeriod.isActive, true),
				isNull(workPeriod.endTime),
			),
		);
}

function scopeOf(command: { organizationId: string; subject: { employeeId: string } }): Scope {
	return { organizationId: command.organizationId, employeeId: command.subject.employeeId };
}

/** The started work takes the clock-in's vehicle and start reading. */
export async function recordClockInVehicleUse<Result extends { disposition: string }>(
	db: WorkTransactionClient,
	command: ClockInCommand,
	result: Result,
	/** The executed start's clock-in entry, which names its work period. */
	entryIdOf: (executed: Result & { disposition: "executed" }) => string,
): Promise<Result> {
	if (result.disposition !== "executed" || !acceptsClockVehicleUse(command)) return result;
	const use = clockInVehicleUse(command.vehicleUse);
	if (!use) return result;
	const scope = scopeOf(command);
	if (!(await vehicleUseOn(db, scope))) return result;
	const period = await readPeriod(db, scope, {
		clockInId: entryIdOf(result as Result & { disposition: "executed" }),
	});
	if (!period || !(await pickable(db, scope, null, use))) return result;
	await writeLive(db, scope, period, use);
	return result;
}

/**
 * The closed work takes the clock-out's readings over what its live work
 * records. Decided under the live work's lock, it becomes part of the completed
 * work that work records creates (#1222); undefined keeps the live work's.
 */
export function clockOutClosingVehicleUse(
	db: WorkTransactionClient,
	command: ClockOutCommand,
): ClosingVehicleUse | undefined {
	const supplied = command.vehicleUse;
	if (!supplied || !acceptsClockVehicleUse(command)) return undefined;
	const scope = scopeOf(command);
	return async (live) => {
		if (!(await vehicleUseOn(db, scope))) return undefined;
		const use = clockOutVehicleUse(live, supplied);
		return (await pickable(db, scope, live, use)) ? use : undefined;
	};
}

/**
 * The vehicle carries over a break, and the break's one reading becomes the
 * closed work's end and the resumed work's start. The vehicle carries over for
 * every executed break while vehicle use is on, also one that named no reading
 * or whose principal may not record one. The closed work's part is decided under
 * the live work's lock and created with it (`closing`); the resumed live work
 * takes its part once it is started (`recordResumed`).
 */
export function breakVehicleUseCarry(db: WorkTransactionClient, command: BreakCommand) {
	const scope = scopeOf(command);
	let resumedUse: WorkVehicleUse | null | undefined;
	const closing: ClosingVehicleUse = async (live) => {
		if (!live || !(await vehicleUseOn(db, scope))) return undefined;
		const planned = breakVehicleUse(
			live,
			acceptsClockVehicleUse(command) ? command.vehicleUse : undefined,
		);
		resumedUse = planned.resumed;
		return planned.closed;
	};
	async function recordResumed(closure: BreakClosure): Promise<BreakClosure> {
		if (closure.disposition !== "executed" || resumedUse === undefined) return closure;
		const resumed = await readPeriod(db, scope, { id: closure.result.workPeriodId });
		if (resumed) await writeLive(db, scope, resumed, resumedUse);
		return closure;
	}
	return { closing, recordResumed };
}
