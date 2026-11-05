import "server-only";
import { and, asc, eq, inArray, or, sql } from "drizzle-orm";
import { Temporal } from "temporal-polyfill";
import type { db as database } from "@/db";
import { organization } from "@/db/auth-schema";
import {
	equipmentAssignment,
	equipmentCaseHoldEvent,
	equipmentCommand,
	equipmentCommandAssignment,
	equipmentCustodyReceipt,
	equipmentHandover,
	equipmentItem,
	equipmentItemCustodyHistory,
	equipmentPolicy,
	equipmentTransfer,
} from "@/db/schema/equipment";
import {
	dateFromInstant,
	type Instant,
	instantFromDate,
	systemClock,
} from "@/lib/datetime/temporal-core";
import {
	assertReadCommitted,
	lockLifecycleOrganization,
} from "@/lib/employee-lifecycle/locks";
import { resolveOrganizationTimezone } from "@/lib/timezone/resolve-timezone";
import type { EquipmentActor } from "./access";
import type {
	EquipmentChange,
	EquipmentOutcome,
	EquipmentRetentionView,
} from "./contracts";
import { effectiveHandover } from "./corrections";
import { outstandingEquipmentQuantity } from "./deadlines";
import { type EquipmentTransaction, lockEquipmentOrganization } from "./setup";

/** Keep the whole anniversary day. Calendar months clamp month ends; DST follows the org zone. */
function expiry(
	activity: Date,
	months: number,
	timezone: string,
): Instant | null {
	if (!Number.isSafeInteger(months) || months <= 0)
		throw new Error("Invalid equipment retention policy");
	try {
		return instantFromDate(activity)
			.toZonedDateTimeISO(timezone)
			.toPlainDate()
			.add({ months })
			.add({ days: 1 })
			.toZonedDateTime(timezone)
			.toInstant();
	} catch (error) {
		// A positive SQL integer can exceed Temporal's supported calendar. Its expiry
		// is later than every representable instant, never an excuse to purge early.
		if (error instanceof RangeError) return null;
		throw error;
	}
}

export function equipmentRetentionStatus(
	assignment: typeof equipmentAssignment.$inferSelect,
	months: number | null,
	timezone: string,
	now: Instant,
): EquipmentRetentionView {
	const end =
		months === null
			? null
			: expiry(assignment.lastActivityAt, months, timezone);
	return {
		lastActivityAt: instantFromDate(assignment.lastActivityAt).toString(),
		expiresAt: end?.toString() ?? null,
		caseHeld: assignment.caseHeld,
		status:
			outstandingEquipmentQuantity(assignment) > 0
				? "outstanding"
				: assignment.caseHeld
					? "case_hold"
					: months === null
						? "policy_required"
						: end && Temporal.Instant.compare(now, end) >= 0
							? "due"
							: "retained",
	};
}

export async function changeEquipmentCaseHold(
	tx: EquipmentTransaction,
	actor: EquipmentActor,
	change: Extract<
		EquipmentChange,
		{ kind: "place_case_hold" | "release_case_hold" }
	>,
	now: Instant,
): Promise<EquipmentOutcome> {
	const where = and(
		eq(equipmentAssignment.organizationId, actor.organizationId),
		eq(equipmentAssignment.id, change.assignmentId),
	);
	const [assignment] = await tx.select().from(equipmentAssignment).where(where);
	if (!assignment?.employeeId) return { ok: false, reason: "not_found" };
	if (assignment.revision !== change.expectedRevision)
		return { ok: false, reason: "stale_revision" };
	const held = change.kind === "place_case_hold";
	if (assignment.caseHeld === held)
		return { ok: false, reason: "hold_unchanged" };
	const revision = assignment.revision + 1;
	await tx.insert(equipmentCaseHoldEvent).values({
		organizationId: actor.organizationId,
		assignmentId: assignment.id,
		kind: held ? "place" : "release",
		reason: change.reason,
		actorId: actor.userId,
		recordedAt: dateFromInstant(now),
		revision,
	});
	await tx
		.update(equipmentAssignment)
		.set({ caseHeld: held, revision })
		.where(where);
	return { ok: true, id: assignment.id, revision };
}

/** One organization transaction, lifecycle org row before equipment; never take an earlier guard here.
 * No candidate scan authorizes deletion: every balance, hold, policy and activity is read under locks.
 */
