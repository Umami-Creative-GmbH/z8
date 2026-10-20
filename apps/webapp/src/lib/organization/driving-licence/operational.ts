import "server-only";
import { and, asc, eq, ilike, or } from "drizzle-orm";
import { db } from "@/db";
import { member, user } from "@/db/auth-schema";
import { employee } from "@/db/schema";
import { systemClock } from "@/lib/datetime/temporal-core";
import { employeeHasOrganizationAccess } from "@/lib/employee-lifecycle/access";
import {
	lockDrivingLicenceOrganization,
	readEffectiveDrivingAuthorization,
} from "./checks";
import type { DrivingLicenceActor } from "./context";
import type { DrivingLicenceTransaction } from "./verifiers";
import {
	drivingAuthorizationPlanningPermission,
	readDrivingLicenceVisibility,
	showsDrivingAuthorizationAdvisory,
} from "./visibility";

/** Deliberately independent of CASL's `manage all`, employee read and verifier grants. */
async function lockOperationalViewer(
	tx: DrivingLicenceTransaction,
	actor: DrivingLicenceActor,
) {
	const [membership] = await tx
		.select({ id: member.id })
		.from(member)
		.where(
			and(
				eq(member.organizationId, actor.organizationId),
				eq(member.userId, actor.userId),
				eq(member.status, "approved"),
			),
		)
		.for("share");
	const [profile] = await tx
		.select({ id: employee.id })
		.from(employee)
		.where(
			and(
				eq(employee.organizationId, actor.organizationId),
				eq(employee.userId, actor.userId),
			),
		)
		.for("share");
	if (!membership || !profile) throw new Error("unavailable");
	return profile.id;
}
async function requireOperationalPermission(
	tx: DrivingLicenceTransaction,
	actor: DrivingLicenceActor,
	employeeId: string,
) {
	const [grant] = await drivingAuthorizationPlanningPermission(tx, {
		organizationId: actor.organizationId,
		employeeId,
	}).for("share");
	if (!grant) throw new Error("unavailable");
}
/** Sample after permission locks, so a contended read cannot revive an elapsed deadline. */
async function currentOperationalInstant(
	tx: DrivingLicenceTransaction,
	actor: DrivingLicenceActor,
	ownEmployeeId: string,
) {
	const now = systemClock.nowInstant();
	const [profile] = await tx
		.select({ allowed: employeeHasOrganizationAccess(now) })
		.from(employee)
		.where(
			and(
				eq(employee.organizationId, actor.organizationId),
				eq(employee.id, ownEmployeeId),
			),
		);
	if (!profile?.allowed) throw new Error("unavailable");
	return now;
}
/**
 * Without a target this is the clock advisory: `null` unless the visibility reader shows it
 * (feature on and the viewer is an intended driver). Planner reads of a target are unchanged.
 */
export async function readOperationalDrivingStatus(
	actor: DrivingLicenceActor,
	targetId?: string,
) {
	return db.transaction(async (tx) => {
		await lockDrivingLicenceOrganization(tx, actor.organizationId);
		if (
			targetId === undefined &&
			!showsDrivingAuthorizationAdvisory(
				await readDrivingLicenceVisibility(
					{ organizationId: actor.organizationId, userId: actor.userId },
					tx,
				),
			)
		)
			return null;
		const ownEmployeeId = await lockOperationalViewer(tx, actor);
		const employeeId = targetId ?? ownEmployeeId;
		if (employeeId !== ownEmployeeId)
			await requireOperationalPermission(tx, actor, ownEmployeeId);
		const now = await currentOperationalInstant(tx, actor, ownEmployeeId);
		const [target] = await tx
			.select({ id: employee.id })
			.from(employee)
			.where(
				and(
					eq(employee.organizationId, actor.organizationId),
					eq(employee.id, employeeId),
				),
			)
			.limit(1);
		if (!target) throw new Error("unavailable");
		const effective = await readEffectiveDrivingAuthorization(
			tx,
			actor.organizationId,
			employeeId,
			now,
		);
		// Whitelist the operational contract: no evidence IDs, dates, reasons, confirmations or history.
		return {
			employeeId,
			status: effective.status,
			authorizedClasses: effective.authorizedClasses,
			classes: effective.classes.map(({ code, status, restrictions }) => ({
				code,
				status,
				restrictions,
			})),
		};
	});
}
export type OperationalDrivingStatus = NonNullable<
	Awaited<ReturnType<typeof readOperationalDrivingStatus>>
>;
export async function readOperationalDrivingEmployees(
	actor: DrivingLicenceActor,
	search: string,
) {
	return db.transaction(async (tx) => {
		await lockDrivingLicenceOrganization(tx, actor.organizationId);
		const ownEmployeeId = await lockOperationalViewer(tx, actor);
		await requireOperationalPermission(tx, actor, ownEmployeeId);
		const now = await currentOperationalInstant(tx, actor, ownEmployeeId);
		const term = `%${search.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
		return tx
			.select({ employeeId: employee.id, name: user.name })
			.from(employee)
			.innerJoin(user, eq(user.id, employee.userId))
			.where(
				and(
					eq(employee.organizationId, actor.organizationId),
					employeeHasOrganizationAccess(now),
					search
						? or(
								ilike(user.name, term),
								ilike(user.firstName, term),
								ilike(user.lastName, term),
							)
						: undefined,
				),
			)
			.orderBy(asc(user.name), asc(employee.id))
			.limit(50);
	});
}
