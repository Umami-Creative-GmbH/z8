import "server-only";

import { and, eq } from "drizzle-orm";
import { timeRecordWork, workPeriod } from "@/db/schema";
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
import type { WorkTransactionClient } from "../work-transaction";
import type { BreakClosure } from "./break";
import type { ClockOutClosure } from "./clock-out";
import type { BreakCommand, ClockInCommand, ClockOutCommand } from "./types";
import { acceptsClockVehicleUse } from "./vehicle-use-eligibility";

/**
 * Vehicle use of executed clock events (#1122, Time Tracking ADR 0009). Runs
 * inside the command's work transaction, after its writes, and only for an
 * executed event: a replay writes nothing. Vehicle use is work attribution, so it
 * lands on the work period and, once the work is closed, on its canonical work
 * record in the same columns. The configuration and a newly picked vehicle are
 * read `FOR SHARE`, so a concurrent change waits for this commit.
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
			canonicalRecordId: workPeriod.canonicalRecordId,
			vehicleKind: workPeriod.vehicleKind,
			vehicleId: workPeriod.vehicleId,
			odometerStartKm: workPeriod.odometerStartKm,
			odometerEndKm: workPeriod.odometerEndKm,
			drivenDistanceKm: workPeriod.drivenDistanceKm,
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

/** Writes vehicle use to the period and its canonical record, when it changes. */
async function write(
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
			),
		);
	if (!period.canonicalRecordId) return;
	await db
		.update(timeRecordWork)
		.set({
			vehicleKind: columns.vehicleKind,
			vehicleId: columns.vehicleId,
			odometerStartKm: columns.odometerStartKm,
			odometerEndKm: columns.odometerEndKm,
			drivenDistanceKm: columns.drivenDistanceKm,
		})
		.where(
			and(
				eq(timeRecordWork.recordId, period.canonicalRecordId),
				eq(timeRecordWork.organizationId, scope.organizationId),
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
	await write(db, scope, period, use);
	return result;
}

/** The closed work takes the clock-out's readings over what it records. */
export async function recordClockOutVehicleUse(
	db: WorkTransactionClient,
	command: ClockOutCommand,
	closure: ClockOutClosure,
): Promise<ClockOutClosure> {
	if (closure.disposition !== "executed" || !command.vehicleUse) return closure;
	if (!acceptsClockVehicleUse(command)) return closure;
	const scope = scopeOf(command);
	if (!(await vehicleUseOn(db, scope))) return closure;
	const period = await readPeriod(db, scope, { id: closure.closed.workPeriodId });
	if (!period) return closure;
	const use = clockOutVehicleUse(period.use, command.vehicleUse);
	if (!(await pickable(db, scope, period.use, use))) return closure;
	await write(db, scope, period, use);
	return closure;
}

/**
 * The resumed work takes the closed work's vehicle, and the break's one
 * reading becomes the closed work's end and the resumed work's start. The
 * vehicle carries over for every executed break while vehicle use is on, also
 * one that named no reading or whose principal may not record one.
 */
export async function recordBreakVehicleUse(
	db: WorkTransactionClient,
	command: BreakCommand,
	closure: BreakClosure,
): Promise<BreakClosure> {
	if (closure.disposition !== "executed") return closure;
	const scope = scopeOf(command);
	const closed = await readPeriod(db, scope, { id: closure.closed.workPeriodId });
	if (!closed?.use) return closure;
	if (!(await vehicleUseOn(db, scope))) return closure;
	const resumed = await readPeriod(db, scope, { id: closure.result.workPeriodId });
	if (!resumed) return closure;
	const planned = breakVehicleUse(
		closed.use,
		acceptsClockVehicleUse(command) ? command.vehicleUse : undefined,
	);
	await write(db, scope, closed, planned.closed);
	await write(db, scope, resumed, planned.resumed);
	return closure;
}
