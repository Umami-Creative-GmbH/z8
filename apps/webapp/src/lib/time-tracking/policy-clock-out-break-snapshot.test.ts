import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";
import { parseInstant } from "@/lib/datetime/temporal-core";
import {
	parsePolicyClockOutBreakSnapshot,
	policyClockOutBreakSnapshotsEqual,
	resolvePolicyClockOutBreakSnapshotInTransaction,
} from "./policy-clock-out-break-snapshot";

const evaluatedAt = "2026-03-29T08:01:00Z";
const workPolicySnapshot = {
	version: 1,
	evaluatedAt,
	resolution: "work_policy",
	teamId: "10000000-0000-4000-8000-000000000001",
	assignment: {
		id: "20000000-0000-4000-8000-000000000001",
		type: "team",
	},
	policy: {
		id: "30000000-0000-4000-8000-000000000001",
		name: "German standard",
	},
	regulationEnabled: true,
	regulation: {
		id: "40000000-0000-4000-8000-000000000001",
		name: "German standard",
		maxUninterruptedMinutes: 360,
	},
	breakRules: [
		{
			id: "50000000-0000-4000-8000-000000000001",
			workingMinutesThreshold: 360,
			requiredBreakMinutes: 30,
		},
		{
			id: "50000000-0000-4000-8000-000000000002",
			workingMinutesThreshold: 540,
			requiredBreakMinutes: 45,
		},
	],
} as const;

describe("parsePolicyClockOutBreakSnapshot", () => {
	it("accepts sorted rules and returns detached deeply frozen evidence", () => {
		const input = structuredClone(workPolicySnapshot);
		const parsed = parsePolicyClockOutBreakSnapshot(input, evaluatedAt);

		expect(
			parsed.breakRules.map((rule) => rule.workingMinutesThreshold),
		).toEqual([360, 540]);
		expect(parsed).not.toBe(input);
		expect(Object.isFrozen(parsed)).toBe(true);
		expect(Object.isFrozen(parsed.breakRules)).toBe(true);
		expect(Object.isFrozen(parsed.breakRules[0])).toBe(true);
	});

	it("accepts a strict no-policy resolution", () => {
		expect(
			parsePolicyClockOutBreakSnapshot(
				{ version: 1, evaluatedAt, resolution: "none" },
				evaluatedAt,
			),
		).toEqual({ version: 1, evaluatedAt, resolution: "none" });
	});

	it.each([
		["unknown key", { ...workPolicySnapshot, metadata: {} }],
		[
			"non-canonical instant",
			{ ...workPolicySnapshot, evaluatedAt: "2026-03-29T08:01:00.000Z" },
		],
		[
			"wrong source end",
			{ ...workPolicySnapshot, evaluatedAt: "2026-03-29T08:02:00Z" },
		],
		["invalid id", { ...workPolicySnapshot, teamId: "team-1" }],
		[
			"unsorted break rules",
			{
				...workPolicySnapshot,
				breakRules: [...workPolicySnapshot.breakRules].reverse(),
			},
		],
		[
			"negative minutes",
			{
				...workPolicySnapshot,
				regulation: {
					...workPolicySnapshot.regulation,
					maxUninterruptedMinutes: -1,
				},
			},
		],
		[
			"duplicate rule id",
			{
				...workPolicySnapshot,
				breakRules: [
					workPolicySnapshot.breakRules[0],
					{
						...workPolicySnapshot.breakRules[1],
						id: workPolicySnapshot.breakRules[0].id,
					},
				],
			},
		],
		[
			"duplicate threshold",
			{
				...workPolicySnapshot,
				breakRules: [
					workPolicySnapshot.breakRules[0],
					{
						...workPolicySnapshot.breakRules[1],
						workingMinutesThreshold:
							workPolicySnapshot.breakRules[0].workingMinutesThreshold,
					},
				],
			},
		],
	] as const)("rejects %s", (_label, value) => {
		expect(() => parsePolicyClockOutBreakSnapshot(value, evaluatedAt)).toThrow(
			"Policy clock-out break snapshot is invalid",
		);
	});

	it("does not normalize stored rule order while comparing evidence", () => {
		expect(
			policyClockOutBreakSnapshotsEqual(
				workPolicySnapshot,
				{
					...workPolicySnapshot,
					breakRules: [...workPolicySnapshot.breakRules].reverse(),
				},
				evaluatedAt,
			),
		).toBe(false);
		expect(
			policyClockOutBreakSnapshotsEqual(
				workPolicySnapshot,
				{
					...workPolicySnapshot,
					breakRules: [
						{ ...workPolicySnapshot.breakRules[0], requiredBreakMinutes: 46 },
						workPolicySnapshot.breakRules[1],
					],
				},
				evaluatedAt,
			),
		).toBe(false);
	});
});

