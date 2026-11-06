import "server-only";
import { sql } from "drizzle-orm";
import type { Instant } from "@/lib/datetime/temporal-core";
import {
	dateFromInstant,
	instantFromDate,
	systemClock,
} from "@/lib/datetime/temporal-core";
import type { LifecycleClient } from "@/lib/employee-lifecycle/types";
import type { EquipmentDepartureReturn } from "./contracts";
import {
	effectiveEquipmentDeadline,
	equipmentDepartureDeadline,
} from "./deadlines";
import { lockEquipmentOrganization } from "./setup";

type Client = Pick<LifecycleClient, "execute">;
type Subject = {
	organizationId: string;
	employeeId: string;
	employmentPeriodId: string | null;
};

/** Internal lifecycle read; the lifecycle caller must authorize its administrator first. */
export async function readEquipmentDepartureReturns(
	tx: Client,
	subject: Pick<Subject, "organizationId" | "employeeId">,
	deadline: string,
): Promise<EquipmentDepartureReturn[]> {
	const result = await tx.execute<{
		id: string;
		identifier: string;
		type_name: string;
		outstanding: number;
		explicit_deadline: string | null;
		departure_deadline: string | null;
		current_period: boolean;
	}>(sql`
  SELECT a.id, coalesce(i.identifier, t.name) AS identifier, t.name AS type_name,
   (a.quantity::bigint - a.received_quantity - a.lost_quantity - a.waived_quantity + a.exception_received_quantity)::integer AS outstanding,
   a.explicit_deadline::text, a.departure_deadline::text,
   (a.deactivation_id IS NULL AND (a.employment_period_id IS NULL OR EXISTS (SELECT 1 FROM employee_employment_period p WHERE p.organization_id=a.organization_id AND p.employee_id=a.employee_id AND p.id=a.employment_period_id AND p.status='open'))) AS current_period
  FROM equipment_assignment a JOIN equipment_type t ON t.id=a.type_id AND t.organization_id=a.organization_id
  LEFT JOIN equipment_item i ON i.id=a.item_id AND i.organization_id=a.organization_id
  WHERE a.organization_id=${subject.organizationId} AND a.employee_id=${subject.employeeId}::uuid
   AND a.return_required AND a.quantity::bigint > a.received_quantity::bigint + a.lost_quantity + a.waived_quantity - a.exception_received_quantity
  ORDER BY t.name, i.identifier, a.id
 `);
	return result.rows.map((row) => ({
		assignmentId: row.id,
		identifier: row.identifier,
		typeName: row.type_name,
		outstandingQuantity: row.outstanding,
		explicitDeadline: row.explicit_deadline,
		effectiveDeadline: effectiveEquipmentDeadline(
			row.explicit_deadline,
			row.current_period ? deadline : row.departure_deadline,
		),
	}));
}

/**
 * Assignments with an outstanding return, for the features card's switch-off
 * warning (#1572). The caller must authorize an owner or admin first.
 */
export async function countOutstandingEquipmentReturns(
	tx: Client,
	organizationId: string,
): Promise<number> {
	const result = await tx.execute<{ count: number }>(sql`
  SELECT count(*)::integer AS count FROM equipment_assignment a
  WHERE a.organization_id=${organizationId}
   AND a.return_required AND a.quantity::bigint > a.received_quantity::bigint + a.lost_quantity + a.waived_quantity - a.exception_received_quantity
 `);
	return result.rows[0]?.count ?? 0;
}

/**
 * Lifecycle owns authorization, revision/replay and the transaction. Call only after
 * its user/access guards, employee coordination and organization row, before any
 * roster cleanup. Equipment never takes an earlier guard or opens a transaction.
 * Both scheduled cutoff and immediate deactivation reuse this employment operation.
 */
