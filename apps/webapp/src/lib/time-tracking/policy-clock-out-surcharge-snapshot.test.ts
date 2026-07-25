import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";
import { parseInstant } from "@/lib/datetime/temporal-core";
import {
	parsePolicyClockOutSurchargeSnapshot,
	policyClockOutSurchargeSnapshotsEqual,
	resolvePolicyClockOutSurchargeSnapshotInTransaction,
} from "./policy-clock-out-surcharge-snapshot";

const evaluatedAt = "2026-07-19T10:00:00Z";
const periodStartedAt = "2026-07-19T08:00:00Z";
const ids = {
	team: "10000000-0000-4000-8000-000000000001",
	assignment: "20000000-0000-4000-8000-000000000001",
	model: "30000000-0000-4000-8000-000000000001",
	timeRule: "40000000-0000-4000-8000-000000000001",
	dayRule: "40000000-0000-4000-8000-000000000002",
	dateRule: "40000000-0000-4000-8000-000000000003",
	employee: "50000000-0000-4000-8000-000000000001",
} as const;

const rules = [
	{
		id: ids.timeRule,
		name: "Night",
		ruleType: "time_window",
		percentage: "0.5000",
		dayOfWeek: null,
		windowStartTime: "22:00",
		windowEndTime: "06:00",
		specificDate: null,
		dateRangeStart: null,
		dateRangeEnd: null,
		priority: 9,
		validFrom: "2026-01-01T00:00:00Z",
		validUntil: null,
	},
	{
		id: ids.dayRule,
		name: "Sunday",
		ruleType: "day_of_week",
		percentage: "1.0000",
		dayOfWeek: "sunday",
		windowStartTime: null,
		windowEndTime: null,
		specificDate: null,
		dateRangeStart: null,
		dateRangeEnd: null,
		priority: 8,
		validFrom: null,
		validUntil: "2026-12-31T23:59:59Z",
	},
	{
		id: ids.dateRule,
		name: "Summer",
		ruleType: "date_based",
		percentage: "0.2500",
		dayOfWeek: null,
		windowStartTime: null,
		windowEndTime: null,
		specificDate: null,
		dateRangeStart: "2026-07-01",
		dateRangeEnd: "2026-07-31",
		priority: 7,
		validFrom: null,
		validUntil: null,
	},
] as const;

const modelSnapshot = {
	version: 1,
	evaluatedAt,
	resolution: {
		kind: "surcharge_model",
		teamId: ids.team,
		assignmentId: ids.assignment,
		assignmentType: "team",
		assignmentPriority: 4,
		modelId: ids.model,
		modelName: "Standard",
		rules,
	},
} as const;

