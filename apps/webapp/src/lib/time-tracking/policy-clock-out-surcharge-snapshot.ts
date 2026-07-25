import { sql } from "drizzle-orm";
import { parsePostgresTimestampWithoutTimeZoneAsUtc } from "@/db/postgres-utc";
import {
	compareInstants,
	comparePlainDates,
	dateFromInstant,
	type Instant,
	instantFromDate,
	instantToCanonicalString,
	parseInstant,
	parsePlainDate,
	parsePlainTimeMinute,
} from "@/lib/datetime/temporal-core";
import type {
	PolicyClockOutSurchargeRuleSnapshot,
	PolicyClockOutSurchargeSnapshot,
} from "./policy-clock-out-surcharge-snapshot.types";

export type {
	OrdinarySurchargeRuleSnapshot,
	OrdinarySurchargeSnapshot,
	PolicyClockOutSurchargeRuleSnapshot,
	PolicyClockOutSurchargeSnapshot,
} from "./policy-clock-out-surcharge-snapshot.types";

const UUID =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const DECIMAL = /^(?:0|[1-9])\d*\.\d{4}$/;
const DAYS = new Set([
	"monday",
	"tuesday",
	"wednesday",
	"thursday",
	"friday",
	"saturday",
	"sunday",
]);
const ERROR = "Policy clock-out surcharge snapshot is invalid";

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