export async function cleanupEquipmentHistory(
	db: typeof database,
	organizationId: string,
) {
	return db.transaction(async (tx) => {
		await assertReadCommitted(tx);
		await lockLifecycleOrganization(tx, organizationId);
		await lockEquipmentOrganization(tx, organizationId);
		const [config] = await tx
			.select({
				months: equipmentPolicy.retentionMonths,
				timezone: organization.timezone,
			})
			.from(equipmentPolicy)
			.innerJoin(
				organization,
				eq(organization.id, equipmentPolicy.organizationId),
			)
			.where(eq(equipmentPolicy.organizationId, organizationId));
		if (!config) return { deletedCount: 0 };
		const timezone = resolveOrganizationTimezone(config.timezone).timezone;
		const now = systemClock.nowInstant();
		const candidates = await tx
			.select()
			.from(equipmentAssignment)
			.where(eq(equipmentAssignment.organizationId, organizationId))
			.orderBy(asc(equipmentAssignment.id));
		let deletedCount = 0;
		for (const assignment of candidates) {
			if (
				equipmentRetentionStatus(assignment, config.months, timezone, now)
					.status !== "due"
			)
				continue;
			const evidence = await tx
				.select()
				.from(equipmentHandover)
				.where(
					and(
						eq(equipmentHandover.organizationId, organizationId),
						eq(equipmentHandover.assignmentId, assignment.id),
					),
				)
				.orderBy(asc(equipmentHandover.sequence));
			const hs = evidence.map(effectiveHandover);
			const issue = hs.find((h) => h.kind === "issue");
			if (assignment.itemId && issue) {
				await tx.insert(equipmentItemCustodyHistory).values({
					organizationId,
					itemId: assignment.itemId,
					issueSequence: issue.sequence,
					issueDate: issue.actualDate,
					receiptDate:
						hs.find((h) => h.kind === "receipt" && h.quantity > 0)
							?.actualDate ?? null,
				});
			}
			if (hs.length) {
				const ids = hs.map((h) => h.id);
				const idSet = new Set(ids);
				const links = await tx
					.select()
					.from(equipmentTransfer)
					.where(
						and(
							eq(equipmentTransfer.organizationId, organizationId),
							or(
								inArray(equipmentTransfer.receiptId, ids),
								inArray(equipmentTransfer.issueId, ids),
							),
						),
					);
				const peers = [
					...new Set(links.flatMap((l) => [l.receiptId, l.issueId])),
				].filter((id) => !idSet.has(id));
				if (peers.length)
					await tx
						.update(equipmentHandover)
						.set({ transferHistoryCleaned: true })
						.where(
							and(
								eq(equipmentHandover.organizationId, organizationId),
								inArray(equipmentHandover.id, peers),
							),
						);
			}
			// Minimize command evidence, retaining only a nonpersonal request tombstone.
			await tx.execute(sql`UPDATE equipment_command c SET fingerprint=NULL, result=NULL, created_at=${dateFromInstant(now)}
 WHERE c.organization_id=${organizationId} AND (c.result->>'id'=${assignment.id} OR EXISTS (
 SELECT 1 FROM equipment_command_assignment ca WHERE ca.organization_id=c.organization_id AND ca.request_id=c.request_id AND ca.assignment_id=${assignment.id}::uuid))`);
			await tx.execute(
				sql`DELETE FROM notification WHERE organization_id=${organizationId} AND entity_type='equipment_assignment' AND entity_id=${assignment.id}`,
			);
			// Includes read notifications and pending/attempted/sent delivery ledgers. The
			// latter cascade with assignment deletion; no eligible linked assignment survives.
			await tx
				.delete(equipmentAssignment)
				.where(
					and(
						eq(equipmentAssignment.organizationId, organizationId),
						eq(equipmentAssignment.id, assignment.id),
					),
				);
			deletedCount++;
		}
		// Readiness has its own actor evidence. Its state stays on the identity; old
		// actor events expire too, except where a documented hold protects that item.
		const events = await tx.execute<{
			id: string;
			recorded_at: Date;
		}>(sql`SELECT r.id, r.recorded_at FROM equipment_item_readiness_event r
 WHERE r.organization_id=${organizationId} AND NOT EXISTS (SELECT 1 FROM equipment_assignment a WHERE a.organization_id=r.organization_id AND a.item_id=r.item_id AND a.case_held)`);
		for (const event of events.rows) {
			const end = expiry(new Date(event.recorded_at), config.months, timezone);
			if (end && Temporal.Instant.compare(now, end) >= 0)
				await tx.execute(
					sql`DELETE FROM equipment_item_readiness_event WHERE organization_id=${organizationId} AND id=${event.id}::uuid`,
				);
		}
		const items = await tx
			.select()
			.from(equipmentItem)
			.where(
				and(
					eq(equipmentItem.organizationId, organizationId),
					sql`not exists (select 1 from equipment_assignment a where a.organization_id=${organizationId} and a.item_id=${equipmentItem.id} and a.case_held)`,
				),
			);
		for (const item of items) {
			const creationExpiry = expiry(item.createdAt, config.months, timezone);
			const updateExpiry = expiry(item.updatedAt, config.months, timezone);
			const clearCreator =
				creationExpiry && Temporal.Instant.compare(now, creationExpiry) >= 0;
			const clearUpdater =
				updateExpiry && Temporal.Instant.compare(now, updateExpiry) >= 0;
			if ((clearCreator && item.createdBy) || (clearUpdater && item.updatedBy))
				await tx
					.update(equipmentItem)
					.set({
						...(clearCreator ? { createdBy: null } : {}),
						...(clearUpdater ? { updatedBy: null } : {}),
					})
					.where(
						and(
							eq(equipmentItem.organizationId, organizationId),
							eq(equipmentItem.id, item.id),
						),
					);
		}
		const custodyReceipts = await tx
			.select()
			.from(equipmentCustodyReceipt)
			.where(
				and(
					eq(equipmentCustodyReceipt.organizationId, organizationId),
					sql`not exists(select 1 from equipment_assignment a where a.organization_id=${organizationId} and a.item_id=${equipmentCustodyReceipt.itemId} and a.case_held)`,
				),
			);
		for (const receipt of custodyReceipts) {
			const end = expiry(
				receipt.confirmedAt ?? receipt.proposedAt,
				config.months,
				timezone,
			);
			if (end && Temporal.Instant.compare(now, end) >= 0)
				await tx
					.delete(equipmentCustodyReceipt)
					.where(
						and(
							eq(equipmentCustodyReceipt.organizationId, organizationId),
							eq(equipmentCustodyReceipt.id, receipt.id),
						),
					);
		}
		// Availability commands point at the identity, rather than an assignment.
		// Their original actor-bound digests also have a finite lifetime.
		const itemCommands = await tx
			.select({
				requestId: equipmentCommand.requestId,
				createdAt: equipmentCommand.createdAt,
			})
			.from(equipmentCommand)
			.innerJoin(
				equipmentItem,
				and(
					eq(equipmentItem.organizationId, equipmentCommand.organizationId),
					sql`${equipmentCommand.result}->>'id' = ${equipmentItem.id}::text`,
				),
			)
			.where(
				and(
					eq(equipmentCommand.organizationId, organizationId),
					sql`not exists (select 1 from equipment_assignment a where a.organization_id=${organizationId} and a.item_id=${equipmentItem.id} and a.case_held)`,
				),
			);
		for (const command of itemCommands) {
			const end = expiry(command.createdAt, config.months, timezone);
			if (end && Temporal.Instant.compare(now, end) >= 0)
				await tx
					.update(equipmentCommand)
					.set({
						fingerprint: null,
						result: null,
						createdAt: dateFromInstant(now),
					})
					.where(
						and(
							eq(equipmentCommand.organizationId, organizationId),
							eq(equipmentCommand.requestId, command.requestId),
						),
					);
		}
		// Keep recent departure scope usable for historical completion. With no retained
		// assignment it expires from capture, rather than becoming an indefinite orphan.
		const formerScopes = await tx.execute<{
			id: string;
			captured_at: Date;
		}>(sql`SELECT f.id, f.captured_at FROM equipment_former_team_scope f WHERE f.organization_id=${organizationId}
 AND NOT EXISTS (SELECT 1 FROM equipment_assignment a WHERE a.organization_id=f.organization_id AND a.employee_id=f.employee_id AND coalesce(a.deactivation_id,a.departure_id,a.employment_period_id) IS NOT DISTINCT FROM f.ending_id)`);
		for (const scope of formerScopes.rows) {
			const end = expiry(new Date(scope.captured_at), config.months, timezone);
			if (end && Temporal.Instant.compare(now, end) >= 0)
				await tx.execute(
					sql`DELETE FROM equipment_former_team_scope WHERE organization_id=${organizationId} AND id=${scope.id}::uuid`,
				);
		}
		return { deletedCount };
	});
}

/** Called after an accepted command, in its existing transaction, including both transfer legs. */
export async function recordEquipmentCommandAssignments(
	tx: EquipmentTransaction,
	organizationId: string,
	change: EquipmentChange,
	outcome: { id: string },
	now: Instant,
) {
	const ids = [
		...new Set([
			outcome.id,
			...("assignmentId" in change ? [change.assignmentId] : []),
			...("destinationAssignmentId" in change
				? [change.destinationAssignmentId]
				: []),
		]),
	];
	const assignments = await tx
		.update(equipmentAssignment)
		.set({ lastActivityAt: dateFromInstant(now) })
		.where(
			and(
				eq(equipmentAssignment.organizationId, organizationId),
				inArray(equipmentAssignment.id, ids),
			),
		)
		.returning({ id: equipmentAssignment.id });
	if (assignments.length)
		await tx.insert(equipmentCommandAssignment).values(
			assignments.map((a) => ({
				organizationId,
				requestId: change.requestId,
				assignmentId: a.id,
			})),
		);
}
