import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { Temporal } from "temporal-polyfill";
import { vacationAllowance, vacationPolicyRevision } from "@/db/schema";
import type { AbsenceDaysDatabase } from "./absence-days-resolver";
import type { VacationPolicy } from "./vacation-policy-store";

export type VacationPolicyResolution =
	| {
			status: "resolved";
			policy: VacationPolicy;
			source: "employee" | "team" | "organization" | "company_default";
	  }
	| { status: "legacy"; policy?: VacationPolicy }
	| { status: "missing" }
	| {
			status: "conflict";
			policyIds: string[];
			reason?: "incompatible_transition";
	  };

type PolicyAtRow = {
	status: VacationPolicyResolution["status"] | "incompatible_transition";
	policy_ids: string[];
	source: "employee" | "team" | "organization" | "company_default";
	revision_id: string | null;
};
function snapshotPolicy(row: Record<string, unknown>): VacationPolicy {
	const value = Object.fromEntries(
		Object.entries(row).map(([key, value]) => [
			key.replace(/_([a-z])/g, (_, char: string) => char.toUpperCase()),
			value,
		]),
	);
	// JSON timestamps enter the app at the database boundary.
	for (const key of [
		"defaultAnnualDays",
		"statutoryMinimumDays",
		"maxCarryoverDays",
	]) {
		if (value[key] !== null && value[key] !== undefined)
			value[key] = String(value[key]);
	}
	value.createdAt = new Date(String(value.createdAt));
	value.updatedAt = new Date(String(value.updatedAt));
	return value as VacationPolicy;
}

/** Scoped date lookup; business dates are ISO calendar days, never viewer instants. */
export async function loadEmployeeVacationPolicy(
	database: AbsenceDaysDatabase,
	input: { organizationId: string; employeeId: string; date: string },
): Promise<VacationPolicyResolution> {
	const date = Temporal.PlainDate.from(input.date).toString();
	const result = await database.execute<PolicyAtRow>(
		sql`select * from vacation_policy_at(${input.organizationId},${input.employeeId}::uuid,${date}::date)`,
	);
	const row = result.rows[0];
	if (!row || row.status === "missing") return { status: "missing" };
	if (row.status === "incompatible_transition")
		return {
			status: "conflict",
			reason: "incompatible_transition",
			policyIds: row.policy_ids.toSorted(),
		};
	if (row.status === "conflict")
		return { status: "conflict", policyIds: row.policy_ids.toSorted() };
	if (row.status === "legacy") {
		const policy = row.policy_ids[0]
			? await database.query.vacationAllowance.findFirst({
					where: and(
						eq(vacationAllowance.organizationId, input.organizationId),
						eq(vacationAllowance.id, row.policy_ids[0]),
					),
				})
			: undefined;
		return { status: "legacy", policy };
	}
	if (!row.revision_id) return { status: "missing" };
	const revision = await database.query.vacationPolicyRevision.findFirst({
		where: and(
			eq(vacationPolicyRevision.organizationId, input.organizationId),
			eq(vacationPolicyRevision.id, row.revision_id),
		),
	});
	return revision
		? {
				status: "resolved",
				source: row.source,
				policy: snapshotPolicy(revision.policy),
			}
		: { status: "missing" };
}