function integer(value: unknown): number {
	return Number.isSafeInteger(value) ? (value as number) : fail();
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

function nullableInstant(value: unknown): string | null {
	return value === null ? null : canonicalInstant(value);
}

function plainDate(value: unknown): string {
	if (typeof value !== "string") return fail();
	try {
		return parsePlainDate(value).toString() === value ? value : fail();
	} catch {
		return fail();
	}
}

function nullablePlainDate(value: unknown): string | null {
	return value === null ? null : plainDate(value);
}

function plainTime(value: unknown): string {
	if (typeof value !== "string") return fail();
	try {
		return parsePlainTimeMinute(value).toString({ smallestUnit: "minute" }) ===
			value
			? value
			: fail();
	} catch {
		return fail();
	}
}

function nullablePlainTime(value: unknown): string | null {
	return value === null ? null : plainTime(value);
}

function percentage(value: unknown): string {
	if (typeof value !== "string" || !DECIMAL.test(value)) return fail();
	const numeric = Number(value);
	return Number.isFinite(numeric) && numeric > 0 && numeric <= 10
		? value
		: fail();
}

function parseRule(
	value: unknown,
): Readonly<PolicyClockOutSurchargeRuleSnapshot> {
	const rule = exact(value, [
		"id",
		"name",
		"ruleType",
		"percentage",
		"dayOfWeek",
		"windowStartTime",
		"windowEndTime",
		"specificDate",
		"dateRangeStart",
		"dateRangeEnd",
		"priority",
		"validFrom",
		"validUntil",
	]);
	if (
		rule.ruleType !== "time_window" &&
		rule.ruleType !== "day_of_week" &&
		rule.ruleType !== "date_based"
	) {
		return fail();
	}
	const parsed = {
		id: uuid(rule.id),
		name: name(rule.name),
		ruleType: rule.ruleType,
		percentage: percentage(rule.percentage),
		dayOfWeek:
			rule.dayOfWeek === null
				? null
				: typeof rule.dayOfWeek === "string" && DAYS.has(rule.dayOfWeek)
					? (rule.dayOfWeek as NonNullable<
							PolicyClockOutSurchargeRuleSnapshot["dayOfWeek"]
						>)
					: fail(),
		windowStartTime: nullablePlainTime(rule.windowStartTime),
		windowEndTime: nullablePlainTime(rule.windowEndTime),
		specificDate: nullablePlainDate(rule.specificDate),
		dateRangeStart: nullablePlainDate(rule.dateRangeStart),
		dateRangeEnd: nullablePlainDate(rule.dateRangeEnd),
		priority: integer(rule.priority),
		validFrom: nullableInstant(rule.validFrom),
		validUntil: nullableInstant(rule.validUntil),
	} satisfies PolicyClockOutSurchargeRuleSnapshot;
	if (
		(parsed.validFrom !== null &&
			parsed.validUntil !== null &&
			compareInstants(
				parseInstant(parsed.validFrom),
				parseInstant(parsed.validUntil),
			) > 0) ||
		(parsed.ruleType === "day_of_week" &&
			(parsed.dayOfWeek === null ||
				parsed.windowStartTime !== null ||
				parsed.windowEndTime !== null ||
				parsed.specificDate !== null ||
				parsed.dateRangeStart !== null ||
				parsed.dateRangeEnd !== null)) ||
		(parsed.ruleType === "time_window" &&
			(parsed.dayOfWeek !== null ||
				parsed.windowStartTime === null ||
				parsed.windowEndTime === null ||
				parsed.specificDate !== null ||
				parsed.dateRangeStart !== null ||
				parsed.dateRangeEnd !== null)) ||
		(parsed.ruleType === "date_based" &&
			(parsed.dayOfWeek !== null ||
				parsed.windowStartTime !== null ||
				parsed.windowEndTime !== null ||
				!(
					(parsed.specificDate !== null &&
						parsed.dateRangeStart === null &&
						parsed.dateRangeEnd === null) ||
					(parsed.specificDate === null &&
						parsed.dateRangeStart !== null &&
						parsed.dateRangeEnd !== null &&
						comparePlainDates(
							parsePlainDate(parsed.dateRangeStart),
							parsePlainDate(parsed.dateRangeEnd),
						) <= 0)
				)))
	) {
		return fail();
	}
	return Object.freeze(parsed);
}

export function parsePolicyClockOutSurchargeSnapshot(
	value: unknown,
	expectedEvaluatedAt: string,
): PolicyClockOutSurchargeSnapshot {
	try {
		const evaluatedAt = canonicalInstant(expectedEvaluatedAt);
		const root = exact(value, ["version", "evaluatedAt", "resolution"]);
		if (
			root.version !== 1 ||
			canonicalInstant(root.evaluatedAt) !== evaluatedAt
		) {
			return fail();
		}
		const kind =
			typeof root.resolution === "object" && root.resolution !== null
				? Object.getOwnPropertyDescriptor(root.resolution, "kind")
				: undefined;
		if (!kind?.enumerable || !("value" in kind)) return fail();
		if (kind.value === "none") {
			exact(root.resolution, ["kind"]);
			return Object.freeze({
				version: 1,
				evaluatedAt,
				resolution: Object.freeze({ kind: "none" }),
			});
		}
		const resolution = exact(root.resolution, [
			"kind",
			"teamId",
			"assignmentId",
			"assignmentType",
			"assignmentPriority",
			"modelId",
			"modelName",
			"rules",
		]);
		if (
			resolution.kind !== "surcharge_model" ||
			(resolution.assignmentType !== "employee" &&
				resolution.assignmentType !== "team" &&
				resolution.assignmentType !== "organization") ||
			!Array.isArray(resolution.rules)
		) {
			return fail();
		}
		const rules = resolution.rules.map(parseRule);
		if (
			new Set(rules.map((rule) => rule.id)).size !== rules.length ||
			rules.some((rule, index) => {
				const previous = rules[index - 1];
				return (
					previous !== undefined &&
					(previous.priority < rule.priority ||
						(previous.priority === rule.priority &&
							previous.id.localeCompare(rule.id) >= 0))
				);
			})
		) {
			return fail();
		}
		return Object.freeze({
			version: 1,
			evaluatedAt,
			resolution: Object.freeze({
				kind: "surcharge_model",
				teamId: resolution.teamId === null ? null : uuid(resolution.teamId),
				assignmentId: uuid(resolution.assignmentId),
				assignmentType: resolution.assignmentType,
				assignmentPriority: integer(resolution.assignmentPriority),
				modelId: uuid(resolution.modelId),
				modelName: name(resolution.modelName),
				rules: Object.freeze(rules),
			}),
		});
	} catch {
		throw new Error(ERROR);
	}
}

export function policyClockOutSurchargeSnapshotsEqual(
	left: unknown,
	right: unknown,
	expectedEvaluatedAt: string,
): boolean {
	try {
		return (
			JSON.stringify(
				parsePolicyClockOutSurchargeSnapshot(left, expectedEvaluatedAt),
			) ===
			JSON.stringify(
				parsePolicyClockOutSurchargeSnapshot(right, expectedEvaluatedAt),
			)
		);
	} catch {
		return false;
	}
}

export function policyClockOutSurchargeSnapshotFromPendingChanges(
	value: unknown,
	expectedEvaluatedAt: string,
): PolicyClockOutSurchargeSnapshot {
	try {
		if (typeof value !== "object" || value === null || Array.isArray(value))
			fail();
		const descriptor = Object.getOwnPropertyDescriptor(
			value,
			"surchargeSnapshot",
		);
		if (!descriptor?.enumerable || !("value" in descriptor)) return fail();
		return parsePolicyClockOutSurchargeSnapshot(
			descriptor.value,
			expectedEvaluatedAt,
		);
	} catch {
		throw new Error(ERROR);
	}
}

const MAX_ASSIGNMENT_CANDIDATES = 64;

interface AssignmentCandidate {
	teamId: string | null;
	id: string;
	type: "employee" | "team" | "organization";
	modelId: string;
	priority: number;
}

function rows(value: unknown): unknown[] {
	if (
		typeof value !== "object" ||
		value === null ||
		!("rows" in value) ||
		!Array.isArray(value.rows)
	) {
		return fail();
	}
	return value.rows;
}

function selectAssignment(
	values: readonly unknown[],
	organizationId: string,
): AssignmentCandidate | null {
	if (values.length === 0 || values.length > MAX_ASSIGNMENT_CANDIDATES) fail();
	const candidates: AssignmentCandidate[] = [];
	for (const value of values) {
		if (typeof value !== "object" || value === null || Array.isArray(value))
			fail();
		const row = value as Record<string, unknown>;
		if (row.employeeOrganizationId !== organizationId) fail();
		if (row.assignmentId === null) {
			if (
				values.length !== 1 ||
				row.assignmentOrganizationId !== null ||
				row.assignmentType !== null ||
				row.assignmentModelId !== null ||
				row.assignmentPriority !== null
			) {
				fail();
			}
			return null;
		}
		if (
			row.assignmentOrganizationId !== organizationId ||
			(row.assignmentType !== "employee" &&
				row.assignmentType !== "team" &&
				row.assignmentType !== "organization")
		) {
			fail();
		}
		candidates.push({
			teamId: row.teamId === null ? null : uuid(row.teamId),
			id: uuid(row.assignmentId),
			type: row.assignmentType,
			modelId: uuid(row.assignmentModelId),
			priority: integer(row.assignmentPriority),
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
				left.id.localeCompare(right.id),
		)[0] ?? fail()
	);
}

function dateToPlainDate(value: unknown): string | null {
	if (value === null) return null;
	if (!(value instanceof Date)) fail();
	return instantFromDate(value)
		.toZonedDateTimeISO("UTC")
		.toPlainDate()
		.toString();
}

function dateToInstant(value: unknown): string | null {
	if (value === null) return null;
	if (value instanceof Date) {
		return instantToCanonicalString(instantFromDate(value));
	}
	if (typeof value === "string") {
		if (/(?:Z|[+-]\d{2}(?::?\d{2})?)$/.test(value)) {
			return instantToCanonicalString(parseInstant(value.replace(" ", "T")));
		}
		const databaseDate = parsePostgresTimestampWithoutTimeZoneAsUtc(
			value.replace("T", " "),
		);
		if (!(databaseDate instanceof Date)) return fail();
		return instantToCanonicalString(instantFromDate(databaseDate));
	}
	return fail();
}

export async function resolvePolicyClockOutSurchargeSnapshotInTransaction(input: {
	dbService: {
		db: { execute(query: ReturnType<typeof sql>): Promise<unknown> };
	};
	organizationId: string;
	employeeId: string;
	startTime: Instant;
	endTime: Instant;
}): Promise<PolicyClockOutSurchargeSnapshot> {
	const evaluatedAt = instantToCanonicalString(input.endTime);
	try {
		if (compareInstants(input.startTime, input.endTime) > 0) fail();
		const organizationResult = await input.dbService.db.execute(sql`
			select organization.id as "organizationId",
				organization.surcharges_enabled as "surchargesEnabled"
			from organization
			where organization.id = ${input.organizationId}
			limit 2
			for update of organization
		`);
		const organizationRows = rows(organizationResult);
		if (organizationRows.length !== 1) fail();
		const organizationEvidence = organizationRows[0] as Record<string, unknown>;
		if (
			organizationEvidence.organizationId !== input.organizationId ||
			typeof organizationEvidence.surchargesEnabled !== "boolean"
		) {
			fail();
		}
		if (!organizationEvidence.surchargesEnabled) {
			return parsePolicyClockOutSurchargeSnapshot(
				{ version: 1, evaluatedAt, resolution: { kind: "none" } },
				evaluatedAt,
			);
		}

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
					assignment.model_id as "assignmentModelId",
					assignment.priority as "assignmentPriority"
				from employee_evidence employee_row
				join surcharge_model_assignment assignment
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
					case assignment.assignment_type when 'employee' then 2 when 'team' then 1 else 0 end desc,
					assignment.id
				limit ${MAX_ASSIGNMENT_CANDIDATES + 1}
				for update of assignment
			)
			select employee_row."organizationId" as "employeeOrganizationId",
				employee_row."teamId", assignment."assignmentId",
				assignment."assignmentOrganizationId", assignment."assignmentType",
				assignment."assignmentModelId", assignment."assignmentPriority"
			from employee_evidence employee_row
			left join assignment_candidates assignment on true
		`);
		const assignment = selectAssignment(
			rows(candidateResult),
			input.organizationId,
		);
		if (assignment === null) {
			return parsePolicyClockOutSurchargeSnapshot(
				{ version: 1, evaluatedAt, resolution: { kind: "none" } },
				evaluatedAt,
			);
		}

		const modelResult = await input.dbService.db.execute(sql`
			with model_evidence as (
				select model.id, model.organization_id as "organizationId", model.name,
					model.is_active as "isActive"
				from surcharge_model model
				where model.id = ${assignment.modelId}::uuid
					and model.organization_id = ${input.organizationId}
					and model.is_active = true
				limit 2
				for update of model
			), rule_evidence as (
				select rule.id, rule.name, rule.rule_type as "ruleType", rule.percentage::text as percentage,
					rule.day_of_week as "dayOfWeek", rule.window_start_time as "windowStartTime",
					rule.window_end_time as "windowEndTime", rule.specific_date as "specificDate",
					rule.date_range_start as "dateRangeStart", rule.date_range_end as "dateRangeEnd",
					rule.priority, rule.valid_from as "validFrom", rule.valid_until as "validUntil"
				from model_evidence model
				join surcharge_rule rule on rule.model_id = model.id
				where rule.is_active = true
					and (rule.valid_from is null or rule.valid_from <= ${dateFromInstant(input.endTime)})
					and (rule.valid_until is null or rule.valid_until >= ${dateFromInstant(input.startTime)})
				order by rule.priority desc, rule.id
				for update of rule
			)
			select model.id as "modelId", model."organizationId" as "modelOrganizationId",
				model.name as "modelName", model."isActive" as "modelIsActive",
				coalesce((select json_agg(rule order by rule.priority desc, rule.id) from rule_evidence rule), '[]'::json) as rules
			from model_evidence model
		`);
		const modelRows = rows(modelResult);
		if (modelRows.length !== 1) fail();
		const model = modelRows[0] as Record<string, unknown>;
		if (
			model.modelId !== assignment.modelId ||
			model.modelOrganizationId !== input.organizationId ||
			model.modelIsActive !== true ||
			typeof model.modelName !== "string" ||
			!Array.isArray(model.rules)
		) {
			fail();
		}
		const rules = model.rules
			.map((value) => {
				if (typeof value !== "object" || value === null || Array.isArray(value))
					fail();
				const rule = value as Record<string, unknown>;
				return {
					id: rule.id,
					name: rule.name,
					ruleType: rule.ruleType,
					percentage: rule.percentage,
					dayOfWeek: rule.dayOfWeek ?? null,
					windowStartTime: rule.windowStartTime ?? null,
					windowEndTime: rule.windowEndTime ?? null,
					specificDate:
						typeof rule.specificDate === "string"
							? rule.specificDate
							: dateToPlainDate(rule.specificDate ?? null),
					dateRangeStart:
						typeof rule.dateRangeStart === "string"
							? rule.dateRangeStart
							: dateToPlainDate(rule.dateRangeStart ?? null),
					dateRangeEnd:
						typeof rule.dateRangeEnd === "string"
							? rule.dateRangeEnd
							: dateToPlainDate(rule.dateRangeEnd ?? null),
					priority: rule.priority,
					validFrom: dateToInstant(rule.validFrom ?? null),
					validUntil: dateToInstant(rule.validUntil ?? null),
				};
			})
			.toSorted((left, right) => {
				const priority = integer(right.priority) - integer(left.priority);
				return priority || String(left.id).localeCompare(String(right.id));
			});
		return parsePolicyClockOutSurchargeSnapshot(
			{
				version: 1,
				evaluatedAt,
				resolution: {
					kind: "surcharge_model",
					teamId: assignment.teamId,
					assignmentId: assignment.id,
					assignmentType: assignment.type,
					assignmentPriority: assignment.priority,
					modelId: model.modelId,
					modelName: model.modelName,
					rules,
				},
			},
			evaluatedAt,
		);
	} catch {
		throw new Error("Policy clock-out surcharge snapshot resolution failed");
	}
}

export const parseOrdinarySurchargeSnapshot =
	parsePolicyClockOutSurchargeSnapshot;
export const ordinarySurchargeSnapshotsEqual =
	policyClockOutSurchargeSnapshotsEqual;
export const ordinarySurchargeSnapshotFromPendingChanges =
	policyClockOutSurchargeSnapshotFromPendingChanges;
export const resolveOrdinarySurchargeSnapshotInTransaction =
	resolvePolicyClockOutSurchargeSnapshotInTransaction;
