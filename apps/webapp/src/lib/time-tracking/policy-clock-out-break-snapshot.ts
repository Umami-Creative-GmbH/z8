import { sql } from "drizzle-orm";
import {
	dateFromInstant,
	type Instant,
	instantToCanonicalString,
	parseInstant,
} from "@/lib/datetime/temporal-core";

const UUID =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ERROR = "Policy clock-out break snapshot is invalid";

export interface PolicyClockOutBreakRuleSnapshot {
	readonly id: string;
	readonly workingMinutesThreshold: number;
	readonly requiredBreakMinutes: number;
}

export type PolicyClockOutBreakSnapshot =
	| Readonly<{
			version: 1;
			evaluatedAt: string;
			resolution: "none";
	  }>
	| Readonly<{
			version: 1;
			evaluatedAt: string;
			resolution: "work_policy";
			teamId: string | null;
			assignment: Readonly<{
				id: string;
				type: "employee" | "team" | "organization";
			}>;
			policy: Readonly<{ id: string; name: string }>;
			regulationEnabled: boolean;
			regulation: Readonly<{
				id: string | null;
				name: string | null;
				maxUninterruptedMinutes: number | null;
			}>;
			breakRules: readonly Readonly<PolicyClockOutBreakRuleSnapshot>[];
	  }>;

function fail(): never {
	throw new Error(ERROR);
}