describe("parsePolicyClockOutSurchargeSnapshot", () => {
	it("returns detached deeply frozen complete evidence", () => {
		const input = structuredClone(modelSnapshot);
		const parsed = parsePolicyClockOutSurchargeSnapshot(input, evaluatedAt);

		expect(parsed).toEqual(modelSnapshot);
		expect(parsed).not.toBe(input);
		expect(Object.isFrozen(parsed)).toBe(true);
		expect(Object.isFrozen(parsed.resolution)).toBe(true);
		if (parsed.resolution.kind === "surcharge_model") {
			expect(Object.isFrozen(parsed.resolution.rules)).toBe(true);
			expect(Object.isFrozen(parsed.resolution.rules[0])).toBe(true);
		}
	});

	it("accepts only the strict no-assignment resolution", () => {
		expect(
			parsePolicyClockOutSurchargeSnapshot(
				{ version: 1, evaluatedAt, resolution: { kind: "none" } },
				evaluatedAt,
			),
		).toEqual({ version: 1, evaluatedAt, resolution: { kind: "none" } });
	});

	it.each([
		["unknown root key", { ...modelSnapshot, private: true }],
		[
			"unknown resolution key",
			{
				...modelSnapshot,
				resolution: { ...modelSnapshot.resolution, private: true },
			},
		],
		[
			"wrong evaluated instant",
			{ ...modelSnapshot, evaluatedAt: "2026-07-19T10:01:00Z" },
		],
		[
			"noncanonical instant",
			{ ...modelSnapshot, evaluatedAt: "2026-07-19T10:00:00.000Z" },
		],
		[
			"invalid UUID",
			{
				...modelSnapshot,
				resolution: { ...modelSnapshot.resolution, modelId: "model-1" },
			},
		],
		[
			"noncanonical decimal",
			{
				...modelSnapshot,
				resolution: {
					...modelSnapshot.resolution,
					rules: [{ ...rules[0], percentage: "0.5" }, ...rules.slice(1)],
				},
			},
		],
		[
			"zero percentage",
			{
				...modelSnapshot,
				resolution: {
					...modelSnapshot.resolution,
					rules: [{ ...rules[0], percentage: "0.0000" }, ...rules.slice(1)],
				},
			},
		],
		[
			"invalid time",
			{
				...modelSnapshot,
				resolution: {
					...modelSnapshot.resolution,
					rules: [{ ...rules[0], windowStartTime: "24:00" }, ...rules.slice(1)],
				},
			},
		],
		[
			"invalid date",
			{
				...modelSnapshot,
				resolution: {
					...modelSnapshot.resolution,
					rules: [
						...rules.slice(0, 2),
						{ ...rules[2], dateRangeEnd: "2026-02-30" },
					],
				},
			},
		],
		[
			"invalid day enum",
			{
				...modelSnapshot,
				resolution: {
					...modelSnapshot.resolution,
					rules: [rules[0], { ...rules[1], dayOfWeek: "holiday" }, rules[2]],
				},
			},
		],
		[
			"mixed day fields",
			{
				...modelSnapshot,
				resolution: {
					...modelSnapshot.resolution,
					rules: [
						rules[0],
						{ ...rules[1], windowStartTime: "09:00" },
						rules[2],
					],
				},
			},
		],
		[
			"incomplete time window",
			{
				...modelSnapshot,
				resolution: {
					...modelSnapshot.resolution,
					rules: [{ ...rules[0], windowEndTime: null }, ...rules.slice(1)],
				},
			},
		],
		[
			"mixed date variants",
			{
				...modelSnapshot,
				resolution: {
					...modelSnapshot.resolution,
					rules: [
						...rules.slice(0, 2),
						{ ...rules[2], specificDate: "2026-07-19" },
					],
				},
			},
		],
		[
			"reversed date range",
			{
				...modelSnapshot,
				resolution: {
					...modelSnapshot.resolution,
					rules: [
						...rules.slice(0, 2),
						{ ...rules[2], dateRangeStart: "2026-08-01" },
					],
				},
			},
		],
		[
			"reversed validity",
			{
				...modelSnapshot,
				resolution: {
					...modelSnapshot.resolution,
					rules: [
						{ ...rules[0], validUntil: "2025-12-31T23:59:59Z" },
						...rules.slice(1),
					],
				},
			},
		],
		[
			"duplicate rule",
			{
				...modelSnapshot,
				resolution: {
					...modelSnapshot.resolution,
					rules: [rules[0], { ...rules[1], id: rules[0].id }, rules[2]],
				},
			},
		],
		[
			"unsorted rules",
			{
				...modelSnapshot,
				resolution: {
					...modelSnapshot.resolution,
					rules: [...rules].reverse(),
				},
			},
		],
	] as const)("rejects %s", (_label, value) => {
		expect(() =>
			parsePolicyClockOutSurchargeSnapshot(value, evaluatedAt),
		).toThrow("Policy clock-out surcharge snapshot is invalid");
	});

	it("compares exact normalized evidence without sorting", () => {
		expect(
			policyClockOutSurchargeSnapshotsEqual(
				modelSnapshot,
				structuredClone(modelSnapshot),
				evaluatedAt,
			),
		).toBe(true);
		expect(
			policyClockOutSurchargeSnapshotsEqual(
				modelSnapshot,
				{
					...modelSnapshot,
					resolution: {
						...modelSnapshot.resolution,
						rules: [...rules].reverse(),
					},
				},
				evaluatedAt,
			),
		).toBe(false);
	});
});