describe("resolvePolicyClockOutBreakSnapshotInTransaction", () => {
	it("locks and snapshots the exact employee team, effective assignment, policy, regulation, and ordered rules", async () => {
		const dialect = new PgDialect();
		const execute = vi.fn(async (query: SQL) => {
			const compiled = dialect.sqlToQuery(query);
			for (const owner of [
				"employee",
				"assignment",
				"policy",
				"regulation",
				"rule",
			]) {
				expect(compiled.sql).toContain(`for update of ${owner}`);
			}
			expect(compiled.sql).toContain(
				'assignment.organization_id = employee_row."organizationId"',
			);
			expect(compiled.sql).toContain("assignment.effective_from <=");
			expect(compiled.sql).toContain("assignment.effective_until >=");
			expect(compiled.sql.indexOf("assignment.priority desc")).toBeLessThan(
				compiled.sql.indexOf("case assignment.assignment_type"),
			);
			return {
				rows: [
					{
						teamId: workPolicySnapshot.teamId,
						assignmentId: workPolicySnapshot.assignment.id,
						assignmentType: workPolicySnapshot.assignment.type,
						assignmentPolicyId: workPolicySnapshot.policy.id,
						policyId: workPolicySnapshot.policy.id,
						policyName: workPolicySnapshot.policy.name,
						policyIsActive: true,
						regulationEnabled: true,
						regulationId: workPolicySnapshot.regulation.id,
						maxUninterruptedMinutes: 360,
						breakRules: [...workPolicySnapshot.breakRules].reverse(),
					},
				],
			};
		});

		await expect(
			resolvePolicyClockOutBreakSnapshotInTransaction({
				dbService: { db: { execute } } as never,
				organizationId: "org-1",
				employeeId: "60000000-0000-4000-8000-000000000001",
				endTime: parseInstant(evaluatedAt),
			}),
		).resolves.toEqual(
			parsePolicyClockOutBreakSnapshot(workPolicySnapshot, evaluatedAt),
		);
	});

	it("stores none only when no effective assignment exists", async () => {
		const execute = vi.fn(async () => ({
			rows: [
				{
					teamId: null,
					assignmentId: null,
					assignmentType: null,
					assignmentPolicyId: null,
					policyId: null,
					policyName: null,
					policyIsActive: null,
					regulationEnabled: null,
					regulationId: null,
					maxUninterruptedMinutes: null,
					breakRules: [],
				},
			],
		}));
		await expect(
			resolvePolicyClockOutBreakSnapshotInTransaction({
				dbService: { db: { execute } } as never,
				organizationId: "org-1",
				employeeId: "60000000-0000-4000-8000-000000000001",
				endTime: parseInstant(evaluatedAt),
			}),
		).resolves.toEqual({ version: 1, evaluatedAt, resolution: "none" });
	});

	it("retains assigned policy identity when regulation is disabled", async () => {
		const execute = vi.fn(async () => ({
			rows: [
				{
					teamId: workPolicySnapshot.teamId,
					assignmentId: workPolicySnapshot.assignment.id,
					assignmentType: "team",
					assignmentPolicyId: workPolicySnapshot.policy.id,
					policyId: workPolicySnapshot.policy.id,
					policyName: "Policy",
					policyIsActive: true,
					regulationEnabled: false,
					regulationId: null,
					maxUninterruptedMinutes: null,
					breakRules: [],
				},
			],
		}));

		await expect(
			resolvePolicyClockOutBreakSnapshotInTransaction({
				dbService: { db: { execute } } as never,
				organizationId: "org-1",
				employeeId: "60000000-0000-4000-8000-000000000001",
				endTime: parseInstant(evaluatedAt),
			}),
		).resolves.toEqual({
			version: 1,
			evaluatedAt,
			resolution: "work_policy",
			teamId: workPolicySnapshot.teamId,
			assignment: workPolicySnapshot.assignment,
			policy: { id: workPolicySnapshot.policy.id, name: "Policy" },
			regulationEnabled: false,
			regulation: {
				id: null,
				name: null,
				maxUninterruptedMinutes: null,
			},
			breakRules: [],
		});
	});

	it("fails closed when an assignment references invalid policy evidence", async () => {
		const execute = vi.fn(async () => ({
			rows: [
				{
					teamId: null,
					assignmentId: workPolicySnapshot.assignment.id,
					assignmentType: "employee",
					assignmentPolicyId: workPolicySnapshot.policy.id,
					policyId: null,
					policyName: null,
					policyIsActive: null,
					regulationEnabled: null,
					regulationId: null,
					maxUninterruptedMinutes: null,
					breakRules: [],
				},
			],
		}));
		await expect(
			resolvePolicyClockOutBreakSnapshotInTransaction({
				dbService: { db: { execute } } as never,
				organizationId: "org-1",
				employeeId: "60000000-0000-4000-8000-000000000001",
				endTime: parseInstant(evaluatedAt),
			}),
		).rejects.toThrow("Policy clock-out break snapshot resolution failed");
	});
});