function exact(
	value: unknown,
	keys: readonly string[],
): Record<string, unknown> {
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
	if (
		ownKeys.length !== keys.length ||
		ownKeys.some((key) => typeof key !== "string" || !keys.includes(key))
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
	return Number.isSafeInteger(value) && (value as number) >= 0
		? (value as number)
		: fail();
}

function canonicalInstant(value: unknown): string {
	if (typeof value !== "string") return fail();
	try {
		return instantToCanonicalString(parseInstant(value)) === value
			? value
			: fail();
	} catch {
		return fail();
	}
}

export function parsePolicyClockOutBreakSnapshot(
	value: unknown,
	expectedEvaluatedAt: string,
): PolicyClockOutBreakSnapshot {
	try {
		const evaluatedAt = canonicalInstant(expectedEvaluatedAt);
		const root = exact(
			value,
			typeof value === "object" &&
				value !== null &&
				(value as { resolution?: unknown }).resolution === "none"
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
		if (
			root.version !== 1 ||
			canonicalInstant(root.evaluatedAt) !== evaluatedAt
		) {
			return fail();
		}
		if (root.resolution === "none") {
			return Object.freeze({ version: 1, evaluatedAt, resolution: "none" });
		}
		if (root.resolution !== "work_policy") return fail();
		const assignment = exact(root.assignment, ["id", "type"]);
		if (
			assignment.type !== "employee" &&
			assignment.type !== "team" &&
			assignment.type !== "organization"
		) {
			return fail();
		}
		const policy = exact(root.policy, ["id", "name"]);
		const regulation = exact(root.regulation, [
			"id",
			"name",
			"maxUninterruptedMinutes",
		]);
		if (typeof root.regulationEnabled !== "boolean") return fail();
		if (!Array.isArray(root.breakRules)) return fail();
		const breakRules = root.breakRules.map((value) => {
			const rule = exact(value, [
				"id",
				"workingMinutesThreshold",
				"requiredBreakMinutes",
			]);
			return Object.freeze({
				id: uuid(rule.id),
				workingMinutesThreshold: minutes(rule.workingMinutesThreshold),
				requiredBreakMinutes: minutes(rule.requiredBreakMinutes),
			});
		});
		if (
			new Set(breakRules.map((rule) => rule.id)).size !== breakRules.length ||
			new Set(breakRules.map((rule) => rule.workingMinutesThreshold)).size !==
				breakRules.length ||
			breakRules.some((rule, index) => {
				const previous = breakRules[index - 1];
				return (
					previous !== undefined &&
					(previous.workingMinutesThreshold > rule.workingMinutesThreshold ||
						(previous.workingMinutesThreshold ===
							rule.workingMinutesThreshold &&
							previous.id.localeCompare(rule.id) >= 0))
				);
			})
		) {
			return fail();
		}
		const regulationEnabled = root.regulationEnabled;
		const regulationId = regulation.id === null ? null : uuid(regulation.id);
		const regulationName =
			regulation.name === null ? null : name(regulation.name);
		const maxUninterruptedMinutes =
			regulation.maxUninterruptedMinutes === null
				? null
				: minutes(regulation.maxUninterruptedMinutes);
		if (
			(regulationEnabled &&
				(regulationId === null || regulationName === null)) ||
			(!regulationEnabled &&
				(regulationId !== null ||
					regulationName !== null ||
					maxUninterruptedMinutes !== null ||
					breakRules.length !== 0))
		) {
			return fail();
		}
		return Object.freeze({
			version: 1,
			evaluatedAt,
			resolution: "work_policy",
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
		});
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
			JSON.stringify(
				parsePolicyClockOutBreakSnapshot(left, expectedEvaluatedAt),
			) ===
			JSON.stringify(
				parsePolicyClockOutBreakSnapshot(right, expectedEvaluatedAt),
			)
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
		const descriptor = Object.getOwnPropertyDescriptor(
			value,
			"breakPolicySnapshot",
		);
		if (!descriptor?.enumerable || !("value" in descriptor)) return fail();
		return parsePolicyClockOutBreakSnapshot(
			descriptor.value,
			expectedEvaluatedAt,
		);
	} catch {
		throw new Error(ERROR);
	}
}

const MAX_ASSIGNMENT_CANDIDATES = 64;

type AssignmentCandidate = Readonly<{
	teamId: string | null;
	id: string;
	type: "employee" | "team" | "organization";
	policyId: string;
	priority: number;
}>;

function selectAssignmentCandidate(
	rows: readonly unknown[],
	organizationId: string,
): AssignmentCandidate | null {
	if (rows.length === 0 || rows.length > MAX_ASSIGNMENT_CANDIDATES) fail();
	const candidates: AssignmentCandidate[] = [];
	for (const value of rows) {
		if (typeof value !== "object" || value === null || Array.isArray(value)) {
			fail();
		}
		const row = value as Record<string, unknown>;
		if (row.employeeOrganizationId !== organizationId) fail();
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
			return null;
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
			teamId:
				row.teamId === null || typeof row.teamId === "string"
					? row.teamId
					: fail(),
			id: row.assignmentId,
			type: row.assignmentType,
			policyId: row.assignmentPolicyId,
			priority: row.priority as number,
		});
	}
	if (new Set(candidates.map(({ id }) => id)).size !== candidates.length)
		fail();
	const specificity = { employee: 2, team: 1, organization: 0 } as const;
	return (
		candidates.toSorted(
			(left, right) =>
				right.priority - left.priority ||
				specificity[right.type] - specificity[left.type] ||
				(left.id < right.id ? -1 : left.id > right.id ? 1 : 0),
		)[0] ?? fail()
	);
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
	try {
		const candidateResult = await input.dbService.db.execute(sql`
			with employee_evidence as (
				select employee.id, employee.organization_id as "organizationId",
					employee.team_id as "teamId"
				from employee
				where employee.id = ${input.employeeId}::uuid
					and employee.organization_id = ${input.organizationId}
				limit 2
				for update of employee
			), assignment_candidates as (
				select employee_row."organizationId" as "employeeOrganizationId",
					employee_row."teamId", assignment.id as "assignmentId",
					assignment.organization_id as "assignmentOrganizationId",
					assignment.assignment_type as "assignmentType",
					assignment.policy_id as "assignmentPolicyId", assignment.priority
				from employee_evidence employee_row
				join work_policy_assignment assignment
					on assignment.organization_id = employee_row."organizationId"
				where assignment.organization_id = ${input.organizationId}
					and assignment.is_active = true
					and (assignment.effective_from is null or assignment.effective_from <= ${dateFromInstant(input.endTime)})
					and (assignment.effective_until is null or assignment.effective_until >= ${dateFromInstant(input.endTime)})
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
				employee_row."teamId", assignment."assignmentId",
				assignment."assignmentOrganizationId", assignment."assignmentType",
				assignment."assignmentPolicyId", assignment.priority
			from employee_evidence employee_row
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
		const assignment = selectAssignmentCandidate(
			candidateResult.rows,
			input.organizationId,
		);
		if (assignment === null) {
			return parsePolicyClockOutBreakSnapshot(
				{ version: 1, evaluatedAt, resolution: "none" },
				evaluatedAt,
			);
		}

		const result = await input.dbService.db.execute(sql`
			with policy_evidence as (
				select policy.id, policy.name, policy.is_active as "policyIsActive",
					policy.regulation_enabled as "regulationEnabled"
				from work_policy policy
				where policy.id = ${assignment.policyId}::uuid
					and policy.organization_id = ${input.organizationId}
				limit 2
				for update of policy
			), regulation_evidence as (
				select regulation.id,
					regulation.max_uninterrupted_minutes as "maxUninterruptedMinutes"
				from policy_evidence policy
				join work_policy_regulation regulation on regulation.policy_id = policy.id
				where policy."regulationEnabled" = true
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
				policy."policyIsActive", policy."regulationEnabled",
				regulation.id as "regulationId", regulation."maxUninterruptedMinutes",
				coalesce((select json_agg(rule order by rule."workingMinutesThreshold", rule.id) from rule_evidence rule), '[]'::json) as "breakRules"
			from policy_evidence policy
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
		if (
			row.policyId !== assignment.policyId ||
			row.policyIsActive !== true ||
			typeof row.policyName !== "string" ||
			typeof row.regulationEnabled !== "boolean"
		) {
			throw new Error();
		}
		if (row.regulationEnabled === true && row.regulationId === null)
			throw new Error();
		if (!Array.isArray(row.breakRules)) throw new Error();
		const breakRules = row.breakRules
			.map((value) => {
				if (typeof value !== "object" || value === null || Array.isArray(value))
					throw new Error();
				const rule = value as Record<string, unknown>;
				if (
					typeof rule.id !== "string" ||
					!Number.isSafeInteger(rule.workingMinutesThreshold)
				) {
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
				version: 1,
				evaluatedAt,
				resolution: "work_policy",
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