export async function endEquipmentEmployment(
	tx: Client,
	input: Subject & {
		departureId?: string;
		deactivationId?: string;
		actorUserId: string;
		cutoff: Instant;
		timezone: string;
		mode: "scheduled" | "immediate";
	},
) {
	await lockEquipmentOrganization(tx, input.organizationId);
	// A stale old-employment retry must not revoke a newly granted responsibility or
	// attach new assignments. The lifecycle command also fences its own identity.
	const current = await tx.execute(sql`SELECT 1 FROM employee e
  WHERE e.organization_id=${input.organizationId} AND e.id=${input.employeeId}::uuid
  AND NOT EXISTS (SELECT 1 FROM employee_employment_period p WHERE p.organization_id=e.organization_id AND p.employee_id=e.id AND p.status='open' AND p.id IS DISTINCT FROM ${input.employmentPeriodId}::uuid)
  AND (${input.employmentPeriodId}::uuid IS NULL OR EXISTS (SELECT 1 FROM employee_employment_period p WHERE p.organization_id=e.organization_id AND p.employee_id=e.id AND p.id=${input.employmentPeriodId}::uuid AND p.status='open'))
  AND (${input.deactivationId ?? null}::uuid IS NULL OR EXISTS (SELECT 1 FROM employee_deactivation d WHERE d.id=${input.deactivationId ?? null}::uuid AND d.organization_id=e.organization_id AND d.employee_id=e.id AND d.employment_period_id IS NOT DISTINCT FROM ${input.employmentPeriodId}::uuid AND d.reactivated_at IS NULL))`);
	if (!current.rows.length) return { revokedOfficerGrantIds: [] as string[] };
	const at = dateFromInstant(input.cutoff);
	await tx.execute(sql`INSERT INTO equipment_former_team_scope (organization_id, employee_id, ending_id, team_ids, captured_at)
  SELECT e.organization_id, e.id, ${input.deactivationId ?? input.departureId ?? input.employmentPeriodId}::uuid, ARRAY(SELECT DISTINCT team_id FROM (
   SELECT e.team_id WHERE e.team_id IS NOT NULL
   UNION SELECT tm.team_id FROM team_membership tm WHERE tm.organization_id=e.organization_id AND tm.employee_id=e.id
  ) teams), ${at} FROM employee e WHERE e.organization_id=${input.organizationId} AND e.id=${input.employeeId}::uuid
  ON CONFLICT DO NOTHING`);
	const revoked = await tx.execute<{
		id: string;
	}>(sql`UPDATE equipment_officer_grant SET revoked_at=${at}, updated_at=${at}, updated_by=${input.actorUserId}, revision=revision+1
  WHERE organization_id=${input.organizationId} AND employee_id=${input.employeeId}::uuid AND revoked_at IS NULL RETURNING employee_id AS id`);
	if (input.deactivationId || input.departureId) {
		await tx.execute(sql`UPDATE equipment_assignment SET deactivation_id=${input.deactivationId ?? null}::uuid, departure_id=${input.departureId ?? null}::uuid, revision=revision+1, last_activity_at=${dateFromInstant(systemClock.nowInstant())}
   WHERE organization_id=${input.organizationId} AND employee_id=${input.employeeId}::uuid
    AND (employment_period_id IS NULL OR employment_period_id=${input.employmentPeriodId}::uuid)
    AND NOT return_required AND deactivation_id IS NULL`);
	}
	await updateDeadlines(
		tx,
		input,
		input.departureId ?? null,
		equipmentDepartureDeadline(input.cutoff, input.timezone, input.mode),
	);
	return { revokedOfficerGrantIds: revoked.rows.map((row) => row.id) };
}

/** Recompute after an accepted schedule/edit/cancel under lifecycle locks, never from a preview. */
export async function synchronizeEquipmentDeparture(
	tx: Client,
	subject: Subject & { departureId: string },
) {
	await lockEquipmentOrganization(tx, subject.organizationId);
	const result = await tx.execute<{
		cutoff_at: string;
		timezone: string;
		mode: "scheduled" | "immediate";
		status: string;
	}>(sql`
  SELECT cutoff_at, timezone, mode, status FROM employee_departure
  WHERE organization_id=${subject.organizationId} AND employee_id=${subject.employeeId}::uuid
   AND employment_period_id=${subject.employmentPeriodId}::uuid AND id=${subject.departureId}::uuid`);
	const departure = result.rows[0];
	if (!departure || !["pending", "canceled"].includes(departure.status)) return;
	if (departure.status === "canceled") {
		await tx.execute(sql`UPDATE equipment_assignment SET departure_deadline=NULL, departure_id=NULL, revision=revision+1, last_activity_at=${dateFromInstant(systemClock.nowInstant())}
   WHERE organization_id=${subject.organizationId} AND employee_id=${subject.employeeId}::uuid
    AND employment_period_id=${subject.employmentPeriodId}::uuid AND departure_id=${subject.departureId}::uuid AND deactivation_id IS NULL AND departure_deadline IS NOT NULL`);
		return;
	}
	await updateDeadlines(
		tx,
		subject,
		subject.departureId,
		equipmentDepartureDeadline(
			instantFromDate(new Date(departure.cutoff_at)),
			departure.timezone,
			departure.mode,
		),
	);
}
async function updateDeadlines(
	tx: Client,
	subject: Subject & { deactivationId?: string },
	departureId: string | null,
	deadline: string,
) {
	await tx.execute(sql`UPDATE equipment_assignment SET departure_deadline=${deadline}::date, departure_id=${departureId}::uuid,
  deactivation_id=${subject.deactivationId ?? null}::uuid,
  employment_period_id=coalesce(employment_period_id, ${subject.employmentPeriodId}::uuid), revision=revision+1, last_activity_at=${dateFromInstant(systemClock.nowInstant())}
  WHERE organization_id=${subject.organizationId} AND employee_id=${subject.employeeId}::uuid AND return_required
   AND (employment_period_id IS NULL OR employment_period_id=${subject.employmentPeriodId}::uuid)
   AND deactivation_id IS NULL
   AND (departure_deadline IS DISTINCT FROM ${deadline}::date OR departure_id IS DISTINCT FROM ${departureId}::uuid OR deactivation_id IS DISTINCT FROM ${subject.deactivationId ?? null}::uuid)`);
}