describe("resolvePolicyClockOutSurchargeSnapshotInTransaction", () => {
	function candidate(input: {
		id: string;
		type: "employee" | "team" | "organization";
		priority: number;
		modelId?: string;
		organizationId?: string;
	}) {
		return {
			employeeOrganizationId: "org-1",
			teamId: ids.team,
			assignmentId: input.id,
			assignmentOrganizationId: input.organizationId ?? "org-1",
			assignmentType: input.type,
			assignmentModelId: input.modelId ?? ids.model,
			assignmentPriority: input.priority,
		};
	}

	function modelRow(modelId = ids.model) {
		return {
			modelId,
			modelOrganizationId: "org-1",
			modelName: "Standard",
			modelIsActive: true,
			rules: rules.map((rule) => ({ ...rule, isActive: true })),
		};
	}

	async function resolve(
		execute: ReturnType<typeof vi.fn>,
		organizationRows: unknown[] = [
			{ organizationId: "org-1", surchargesEnabled: true },
		],
	) {
		const dialect = new PgDialect();
		const dbExecute = vi.fn(async (query: SQL) => {
			const compiled = dialect.sqlToQuery(query);
			if (compiled.sql.includes("from organization")) {
				return { rows: organizationRows };
			}
			return execute(query);
		});
		return resolvePolicyClockOutSurchargeSnapshotInTransaction({
			dbService: { db: { execute: dbExecute } } as never,
			organizationId: "org-1",
			employeeId: ids.employee,
			startTime: parseInstant(periodStartedAt),
			endTime: parseInstant(evaluatedAt),
		});
	}

	it("captures disabled surcharge state as none without resolving assignments", async () => {
		const execute = vi.fn();

		await expect(
			resolve(execute, [{ organizationId: "org-1", surchargesEnabled: false }]),
		).resolves.toEqual({
			version: 1,
			evaluatedAt,
			resolution: { kind: "none" },
		});
		expect(execute).not.toHaveBeenCalled();
	});

	it.each([
		["missing", []],
		[
			"duplicate",
			[
				{ organizationId: "org-1", surchargesEnabled: true },
				{ organizationId: "org-1", surchargesEnabled: true },
			],
		],
		["foreign", [{ organizationId: "org-2", surchargesEnabled: true }]],
	] as const)("fails closed on %s organization evidence", async (_label, rows) => {
		await expect(resolve(vi.fn(), [...rows])).rejects.toThrow(
			"Policy clock-out surcharge snapshot resolution failed",
		);
	});

	it("selects numeric priority, then specificity, then stable assignment id", async () => {
		const employee = candidate({
			id: "21000000-0000-4000-8000-000000000003",
			type: "employee",
			priority: 4,
		});
		const team = candidate({
			id: "21000000-0000-4000-8000-000000000002",
			type: "team",
			priority: 8,
		});
		const organization = candidate({
			id: "21000000-0000-4000-8000-000000000001",
			type: "organization",
			priority: 8,
		});
		const execute = vi
			.fn()
			.mockResolvedValueOnce({ rows: [organization, employee, team] })
			.mockResolvedValueOnce({ rows: [modelRow()] });

		await expect(resolve(execute)).resolves.toMatchObject({
			resolution: { assignmentId: team.assignmentId, assignmentType: "team" },
		});

		const laterId = candidate({
			id: "21000000-0000-4000-8000-000000000005",
			type: "team",
			priority: 8,
		});
		const earlierId = candidate({
			id: "21000000-0000-4000-8000-000000000004",
			type: "team",
			priority: 8,
		});
		const tieExecute = vi
			.fn()
			.mockResolvedValueOnce({ rows: [laterId, earlierId] })
			.mockResolvedValueOnce({ rows: [modelRow()] });
		await expect(resolve(tieExecute)).resolves.toMatchObject({
			resolution: { assignmentId: earlierId.assignmentId },
		});
	});

	it("stores none only when the exact owned employee has no applicable assignment", async () => {
		const execute = vi.fn().mockResolvedValue({
			rows: [
				{
					employeeOrganizationId: "org-1",
					teamId: null,
					assignmentId: null,
					assignmentOrganizationId: null,
					assignmentType: null,
					assignmentModelId: null,
					assignmentPriority: null,
				},
			],
		});
		await expect(resolve(execute)).resolves.toEqual({
			version: 1,
			evaluatedAt,
			resolution: { kind: "none" },
		});
		expect(execute).toHaveBeenCalledOnce();
	});

	it.each([
		["foreign employee", { employeeOrganizationId: "org-2" }],
		["foreign assignment", { assignmentOrganizationId: "org-2" }],
	] as const)("fails closed on %s evidence", async (_label, replacement) => {
		const execute = vi.fn().mockResolvedValue({
			rows: [
				{
					...candidate({ id: ids.assignment, type: "employee", priority: 2 }),
					...replacement,
				},
			],
		});
		await expect(resolve(execute)).rejects.toThrow(
			"Policy clock-out surcharge snapshot resolution failed",
		);
		expect(execute).toHaveBeenCalledOnce();
	});

	it("fails closed on duplicate assignment rows and broken model references", async () => {
		const assigned = candidate({
			id: ids.assignment,
			type: "employee",
			priority: 2,
		});
		await expect(
			resolve(vi.fn().mockResolvedValue({ rows: [assigned, assigned] })),
		).rejects.toThrow("Policy clock-out surcharge snapshot resolution failed");

		const execute = vi
			.fn()
			.mockResolvedValueOnce({ rows: [assigned] })
			.mockResolvedValueOnce({
				rows: [modelRow("31000000-0000-4000-8000-000000000001")],
			});
		await expect(resolve(execute)).rejects.toThrow(
			"Policy clock-out surcharge snapshot resolution failed",
		);
	});

	it("locks exact effective evidence and includes rules overlapping the period", async () => {
		const dialect = new PgDialect();
		const assigned = candidate({
			id: ids.assignment,
			type: "team",
			priority: 4,
		});
		const execute = vi.fn(async (query: SQL) => {
			const compiled = dialect.sqlToQuery(query);
			if (compiled.sql.includes("assignment_candidates")) {
				expect(compiled.sql).toContain("for update of employee");
				expect(compiled.sql).toContain("for update of assignment");
				expect(compiled.sql).toContain("assignment.is_active = true");
				expect(compiled.sql).toContain("assignment.effective_from <=");
				expect(compiled.sql).toContain("assignment.effective_until >=");
				return { rows: [assigned] };
			}
			expect(compiled.sql).toContain("model.organization_id =");
			expect(compiled.sql).toContain("model.is_active = true");
			expect(compiled.sql).toContain("rule.is_active = true");
			expect(compiled.sql).toContain("rule.valid_from <=");
			expect(compiled.sql).toContain("rule.valid_until >=");
			expect(compiled.params).toContainEqual(
				new Date("2026-07-19T10:00:00.000Z"),
			);
			expect(compiled.params).toContainEqual(
				new Date("2026-07-19T08:00:00.000Z"),
			);
			expect(compiled.sql).toContain("for update of model");
			expect(compiled.sql).toContain("for update of rule");
			return { rows: [modelRow()] };
		});

		await expect(resolve(execute)).resolves.toEqual(modelSnapshot);
	});

	it("canonicalizes database offset timestamps in captured rule validity", async () => {
		const assigned = candidate({
			id: ids.assignment,
			type: "employee",
			priority: 2,
		});
		const execute = vi
			.fn()
			.mockResolvedValueOnce({ rows: [assigned] })
			.mockResolvedValueOnce({
				rows: [
					{
						...modelRow(),
						rules: [
							{
								...rules[0],
								validFrom: "2026-07-19T10:00:00+01:00",
								validUntil: "2026-07-19T12:00:00+02:00",
							},
						],
					},
				],
			});

		await expect(resolve(execute)).resolves.toMatchObject({
			resolution: {
				rules: [
					{
						validFrom: "2026-07-19T09:00:00Z",
						validUntil: "2026-07-19T10:00:00Z",
					},
				],
			},
		});
	});
});
