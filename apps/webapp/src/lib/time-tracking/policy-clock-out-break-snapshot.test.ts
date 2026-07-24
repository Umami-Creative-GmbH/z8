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
			"zero max uninterrupted minutes",
			{
				...workPolicySnapshot,
				regulation: {
					...workPolicySnapshot.regulation,
					maxUninterruptedMinutes: 0,
				},
			},
		],
		[
			"zero working threshold",
			{
				...workPolicySnapshot,
				breakRules: [
					{
						...workPolicySnapshot.breakRules[0],
						workingMinutesThreshold: 0,
					},
					workPolicySnapshot.breakRules[1],
				],
			},
		],
		[
			"zero required break minutes",
			{
				...workPolicySnapshot,
				breakRules: [
					{
						...workPolicySnapshot.breakRules[0],
						requiredBreakMinutes: 0,
					},
					workPolicySnapshot.breakRules[1],
				],
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
	const employeeId = "60000000-0000-4000-8000-000000000001";
	const candidateIds = {
		employee: "61000000-0000-4000-8000-000000000001",
		team: "61000000-0000-4000-8000-000000000002",
		organization: "61000000-0000-4000-8000-000000000003",
		tieWinner: "61000000-0000-4000-8000-000000000004",
		tieLoser: "61000000-0000-4000-8000-000000000005",
	} as const;
	const policyIds = {
		employee: "62000000-0000-4000-8000-000000000001",
		team: "62000000-0000-4000-8000-000000000002",
		organization: "62000000-0000-4000-8000-000000000003",
		tieWinner: "62000000-0000-4000-8000-000000000004",
		tieLoser: "62000000-0000-4000-8000-000000000005",
	} as const;

	function candidate(input: {
		id: string;
		type: "employee" | "team" | "organization";
		policyId: string;
		priority: number;
		organizationId?: string;
		employeeOrganizationId?: string;
	}) {
		return {
			employeeOrganizationId: input.employeeOrganizationId ?? "org-1",
			teamId: workPolicySnapshot.teamId,
			assignmentId: input.id,
			assignmentOrganizationId: input.organizationId ?? "org-1",
			assignmentType: input.type,
			assignmentPolicyId: input.policyId,
			priority: input.priority,
		};
	}

	function resolverExecute(
		candidates: readonly ReturnType<typeof candidate>[],
		selected: ReturnType<typeof candidate>,
	) {
		return vi
			.fn()
			.mockResolvedValueOnce({ rows: candidates })
			.mockResolvedValueOnce({
				rows: [
					{
						policyId: selected.assignmentPolicyId,
						policyName: "Selected policy",
						policyIsActive: true,
						regulationEnabled: false,
						regulationId: null,
						maxUninterruptedMinutes: null,
						breakRules: [],
					},
				],
			});
	}

	async function resolveWith(execute: ReturnType<typeof resolverExecute>) {
		return resolvePolicyClockOutBreakSnapshotInTransaction({
			dbService: { db: { execute } } as never,
			organizationId: "org-1",
			employeeId,
			endTime: parseInstant(evaluatedAt),
		});
	}

	it("selects the highest numeric priority across employee, team, and organization candidates", async () => {
		const employee = candidate({
			id: candidateIds.employee,
			type: "employee",
			policyId: policyIds.employee,
			priority: 4,
		});
		const team = candidate({
			id: candidateIds.team,
			type: "team",
			policyId: policyIds.team,
			priority: 9,
		});
		const organization = candidate({
			id: candidateIds.organization,
			type: "organization",
			policyId: policyIds.organization,
			priority: 6,
		});
		const execute = resolverExecute([employee, organization, team], team);

		await expect(resolveWith(execute)).resolves.toMatchObject({
			assignment: { id: team.assignmentId, type: "team" },
			policy: { id: team.assignmentPolicyId },
		});
		expect(execute).toHaveBeenCalledTimes(2);
	});

	it("uses employee then team then organization specificity at equal priority", async () => {
		const employee = candidate({
			id: candidateIds.employee,
			type: "employee",
			policyId: policyIds.employee,
			priority: 7,
		});
		const team = candidate({
			id: candidateIds.team,
			type: "team",
			policyId: policyIds.team,
			priority: 7,
		});
		const organization = candidate({
			id: candidateIds.organization,
			type: "organization",
			policyId: policyIds.organization,
			priority: 7,
		});
		const execute = resolverExecute([organization, team, employee], employee);

		await expect(resolveWith(execute)).resolves.toMatchObject({
			assignment: { id: employee.assignmentId, type: "employee" },
			policy: { id: employee.assignmentPolicyId },
		});

		const teamExecute = resolverExecute([organization, team], team);
		await expect(resolveWith(teamExecute)).resolves.toMatchObject({
			assignment: { id: team.assignmentId, type: "team" },
			policy: { id: team.assignmentPolicyId },
		});
	});

	it("uses the assignment id as a stable final tie-break", async () => {
		const winner = candidate({
			id: candidateIds.tieWinner,
			type: "employee",
			policyId: policyIds.tieWinner,
			priority: 7,
		});
		const loser = candidate({
			id: candidateIds.tieLoser,
			type: "employee",
			policyId: policyIds.tieLoser,
			priority: 7,
		});
		const execute = resolverExecute([loser, winner], winner);

		await expect(resolveWith(execute)).resolves.toMatchObject({
			assignment: { id: winner.assignmentId, type: "employee" },
			policy: { id: winner.assignmentPolicyId },
		});
	});

	it.each([
		["employee evidence", { employeeOrganizationId: "foreign-org" }],
		["assignment evidence", { assignmentOrganizationId: "foreign-org" }],
	] as const)("fails closed on foreign %s without selecting it", async (_label, mismatch) => {
		const foreign = {
			...candidate({
				id: candidateIds.employee,
				type: "employee",
				policyId: policyIds.employee,
				priority: 99,
			}),
			...mismatch,
			policyId: policyIds.employee,
			policyName: "Foreign policy",
			policyIsActive: true,
			regulationEnabled: false,
			regulationId: null,
			maxUninterruptedMinutes: null,
			breakRules: [],
		};
		const execute = vi.fn(async () => ({ rows: [foreign] }));

		await expect(resolveWith(execute as never)).rejects.toThrow(
			"Policy clock-out break snapshot resolution failed",
		);
		expect(execute).toHaveBeenCalledTimes(1);
	});

	it("locks and snapshots the exact employee team, effective assignment, policy, regulation, and ordered rules", async () => {
		const dialect = new PgDialect();
		const execute = vi.fn(async (query: SQL) => {
			const compiled = dialect.sqlToQuery(query);
			if (compiled.sql.includes("assignment_candidates")) {
				expect(compiled.sql).toContain("for update of employee");
				expect(compiled.sql).toContain("for update of assignment");
				expect(compiled.sql).toContain(
					'assignment.organization_id = employee_row."organizationId"',
				);
				expect(compiled.sql).toContain("assignment.effective_from <=");
				expect(compiled.sql).toContain("assignment.effective_until >=");
				expect(compiled.sql.indexOf("assignment.priority desc")).toBeLessThan(
					compiled.sql.indexOf("case assignment.assignment_type"),
				);
				expect(compiled.params).toContain(65);
				return {
					rows: [
						candidate({
							id: workPolicySnapshot.assignment.id,
							type: workPolicySnapshot.assignment.type,
							policyId: workPolicySnapshot.policy.id,
							priority: 2,
						}),
					],
				};
			}
			for (const owner of ["policy", "regulation", "rule"]) {
				expect(compiled.sql).toContain(`for update of ${owner}`);
			}
			return {
				rows: [
					{
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
					employeeOrganizationId: "org-1",
					teamId: null,
					assignmentId: null,
					assignmentOrganizationId: null,
					assignmentType: null,
					assignmentPolicyId: null,
					priority: null,
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
		const assigned = candidate({
			id: workPolicySnapshot.assignment.id,
			type: "team",
			policyId: workPolicySnapshot.policy.id,
			priority: 2,
		});
		const execute = vi
			.fn()
			.mockResolvedValueOnce({ rows: [assigned] })
			.mockResolvedValueOnce({
				rows: [
					{
						policyId: workPolicySnapshot.policy.id,
						policyName: "Policy",
						policyIsActive: true,
						regulationEnabled: false,
						regulationId: null,
						maxUninterruptedMinutes: null,
						breakRules: [],
					},
				],
			});

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
		const execute = vi
			.fn()
			.mockResolvedValueOnce({
				rows: [
					candidate({
						id: workPolicySnapshot.assignment.id,
						type: "employee",
						policyId: workPolicySnapshot.policy.id,
						priority: 2,
					}),
				],
			})
			.mockResolvedValueOnce({
				rows: [
					{
						policyId: null,
						policyName: null,
						policyIsActive: null,
						regulationEnabled: null,
						regulationId: null,
						maxUninterruptedMinutes: null,
						breakRules: [],
					},
				],
			});
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
