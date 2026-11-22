import { sql } from "drizzle-orm";
import {
	dateFromInstant,
	type Instant,
	instantFromDate,
	instantToCanonicalString,
	parseInstant,
	parsePlainDate,
	plainDateAt,
} from "@/lib/datetime/temporal-core";
import { resolveEffectiveTimezone } from "@/lib/timezone/effective-timezone";
import { resolveOrganizationTimezone } from "@/lib/timezone/resolve-timezone";
import type { BreakPolicyRegulation } from "./break-policy-calculation";
import type {
	PolicyClockOutBreakSnapshot,
	PolicyClockOutBreakSnapshotV1,
	PolicyClockOutBreakSnapshotV2,
} from "./policy-clock-out-break-snapshot.types";

export type {
	PolicyClockOutBreakRuleSnapshot,
	PolicyClockOutBreakSnapshot,
	PolicyClockOutBreakSnapshotV1,
	PolicyClockOutBreakSnapshotV2,
} from "./policy-clock-out-break-snapshot.types";

/**
 * The break regulation a captured snapshot names: null when none applies,
 * `incomplete` when the snapshot names one without its id or name (each caller
 * refuses that its own way). Shared by the automatic break and the terminal break.
 */
export function regulationFromSnapshot(
	snapshot: PolicyClockOutBreakSnapshot,
): BreakPolicyRegulation | null | "incomplete" {
	if (
		snapshot.resolution === "none" ||
		!snapshot.regulationEnabled ||
		snapshot.breakRules.length === 0
	) {
		return null;
	}
	const { id, name, maxUninterruptedMinutes } = snapshot.regulation;
	if (id === null || name === null) return "incomplete";
	return {
		id,
		name,
		maxUninterruptedMinutes,
		breakRules: snapshot.breakRules.map((rule) => ({
			workingMinutesThreshold: rule.workingMinutesThreshold,
			requiredBreakMinutes: rule.requiredBreakMinutes,
		})),
	};
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ERROR = "Policy clock-out break snapshot is invalid";

function fail(): never {
	throw new Error(ERROR);
}

function exact(value: unknown, keys: readonly string[]): Record<string, unknown> {
	if (
		typeof value !== "object" ||
		value === null ||
		Array.isArray(value) ||
		Object.getPrototypeOf(value) !== Object.prototype
	) {
		return fail();
	}
	const descriptors = Object.getOwnPropertyDescriptors(value);
	const ownKeys = Reflect.ownKeys(descriptors);
	const keySet = new Set(keys);
	if (
		ownKeys.length !== keys.length ||
		ownKeys.some((key) => typeof key !== "string" || !keySet.has(key))
	) {
		return fail();
	}
	const result: Record<string, unknown> = {};
	for (const key of keys) {
		const descriptor = descriptors[key];
		if (!descriptor?.enumerable || !("value" in descriptor)) return fail();
		result[key] = descriptor.value;
	}
	return result;
}

function uuid(value: unknown): string {
	return typeof value === "string" && UUID.test(value) ? value : fail();
}

function name(value: unknown): string {
	return typeof value === "string" && value.length > 0 ? value : fail();
}

function minutes(value: unknown): number {
	return Number.isSafeInteger(value) && (value as number) > 0 ? (value as number) : fail();
}

function canonicalInstant(value: unknown): string {
	if (typeof value !== "string") return fail();
	try {
		return instantToCanonicalString(parseInstant(value)) === value ? value : fail();
	} catch {
		return fail();
	}
}

function canonicalPlainDate(value: unknown): string {
	if (typeof value !== "string") return fail();
	try {
		return parsePlainDate(value).toString() === value ? value : fail();
	} catch {
		return fail();
	}
}

function parseWorkPolicyPayload(root: Record<string, unknown>) {
	const assignment = exact(root.assignment, ["id", "type"]);
	if (
		assignment.type !== "employee" &&
		assignment.type !== "team" &&
		assignment.type !== "organization"
	) {
		return fail();
	}
	const policy = exact(root.policy, ["id", "name"]);
	const regulation = exact(root.regulation, ["id", "name", "maxUninterruptedMinutes"]);
	if (typeof root.regulationEnabled !== "boolean") return fail();
	if (!Array.isArray(root.breakRules)) return fail();
	const breakRules = root.breakRules.map((value) => {
		const rule = exact(value, ["id", "workingMinutesThreshold", "requiredBreakMinutes"]);
		return Object.freeze({
			id: uuid(rule.id),
			workingMinutesThreshold: minutes(rule.workingMinutesThreshold),
			requiredBreakMinutes: minutes(rule.requiredBreakMinutes),
		});
	});
	if (
		new Set(breakRules.map((rule) => rule.id)).size !== breakRules.length ||
		new Set(breakRules.map((rule) => rule.workingMinutesThreshold)).size !== breakRules.length ||
		breakRules.some((rule, index) => {
			const previous = breakRules[index - 1];
			return (
				previous !== undefined &&
				(previous.workingMinutesThreshold > rule.workingMinutesThreshold ||
					(previous.workingMinutesThreshold === rule.workingMinutesThreshold &&
						previous.id.localeCompare(rule.id) >= 0))
			);
		})
	) {
		return fail();
	}
	const regulationEnabled = root.regulationEnabled;
	const regulationId = regulation.id === null ? null : uuid(regulation.id);
	const regulationName = regulation.name === null ? null : name(regulation.name);
	const maxUninterruptedMinutes =
		regulation.maxUninterruptedMinutes === null
			? null
			: minutes(regulation.maxUninterruptedMinutes);
	if (
		(regulationEnabled && (regulationId === null || regulationName === null)) ||
		(!regulationEnabled &&
			(regulationId !== null ||
				regulationName !== null ||
				maxUninterruptedMinutes !== null ||
				breakRules.length !== 0))
	) {
		return fail();
	}
	return {
		teamId: root.teamId === null ? null : uuid(root.teamId),
		assignment: Object.freeze({
			id: uuid(assignment.id),
			type: assignment.type,
		}),
		policy: Object.freeze({ id: uuid(policy.id), name: name(policy.name) }),
		regulationEnabled,
		regulation: Object.freeze({
			id: regulationId,
			name: regulationName,
			maxUninterruptedMinutes,
		}),
		breakRules: Object.freeze(breakRules),
	};
}

export function parsePolicyClockOutBreakSnapshot(
	value: unknown,
	expectedEvaluatedAt: string,
): PolicyClockOutBreakSnapshot {
	try {
		const evaluatedAt = canonicalInstant(expectedEvaluatedAt);
		if (typeof value !== "object" || value === null || Array.isArray(value)) {
			return fail();
		}
		const version = (value as { version?: unknown }).version;
		const resolution = (value as { resolution?: unknown }).resolution;

		if (version === 1) {
			const root = exact(
				value,
				resolution === "none"
					? ["version", "evaluatedAt", "resolution"]
					: [
							"version",
							"evaluatedAt",
							"resolution",
							"teamId",
							"assignment",
							"policy",
							"regulationEnabled",
							"regulation",
							"breakRules",
						],
			);
			if (root.version !== 1 || canonicalInstant(root.evaluatedAt) !== evaluatedAt) {
				return fail();
			}
			if (root.resolution === "none") {
				return Object.freeze({
					version: 1,
					evaluatedAt,
					resolution: "none",
				}) satisfies PolicyClockOutBreakSnapshotV1;
			}
			if (root.resolution !== "work_policy") return fail();
			return Object.freeze({
				version: 1,
				evaluatedAt,
				resolution: "work_policy",
				...parseWorkPolicyPayload(root),
			}) satisfies PolicyClockOutBreakSnapshotV1;
		}

		if (version === 2) {
			const root = exact(
				value,
				resolution === "none"
					? ["version", "evaluatedAt", "resolution", "employmentPeriodId"]
					: [
							"version",
							"evaluatedAt",
							"resolution",
							"employmentPeriodId",
							"policyVersionId",
							"effectiveFromDate",
							"teamId",
							"assignment",
							"policy",
							"regulationEnabled",
							"regulation",
							"breakRules",
						],
			);
			if (root.version !== 2 || canonicalInstant(root.evaluatedAt) !== evaluatedAt) {
				return fail();
			}
			const employmentPeriodId =
				root.employmentPeriodId === null ? null : uuid(root.employmentPeriodId);
			if (root.resolution === "none") {
				return Object.freeze({
					version: 2,
					evaluatedAt,
					resolution: "none",
					employmentPeriodId,
				}) satisfies PolicyClockOutBreakSnapshotV2;
			}
			if (root.resolution !== "work_policy") return fail();
			return Object.freeze({
				version: 2,
				evaluatedAt,
				resolution: "work_policy",
				employmentPeriodId,
				policyVersionId: uuid(root.policyVersionId),
				effectiveFromDate: canonicalPlainDate(root.effectiveFromDate),
				...parseWorkPolicyPayload(root),
			}) satisfies PolicyClockOutBreakSnapshotV2;
		}

		return fail();
	} catch {
		throw new Error(ERROR);
	}
}

export function policyClockOutBreakSnapshotsEqual(
	left: unknown,
	right: unknown,
	expectedEvaluatedAt: string,
): boolean {
	try {
		return (
			JSON.stringify(parsePolicyClockOutBreakSnapshot(left, expectedEvaluatedAt)) ===
			JSON.stringify(parsePolicyClockOutBreakSnapshot(right, expectedEvaluatedAt))
		);
	} catch {
		return false;
	}
}

export function policyClockOutBreakSnapshotFromPendingChanges(
	value: unknown,
	expectedEvaluatedAt: string,
): PolicyClockOutBreakSnapshot {
	try {
		if (typeof value !== "object" || value === null || Array.isArray(value)) {
			return fail();
		}
		const descriptor = Object.getOwnPropertyDescriptor(value, "breakPolicySnapshot");
		if (!descriptor?.enumerable || !("value" in descriptor)) return fail();
		return parsePolicyClockOutBreakSnapshot(descriptor.value, expectedEvaluatedAt);
	} catch {
		throw new Error(ERROR);
	}
}

const MAX_ASSIGNMENT_CANDIDATES = 64;

type AssignmentCandidate = Readonly<{
	teamId: string | null;
	employmentPeriodId: string | null;
	userTimezone: string | null;
	organizationTimezone: string | null;
	id: string;
	type: "employee" | "team" | "organization";
	policyId: string;
	priority: number;
	effectiveUntilDate: string | null;
	policyEvaluationDate: string | null;
}>;

type CandidateSelectionResult = Readonly<{
	employmentPeriodId: string | null;
	userTimezone: string | null;
	organizationTimezone: string | null;
	assignment: AssignmentCandidate | null;
}>;

function optionalUuid(value: unknown): string | null {
	if (value === null || value === undefined) return null;
	return typeof value === "string" && UUID.test(value) ? value : fail();
}

function optionalTimezone(value: unknown): string | null {
	if (value === null || value === undefined) return null;
	return typeof value === "string" ? value : fail();
}

function optionalPlainDate(value: unknown): string | null {
	if (value === null || value === undefined) return null;
	return canonicalPlainDate(value);
}

function selectAssignmentCandidate(
	rows: readonly unknown[],
	organizationId: string,
): CandidateSelectionResult {
	if (rows.length === 0 || rows.length > MAX_ASSIGNMENT_CANDIDATES) fail();
	const candidates: AssignmentCandidate[] = [];
	let employmentPeriodId: string | null = null;
	let userTimezone: string | null = null;
	let organizationTimezone: string | null = null;

	for (const value of rows) {
		if (typeof value !== "object" || value === null || Array.isArray(value)) {
			fail();
		}
		const row = value as Record<string, unknown>;
		if (row.employeeOrganizationId !== organizationId) fail();
		employmentPeriodId = optionalUuid(row.employmentPeriodId);
		userTimezone = optionalTimezone(row.userTimezone);
		organizationTimezone = optionalTimezone(row.organizationTimezone);

		if (row.assignmentId === null) {
			if (
				rows.length !== 1 ||
				row.assignmentOrganizationId !== null ||
				row.assignmentType !== null ||
				row.assignmentPolicyId !== null ||
				row.priority !== null
			) {
				fail();
			}
			return {
				employmentPeriodId,
				userTimezone,
				organizationTimezone,
				assignment: null,
			};
		}
		if (
			row.assignmentOrganizationId !== organizationId ||
			(row.assignmentType !== "employee" &&
				row.assignmentType !== "team" &&
				row.assignmentType !== "organization") ||
			typeof row.assignmentId !== "string" ||
			!UUID.test(row.assignmentId) ||
			typeof row.assignmentPolicyId !== "string" ||
			!UUID.test(row.assignmentPolicyId) ||
			!Number.isSafeInteger(row.priority)
		) {
			fail();
		}
		candidates.push({
			teamId: row.teamId === null || typeof row.teamId === "string" ? row.teamId : fail(),
			employmentPeriodId,
			userTimezone,
			organizationTimezone,
			id: row.assignmentId,
			type: row.assignmentType,
			policyId: row.assignmentPolicyId,
			priority: row.priority as number,
			effectiveUntilDate: optionalPlainDate(row.assignmentEffectiveUntilDate),
			policyEvaluationDate: optionalPlainDate(row.policyEvaluationDate),
		});
	}
	if (new Set(candidates.map(({ id }) => id)).size !== candidates.length) fail();
	const specificity = { employee: 2, team: 1, organization: 0 } as const;
	const selected =
		candidates.toSorted(
			(left, right) =>
				right.priority - left.priority ||
				specificity[right.type] - specificity[left.type] ||
				(left.id < right.id ? -1 : left.id > right.id ? 1 : 0),
		)[0] ?? fail();
	return {
		employmentPeriodId,
		userTimezone,
		organizationTimezone,
		assignment: selected,
	};
}

export async function resolvePolicyClockOutBreakSnapshotInTransaction(input: {
	dbService: {
		db: { execute(query: ReturnType<typeof sql>): Promise<unknown> };
	};
	organizationId: string;
	employeeId: string;
	endTime: Instant;
}): Promise<PolicyClockOutBreakSnapshot> {
	const evaluatedAt = instantToCanonicalString(input.endTime);
	const endTimeDate = dateFromInstant(input.endTime);
	try {
		const candidateResult = await input.dbService.db.execute(sql`
			with employee_base as (
				select employee.id,
					employee.organization_id as "organizationId",
					user_settings.timezone as "userTimezone",
					organization.timezone as "organizationTimezone",
					coalesce(
						(select tz.name from pg_timezone_names tz where tz.name = nullif(user_settings.timezone, '') limit 1),
						(select tz.name from pg_timezone_names tz where tz.name = nullif(organization.timezone, '') limit 1),
						'UTC'
					) as "effectiveTimezone",
					coalesce(
						(select tz.name from pg_timezone_names tz where tz.name = nullif(organization.timezone, '') limit 1),
						'UTC'
					) as "effectiveOrganizationTimezone"
				from employee
				left join user_settings on user_settings.user_id = employee.user_id
				left join organization on organization.id = employee.organization_id
				where employee.id = ${input.employeeId}::uuid
					and employee.organization_id = ${input.organizationId}
				limit 2
				for update of employee
			), team_evidence as (
				select history.team_id as "teamId"
				from employee_base employee_row
				join employee_team_history history
					on history.organization_id = employee_row."organizationId"
					and history.employee_id = employee_row.id
				join team owned_team
					on owned_team.id = history.team_id
					and owned_team.organization_id = employee_row."organizationId"
				where history.effective_from <= ${endTimeDate}
					and (history.effective_to is null or history.effective_to > ${endTimeDate})
				order by history.effective_from desc, history.id desc
				limit 1
			), employee_evidence as (
				select employee_row.id,
					employee_row."organizationId",
					team_row."teamId",
					employee_row."userTimezone",
					employee_row."organizationTimezone",
					employee_row."effectiveTimezone",
					employee_row."effectiveOrganizationTimezone",
					(${endTimeDate}::timestamptz at time zone employee_row."effectiveTimezone")::date as "clockOutLocalDate"
				from employee_base employee_row
				left join team_evidence team_row on true
			), period_evidence as (
				select period.id as "employmentPeriodId",
					period.start_provenance as "periodStartProvenance",
					case
						when period.start_provenance = 'recorded' and period.started_at is not null
						then (period.started_at at time zone employee_row."effectiveTimezone")::date
						else null
					end as "periodStartEmployeeDate",
					case
						when period.start_provenance = 'recorded' and period.started_at is not null
						then (period.started_at at time zone employee_row."effectiveOrganizationTimezone")::date
						else null
					end as "periodStartOrganizationDate"
				from employee_evidence employee_row
				join employee_employment_period period
					on period.organization_id = employee_row."organizationId"
					and period.employee_id = employee_row.id
				where (period.start_provenance <> 'recorded' or period.started_at is null or period.started_at <= ${endTimeDate})
					and (period.ended_at is null or period.ended_at > ${endTimeDate})
				order by period.started_at desc nulls last, period.created_at desc, period.id desc
				limit 1
			), assignment_candidates as (
				select employee_row."organizationId" as "employeeOrganizationId",
					employee_row."teamId", assignment.id as "assignmentId",
					assignment.organization_id as "assignmentOrganizationId",
					assignment.assignment_type as "assignmentType",
					assignment.policy_id as "assignmentPolicyId", assignment.priority,
					to_char(assignment.effective_until_date, 'YYYY-MM-DD') as "assignmentEffectiveUntilDate",
					case
						when assignment.source_kind = 'employment_terms'
							and assignment.assignment_type = 'employee'
							and assignment.source_employment_history_id is not null
							and period."periodStartProvenance" = 'recorded'
							and period."periodStartEmployeeDate" = employee_row."clockOutLocalDate"
							and period."periodStartOrganizationDate" > employee_row."clockOutLocalDate"
							and assignment.effective_from_date > employee_row."clockOutLocalDate"
							and assignment.effective_from_date <= period."periodStartOrganizationDate"
							and (assignment.effective_until_date is null or assignment.effective_until_date > period."periodStartOrganizationDate")
						then to_char(period."periodStartOrganizationDate", 'YYYY-MM-DD')
						else to_char(employee_row."clockOutLocalDate", 'YYYY-MM-DD')
					end as "policyEvaluationDate"
				from employee_evidence employee_row
				left join period_evidence period on true
				join work_policy_assignment assignment
					on assignment.organization_id = employee_row."organizationId"
				where assignment.organization_id = ${input.organizationId}
					and assignment.is_active = true
					and not (
						assignment.assignment_type = 'employee'
						and period."employmentPeriodId" is not null
						and (
							(
								assignment.source_kind = 'employment_terms'
								and assignment.source_employment_history_id is not null
								and exists (
									select 1
									from employee_employment_history prior_terms
									where prior_terms.id = assignment.source_employment_history_id
										and prior_terms.organization_id = employee_row."organizationId"
										and prior_terms.employment_period_id is not null
										and prior_terms.employment_period_id <> period."employmentPeriodId"
								)
							)
							or (
								period."periodStartProvenance" = 'recorded'
								and period."periodStartEmployeeDate" = employee_row."clockOutLocalDate"
								and period."periodStartOrganizationDate" > employee_row."clockOutLocalDate"
								and assignment.effective_until_date is not null
								and assignment.effective_until_date <= period."periodStartOrganizationDate"
							)
						)
					)
					and (
						(
							assignment.source_kind <> 'legacy'
							and assignment.effective_from_date <= employee_row."clockOutLocalDate"
							and (assignment.effective_until_date is null or assignment.effective_until_date > employee_row."clockOutLocalDate")
						)
						or (
							assignment.source_kind = 'employment_terms'
							and assignment.assignment_type = 'employee'
							and assignment.source_employment_history_id is not null
							and period."periodStartProvenance" = 'recorded'
							and period."periodStartEmployeeDate" = employee_row."clockOutLocalDate"
							and period."periodStartOrganizationDate" > employee_row."clockOutLocalDate"
							and assignment.effective_from_date <= period."periodStartOrganizationDate"
							and (assignment.effective_until_date is null or assignment.effective_until_date > period."periodStartOrganizationDate")
							and exists (
								select 1
								from employee_employment_history terms
								where terms.id = assignment.source_employment_history_id
									and terms.organization_id = employee_row."organizationId"
									and terms.employment_period_id = period."employmentPeriodId"
									and terms.review_state = 'confirmed'
							)
						)
						or (
							assignment.source_kind = 'legacy'
							and (assignment.effective_from is null or assignment.effective_from <= ${endTimeDate})
							and (assignment.effective_until is null or assignment.effective_until > ${endTimeDate})
						)
					)
					and (
						(assignment.assignment_type = 'employee' and assignment.employee_id = employee_row.id)
						or (assignment.assignment_type = 'team' and assignment.team_id = employee_row."teamId")
						or (assignment.assignment_type = 'organization' and assignment.employee_id is null and assignment.team_id is null)
					)
				order by assignment.priority desc,
					case assignment.assignment_type
						when 'employee' then 2 when 'team' then 1 else 0 end desc,
					assignment.id
				limit ${MAX_ASSIGNMENT_CANDIDATES + 1}
				for update of assignment
			)
			select employee_row."organizationId" as "employeeOrganizationId",
				employee_row."teamId",
				employee_row."userTimezone",
				employee_row."organizationTimezone",
				period."employmentPeriodId",
				assignment."assignmentId",
				assignment."assignmentOrganizationId", assignment."assignmentType",
				assignment."assignmentPolicyId", assignment.priority,
				assignment."assignmentEffectiveUntilDate",
				assignment."policyEvaluationDate"
			from employee_evidence employee_row
			left join period_evidence period on true
			left join assignment_candidates assignment on true
		`);
		if (
			typeof candidateResult !== "object" ||
			candidateResult === null ||
			!("rows" in candidateResult) ||
			!Array.isArray(candidateResult.rows)
		) {
			throw new Error();
		}
		const selection = selectAssignmentCandidate(candidateResult.rows, input.organizationId);
		const assignment = selection.assignment;
		if (assignment === null) {
			return parsePolicyClockOutBreakSnapshot(
				{
					version: 2,
					evaluatedAt,
					resolution: "none",
					employmentPeriodId: selection.employmentPeriodId,
				},
				evaluatedAt,
			);
		}

		const calendarTimezone = resolveEffectiveTimezone(
			selection.userTimezone,
			selection.organizationTimezone,
		);
		const orgTimezone = resolveOrganizationTimezone(selection.organizationTimezone).timezone;
		const clockOutDate =
			assignment.policyEvaluationDate ?? plainDateAt(input.endTime, calendarTimezone).toString();

		const result = await input.dbService.db.execute(sql`
			with policy_evidence as (
				select policy.id, policy.name, policy.is_active as "policyIsActive",
					policy.updated_at as "policyUpdatedAt",
					to_char((policy.updated_at at time zone 'UTC') at time zone ${orgTimezone}, 'YYYY-MM-DD') as "policyRetiredOnDate"
				from work_policy policy
				where policy.id = ${assignment.policyId}::uuid
					and policy.organization_id = ${input.organizationId}
				limit 2
				for update of policy
			), version_evidence as (
				select version.id as "policyVersionId",
					to_char(version.effective_from_date, 'YYYY-MM-DD') as "effectiveFromDate",
					version.regulation_enabled as "regulationEnabled"
				from policy_evidence policy
				join work_policy_version version
					on version.policy_id = policy.id
					and version.organization_id = ${input.organizationId}
				where version.effective_from_date <= ${clockOutDate}::date
				order by version.effective_from_date desc, version.version_number desc
				limit 1
				for update of version
			), regulation_evidence as (
				select regulation.id,
					regulation.max_uninterrupted_minutes as "maxUninterruptedMinutes"
				from policy_evidence policy
				join version_evidence version on true
				join work_policy_regulation regulation
					on regulation.policy_id = policy.id
					and (regulation.policy_version_id = version."policyVersionId" or regulation.policy_version_id is null)
				where version."regulationEnabled" = true
				limit 2
				for update of regulation
			), rule_evidence as (
				select rule.id,
					rule.working_minutes_threshold as "workingMinutesThreshold",
					rule.required_break_minutes as "requiredBreakMinutes"
				from regulation_evidence regulation
				join work_policy_break_rule rule on rule.regulation_id = regulation.id
				order by rule.working_minutes_threshold, rule.id
				for update of rule
			)
			select policy.id as "policyId", policy.name as "policyName",
				policy."policyIsActive",
				policy."policyUpdatedAt",
				policy."policyRetiredOnDate",
				version."policyVersionId",
				version."effectiveFromDate",
				version."regulationEnabled",
				regulation.id as "regulationId", regulation."maxUninterruptedMinutes",
				coalesce((select json_agg(rule order by rule."workingMinutesThreshold", rule.id) from rule_evidence rule), '[]'::json) as "breakRules"
			from policy_evidence policy
			left join version_evidence version on true
			left join regulation_evidence regulation on true
		`);
		if (
			typeof result !== "object" ||
			result === null ||
			!("rows" in result) ||
			!Array.isArray(result.rows) ||
			result.rows.length !== 1
		) {
			throw new Error();
		}
		const row = result.rows[0] as Record<string, unknown>;
		const policyEligible = (() => {
			if (row.policyIsActive === true) return true;
			if (row.policyIsActive !== false) return false;
			// A2-10 / A3-7: Allow historically eligible capped assignments to resolve a retired policy's
			// historical version for deferred break adjustments while still failing closed on
			// uncapped or post-retirement references.
			if (assignment.effectiveUntilDate === null || clockOutDate >= assignment.effectiveUntilDate) {
				return false;
			}
			const parsePolicyTimestamp = (val: unknown): Instant | null => {
				if (val instanceof Date) return instantFromDate(val);
				if (typeof val !== "string" || val.length === 0) return null;
				const normalized = val.includes("T")
					? val
					: `${val.replace(" ", "T")}${/[zZ]|[+-]\d{2}:?\d{2}$/.test(val) ? "" : "Z"}`;
				return parseInstant(normalized);
			};
			const policyRetiredOnDate =
				typeof row.policyRetiredOnDate === "string" && row.policyRetiredOnDate.length === 10
					? canonicalPlainDate(row.policyRetiredOnDate)
					: (() => {
							const ts = parsePolicyTimestamp(row.policyUpdatedAt);
							return ts ? plainDateAt(ts, orgTimezone).toString() : null;
						})();
			if (
				policyRetiredOnDate !== null &&
				(clockOutDate >= policyRetiredOnDate || assignment.effectiveUntilDate > policyRetiredOnDate)
			) {
				return false;
			}
			return true;
		})();
		if (
			row.policyId !== assignment.policyId ||
			!policyEligible ||
			typeof row.policyName !== "string" ||
			typeof row.policyVersionId !== "string" ||
			typeof row.effectiveFromDate !== "string" ||
			typeof row.regulationEnabled !== "boolean"
		) {
			throw new Error();
		}
		if (row.regulationEnabled === true && row.regulationId === null) throw new Error();
		if (!Array.isArray(row.breakRules)) throw new Error();
		const breakRules = row.breakRules
			.map((value) => {
				if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error();
				const rule = value as Record<string, unknown>;
				if (typeof rule.id !== "string" || !Number.isSafeInteger(rule.workingMinutesThreshold)) {
					throw new Error();
				}
				return value;
			})
			.toSorted((left, right) => {
				const leftRule = left as Record<string, unknown>;
				const rightRule = right as Record<string, unknown>;
				return (
					(leftRule.workingMinutesThreshold as number) -
						(rightRule.workingMinutesThreshold as number) ||
					(leftRule.id as string).localeCompare(rightRule.id as string)
				);
			});
		return parsePolicyClockOutBreakSnapshot(
			{
				version: 2,
				evaluatedAt,
				resolution: "work_policy",
				employmentPeriodId: selection.employmentPeriodId,
				policyVersionId: row.policyVersionId,
				effectiveFromDate: row.effectiveFromDate,
				teamId: assignment.teamId,
				assignment: { id: assignment.id, type: assignment.type },
				policy: { id: row.policyId, name: row.policyName },
				regulationEnabled: row.regulationEnabled,
				regulation: {
					id: row.regulationId,
					name: row.regulationEnabled ? row.policyName : null,
					maxUninterruptedMinutes: row.maxUninterruptedMinutes,
				},
				breakRules,
			},
			evaluatedAt,
		);
	} catch {
		throw new Error("Policy clock-out break snapshot resolution failed");
	}
}