export type EmployeeVacationPolicyPeriod = {
	startDate: string;
	endDate: string;
	resolution: VacationPolicyResolution;
};
/** Inclusive calendar-day periods, batched per employee. Missing/conflict employees remain independently readable. */
export async function loadEmployeeVacationPolicyPeriods(
	database: AbsenceDaysDatabase,
	input: {
		organizationId: string;
		employeeIds: readonly string[];
		startDate: string;
		endDate: string;
	},
): Promise<Map<string, EmployeeVacationPolicyPeriod[]>> {
	const start = Temporal.PlainDate.from(input.startDate).toString();
	const endExclusive = Temporal.PlainDate.from(input.endDate)
		.add({ days: 1 })
		.toString();
	if (start >= endExclusive)
		throw new RangeError(
			"Vacation policy range must end on or after its start",
		);
	const employeeIds = [...new Set(input.employeeIds)];
	const result = new Map<string, EmployeeVacationPolicyPeriod[]>();
	if (!employeeIds.length) return result;
	type Row = PolicyAtRow & {
		employee_id: string;
		start_date: string;
		end_date: string;
		policy: Record<string, unknown> | null;
	};
	const rows = await database.execute<Row>(sql`
  WITH targets AS(SELECT id FROM employee WHERE organization_id=${input.organizationId} AND id=ANY(${sql`ARRAY[${sql.join(
		employeeIds.map((id) => sql`${id}::uuid`),
		sql`, `,
	)}]`})),
  dates AS(
   SELECT t.id employee_id,${start}::date AS boundary_date FROM targets t
   UNION SELECT t.id,${endExclusive}::date FROM targets t
   UNION SELECT t.id,y::date FROM targets t CROSS JOIN generate_series(date_trunc('year',${start}::date)::date,date_trunc('year',${endExclusive}::date)::date,interval '1 year') y
   UNION SELECT t.id,v.effective_start_date FROM targets t JOIN vacation_policy_revision v ON v.organization_id=${input.organizationId}
   UNION SELECT t.id,v.effective_end_date FROM targets t JOIN vacation_policy_revision v ON v.organization_id=${input.organizationId}
   UNION SELECT t.id,a.effective_start_date FROM targets t JOIN vacation_policy_assignment a ON a.organization_id=${input.organizationId} AND (a.assignment_type<>'employee' OR a.employee_id=t.id)
   UNION SELECT t.id,a.effective_end_date FROM targets t JOIN vacation_policy_assignment a ON a.organization_id=${input.organizationId} AND (a.assignment_type<>'employee' OR a.employee_id=t.id)
   UNION SELECT h.employee_id,h.effective_start_date FROM vacation_team_eligibility h JOIN targets t ON t.id=h.employee_id WHERE h.organization_id=${input.organizationId}
   UNION SELECT h.employee_id,h.effective_end_date FROM vacation_team_eligibility h JOIN targets t ON t.id=h.employee_id WHERE h.organization_id=${input.organizationId}
   UNION SELECT t.id,greatest(DATE '2026-01-01',least(r.baseline_date,coalesce(r.reviewed_from,r.baseline_date))) FROM targets t JOIN vacation_policy_rollout r ON r.organization_id=${input.organizationId}
  ), segments AS(SELECT employee_id,boundary_date,lead(boundary_date) OVER(PARTITION BY employee_id ORDER BY boundary_date) next_day FROM dates WHERE boundary_date BETWEEN ${start}::date AND ${endExclusive}::date)
  SELECT s.employee_id,s.boundary_date::text start_date,(s.next_day-1)::text end_date,r.*,CASE WHEN r.status='legacy' THEN to_jsonb(p) ELSE v.policy END policy
  FROM segments s CROSS JOIN LATERAL vacation_policy_at(${input.organizationId},s.employee_id,s.boundary_date) r
  LEFT JOIN vacation_policy_revision v ON v.id=r.revision_id AND v.organization_id=${input.organizationId}
  LEFT JOIN vacation_allowance p ON p.id=r.policy_ids[1] AND p.organization_id=${input.organizationId}
  WHERE s.next_day IS NOT NULL ORDER BY s.employee_id,s.boundary_date
 `);
	for (const row of rows.rows) {
		let resolution: VacationPolicyResolution;
		if (row.status === "resolved" && row.policy)
			resolution = {
				status: "resolved",
				source: row.source,
				policy: snapshotPolicy(row.policy),
			};
		else if (row.status === "legacy")
			resolution = {
				status: "legacy",
				policy: row.policy ? snapshotPolicy(row.policy) : undefined,
			};
		else if (row.status === "incompatible_transition")
			resolution = {
				status: "conflict",
				reason: "incompatible_transition",
				policyIds: row.policy_ids.toSorted(),
			};
		else if (row.status === "conflict")
			resolution = { status: "conflict", policyIds: row.policy_ids.toSorted() };
		else resolution = { status: "missing" };
		const periods = result.get(row.employee_id) ?? [];
		const previous = periods.at(-1);
		if (
			previous &&
			JSON.stringify(previous.resolution) === JSON.stringify(resolution)
		)
			previous.endDate = row.end_date;
		else
			periods.push({
				startDate: row.start_date,
				endDate: row.end_date,
				resolution,
			});
		result.set(row.employee_id, periods);
	}
	return result;
}
