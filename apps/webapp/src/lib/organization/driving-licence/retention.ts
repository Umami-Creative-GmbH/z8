import "server-only";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { member, user } from "@/db/auth-schema";
import {
	drivingAuthorization,
	drivingLicenceCheck,
	drivingLicenceSubject,
} from "@/db/schema/driving-licence-checks";
import { drivingLicencePolicy } from "@/db/schema/driving-licence-policy";
import {
	drivingLicenceCleanupRun,
	drivingLicenceHold,
	drivingLicenceRetention,
} from "@/db/schema/driving-licence-retention";
import { employee } from "@/db/schema/organization";
import { hasOrganizationRole } from "@/lib/auth/organization-role";
import {
	dateFromInstant,
	type Instant,
	instantFromDate,
	systemClock,
} from "@/lib/datetime/temporal-core";
import { employeeHasOrganizationAccess } from "@/lib/employee-lifecycle/access";
import {
	lockDrivingLicenceOrganization,
	materializeExpiredDrivingAuthorizations,
} from "./checks";
import type { DrivingLicenceActor } from "./context";
import { beginDrivingLicenceRetentionChange } from "./retention-state";
import type { DrivingLicenceTransaction } from "./verifiers";

async function assertAdministrator(
	tx: DrivingLicenceTransaction,
	actor: DrivingLicenceActor,
) {
	const [membership] = await tx
		.select()
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
		.select({
			hasAccess: employeeHasOrganizationAccess(systemClock.nowInstant()),
		})
		.from(employee)
		.where(
			and(
				eq(employee.organizationId, actor.organizationId),
				eq(employee.userId, actor.userId),
			),
		);
	if (profile && !profile.hasAccess) throw new Error("forbidden");
	if (
		!membership ||
		!(
			hasOrganizationRole(membership.role, "admin") ||
			hasOrganizationRole(membership.role, "owner")
		)
	)
		throw new Error("forbidden");
}
async function list(
	tx: DrivingLicenceTransaction,
	organizationId: string,
	now: Instant,
) {
	const protectedIds = await beginDrivingLicenceRetentionChange(
		tx,
		organizationId,
		now,
	);
	const [policy] = await tx
		.select()
		.from(drivingLicencePolicy)
		.where(eq(drivingLicencePolicy.organizationId, organizationId));
	const records = await tx
		.select({
			checkId: drivingLicenceCheck.id,
			employeeId: drivingLicenceCheck.employeeId,
			employeeName: user.name,
			controlledAt: drivingLicenceCheck.controlledAt,
			retentionStartedAt: drivingLicenceRetention.retentionStartedAt,
		})
		.from(drivingLicenceCheck)
		.innerJoin(
			employee,
			and(
				eq(employee.id, drivingLicenceCheck.employeeId),
				eq(employee.organizationId, drivingLicenceCheck.organizationId),
			),
		)
		.innerJoin(user, eq(user.id, employee.userId))
		.innerJoin(
			drivingLicenceRetention,
			and(
				eq(
					drivingLicenceRetention.organizationId,
					drivingLicenceCheck.organizationId,
				),
				eq(drivingLicenceRetention.checkId, drivingLicenceCheck.id),
			),
		)
		.where(eq(drivingLicenceCheck.organizationId, organizationId))
		.orderBy(desc(drivingLicenceCheck.controlledAt));
	const holds = await tx
		.select()
		.from(drivingLicenceHold)
		.where(eq(drivingLicenceHold.organizationId, organizationId));
	return records.map((r) => {
		const deleteAfter =
			r.retentionStartedAt && policy?.retentionMonths
				? instantFromDate(r.retentionStartedAt)
						.toZonedDateTimeISO(policy.timezone)
						.add({ months: policy.retentionMonths })
						.toInstant()
				: null;
		const recordHolds = holds.filter((h) => h.checkId === r.checkId);
		return {
			checkId: r.checkId,
			employeeId: r.employeeId,
			employeeName: r.employeeName,
			controlledAt: r.controlledAt.toISOString(),
			retentionStartedAt: r.retentionStartedAt?.toISOString() ?? null,
			deleteAfter:
				deleteAfter?.toString({ smallestUnit: "millisecond" }) ?? null,
			protected: protectedIds.has(r.checkId),
			due:
				!!deleteAfter && deleteAfter.epochNanoseconds <= now.epochNanoseconds,
			holds: recordHolds.map((h) => ({
				...h,
				placedAt: h.placedAt.toISOString(),
				releasedAt: h.releasedAt?.toISOString() ?? null,
			})),
		};
	});
}
export async function readDrivingLicenceRetention(actor: DrivingLicenceActor) {
	return db.transaction(async (tx) => {
		await lockDrivingLicenceOrganization(tx, actor.organizationId);
		await assertAdministrator(tx, actor);
		const records = await list(
			tx,
			actor.organizationId,
			systemClock.nowInstant(),
		);
		const runs = await tx
			.select()
			.from(drivingLicenceCleanupRun)
			.where(eq(drivingLicenceCleanupRun.organizationId, actor.organizationId))
			.orderBy(desc(drivingLicenceCleanupRun.completedAt))
			.limit(10);
		return {
			organizationId: actor.organizationId,
			records,
			runs: runs.map((r) => ({
				...r,
				completedAt: r.completedAt.toISOString(),
			})),
		};
	});
}
const placeInput = z.strictObject({
	checkId: z.uuid(),
	caseReference: z.string().trim().min(3).max(100),
	preservationReason: z.string().trim().min(10).max(400),
});
export async function placeDrivingLicenceHold(
	actor: DrivingLicenceActor,
	raw: unknown,
) {
	const input = placeInput.parse(raw);
	return db.transaction(async (tx) => {
		await lockDrivingLicenceOrganization(tx, actor.organizationId);
		await assertAdministrator(tx, actor);
		const [record] = await tx
			.select({ id: drivingLicenceCheck.id })
			.from(drivingLicenceCheck)
			.where(
				and(
					eq(drivingLicenceCheck.organizationId, actor.organizationId),
					eq(drivingLicenceCheck.id, input.checkId),
				),
			);
		if (!record) throw new Error("unavailable");
		const now = systemClock.nowInstant();
		const [existing] = await tx
			.select()
			.from(drivingLicenceHold)
			.where(
				and(
					eq(drivingLicenceHold.organizationId, actor.organizationId),
					eq(drivingLicenceHold.checkId, input.checkId),
					eq(drivingLicenceHold.caseReference, input.caseReference),
					isNull(drivingLicenceHold.releasedAt),
				),
			);
		if (existing) return { holdId: existing.id };
		const [hold] = await tx
			.insert(drivingLicenceHold)
			.values({
				organizationId: actor.organizationId,
				...input,
				placedAt: dateFromInstant(now),
				placedBy: actor.userId,
			})
			.returning();
		return { holdId: hold.id };
	});
}
export async function releaseDrivingLicenceHold(
	actor: DrivingLicenceActor,
	raw: unknown,
) {
	const input = z
		.strictObject({
			holdId: z.uuid(),
			releaseReason: z.string().trim().min(10).max(400),
		})
		.parse(raw);
	return db.transaction(async (tx) => {
		await lockDrivingLicenceOrganization(tx, actor.organizationId);
		await assertAdministrator(tx, actor);
		const [hold] = await tx
			.select()
			.from(drivingLicenceHold)
			.where(
				and(
					eq(drivingLicenceHold.organizationId, actor.organizationId),
					eq(drivingLicenceHold.id, input.holdId),
				),
			);
		if (!hold) throw new Error("unavailable");
		if (!hold.releasedAt)
			await tx
				.update(drivingLicenceHold)
				.set({
					releasedAt: dateFromInstant(systemClock.nowInstant()),
					releasedBy: actor.userId,
					releaseReason: input.releaseReason,
				})
				.where(
					and(
						eq(drivingLicenceHold.organizationId, actor.organizationId),
						eq(drivingLicenceHold.id, hold.id),
					),
				);
		return { holdId: hold.id };
	});
}
export async function cleanupDrivingLicenceEvidence(
	organizationId: string,
	actor?: DrivingLicenceActor,
) {
	return db.transaction(async (tx) => {
		await lockDrivingLicenceOrganization(tx, organizationId);
		if (actor) {
			if (actor.organizationId !== organizationId) throw new Error("forbidden");
			await assertAdministrator(tx, actor);
		}
		const now = systemClock.nowInstant();
		await materializeExpiredDrivingAuthorizations(tx, organizationId, now);
		const records = await list(tx, organizationId, now);
		let deletedCount = 0;
		for (const record of records) {
			if (
				record.protected ||
				!record.due ||
				record.holds.some((h) => !h.releasedAt)
			)
				continue;
			// Keep the operational suspension; deleting its old proof must not make a later check an initial grant.
			await tx
				.update(drivingAuthorization)
				.set({
					supportingCheckId: null,
					state: sql`CASE WHEN ${drivingAuthorization.state}='active' THEN 'ended' ELSE ${drivingAuthorization.state} END`,
					lastSuccessfulAt: null,
					restrictions: "",
				})
				.where(
					and(
						eq(drivingAuthorization.organizationId, organizationId),
						eq(drivingAuthorization.supportingCheckId, record.checkId),
					),
				);
			await tx
				.update(drivingLicenceSubject)
				.set({ sourceCheckId: null })
				.where(
					and(
						eq(drivingLicenceSubject.organizationId, organizationId),
						eq(drivingLicenceSubject.sourceCheckId, record.checkId),
					),
				);
			await tx
				.delete(drivingLicenceCheck)
				.where(
					and(
						eq(drivingLicenceCheck.organizationId, organizationId),
						eq(drivingLicenceCheck.id, record.checkId),
					),
				);
			deletedCount++;
		}
		const result = {
			deletedCount,
			heldCount: records.filter((r) => r.holds.some((h) => !h.releasedAt))
				.length,
			protectedCount: records.filter((r) => r.protected).length,
		};
		await tx.insert(drivingLicenceCleanupRun).values({
			organizationId,
			completedAt: dateFromInstant(now),
			actorUserId: actor?.userId ?? null,
			...result,
		});
		return result;
	});
}
export type DrivingLicenceRetentionData = Awaited<
	ReturnType<typeof readDrivingLicenceRetention>
>;
