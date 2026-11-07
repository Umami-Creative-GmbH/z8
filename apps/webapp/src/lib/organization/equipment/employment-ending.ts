import "server-only";

import { and, eq, isNull } from "drizzle-orm";
import { equipmentOfficerGrant } from "@/db/schema/equipment";
import { endingEmployment } from "@/lib/employee-lifecycle/employment-ending/cause";
import type {
	EmploymentEndingParticipant,
	EmploymentEndingPlanContext,
} from "@/lib/employee-lifecycle/employment-ending/types";
import { grantChecklistItem } from "@/lib/employee-lifecycle/reactivation-checklist";
import type { EquipmentDepartureReturn } from "./contracts";
import { equipmentDepartureDeadline } from "./deadlines";
import { endEquipmentEmployment, readEquipmentDepartureReturns } from "./lifecycle";

export type EquipmentEndingPlan = {
	/** Required returns stay actionable after the ending (Organization ADR 0008). */
	returns: EquipmentDepartureReturn[];
	/** The held equipment officer grant (keyed by the employee), which ends. */
	officerGrantIds: string[];
};
export type EquipmentEndingApplied = { revokedOfficerGrantIds: string[] };

function deadline(ctx: EmploymentEndingPlanContext) {
	const mode = ctx.cause.kind === "departure" ? ctx.cause.mode : "immediate";
	return equipmentDepartureDeadline(ctx.at, ctx.timeZone, mode);
}

/**
 * Equipment responsibility ends first (Employment ending #1624): it captures
 * the employee's teams and needs the open employment period, so it runs
 * before anything else and before the cause switches the employee off or
 * removes team memberships. A missing return never blocks the ending (ADR 0008).
 */
export const equipmentEndingParticipant: EmploymentEndingParticipant<
	EquipmentEndingPlan,
	EquipmentEndingApplied,
	"equipment"
> = {
	key: "equipment",
	async plan(reader, ctx) {
		const returns = await readEquipmentDepartureReturns(reader, ctx, deadline(ctx));
		const grants = await reader
			.select({ id: equipmentOfficerGrant.employeeId })
			.from(equipmentOfficerGrant)
			.where(
				and(
					eq(equipmentOfficerGrant.organizationId, ctx.organizationId),
					eq(equipmentOfficerGrant.employeeId, ctx.employeeId),
					isNull(equipmentOfficerGrant.revokedAt),
				),
			);
		return { returns, officerGrantIds: grants.map((grant) => grant.id) };
	},
	async apply(tx, _plan, ctx) {
		const { cause } = ctx;
		const ended = await endEquipmentEmployment(tx, {
			...endingEmployment(ctx),
			...(cause.kind === "departure"
				? { departureId: cause.departureId }
				: { deactivationId: cause.deactivationId }),
			actorUserId: ctx.actorUserId,
			cutoff: ctx.at,
			timezone: ctx.timeZone,
			mode: cause.kind === "departure" ? cause.mode : "immediate",
		});
		return {
			applied: { revokedOfficerGrantIds: ended.revokedOfficerGrantIds },
		};
	},
	// Returns need nothing granted again; the officer grant does.
	reactivationItems: (applied) =>
		applied.revokedOfficerGrantIds.map(() => grantChecklistItem("equipment_officer")),
};
