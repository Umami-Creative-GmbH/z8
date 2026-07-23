import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";
import { parseInstant } from "@/lib/datetime/temporal-core";
import { calculateHash } from "./blockchain";
import { enforcePolicyClockOutTerminalBreakInTransaction } from "./policy-clock-out-terminal-break";

const organizationId = "org-1";
const employeeId = "10000000-0000-4000-8000-000000000001";
const actorUserId = "actor-user-1";
const startTime = new Date("2026-03-29T00:00:00.000Z");
const endTime = new Date("2026-03-29T08:01:00.000Z");

const snapshot = {
	id: "20000000-0000-4000-8000-000000000001",
	organizationId,
	employeeId,
	clockInId: "30000000-0000-4000-8000-000000000001",
	clockOutId: "30000000-0000-4000-8000-000000000002",
	canonicalRecordId: "40000000-0000-4000-8000-000000000001",
	approvalWorkflowId: "50000000-0000-4000-8000-000000000001",
	startTime,
	endTime,
	durationMinutes: 481,
	projectId: "60000000-0000-4000-8000-000000000001",
	workCategoryId: "70000000-0000-4000-8000-000000000001",
	workLocationType: "home" as const,
};

function input(execute: ReturnType<typeof vi.fn>) {
	return {
		dbService: { db: { execute } } as never,
		organizationId,
		employeeId,
		actorUserId,
		period: snapshot,
		adjustedAt: parseInstant("2026-03-30T10:00:00Z"),
	};
}

function lockedSource(overrides: Record<string, unknown> = {}) {
	return {
		...snapshot,
		approvalStatus: "approved",
		pendingChanges: null,
		isActive: false,
		deletedAt: null,
		wasAutoAdjusted: false,
		originalEndTime: null,
		originalDurationMinutes: null,
		clockInType: "clock_in",
		clockInTimestamp: startTime,
		clockOutType: "clock_out",
		clockOutTimestamp: endTime,
		clockOutTimezone: "Europe/Berlin",
		employeeTimezone: "UTC",
		canonicalId: snapshot.canonicalRecordId,
		canonicalStartAt: startTime,
		canonicalEndAt: endTime,
		canonicalDurationMinutes: 481,
		canonicalApprovalState: "approved",
		canonicalOrigin: "clock",
		canonicalWorkCategoryId: snapshot.workCategoryId,
		canonicalWorkLocationType: snapshot.workLocationType,
		computationMetadata: "original-computation",
		allocations: [
			{
				allocationKind: "project",
				projectId: snapshot.projectId,
				costCenterId: null,
				weightPercent: 75,
			},
			{
				allocationKind: "cost_center",
				projectId: null,
				costCenterId: "80000000-0000-4000-8000-000000000001",
				weightPercent: 25,
			},
		],
		...overrides,
	};
}

function policyRow(overrides: Record<string, unknown> = {}) {
	return {
		id: "90000000-0000-4000-8000-000000000001",
		assignmentPolicyId: "90000000-0000-4000-8000-000000000001",
		policyOrganizationId: organizationId,
		policyIsActive: true,
		regulationEnabled: true,
		regulationId: "91000000-0000-4000-8000-000000000001",
		regulationPolicyId: "90000000-0000-4000-8000-000000000001",
		name: "DST policy",
		maxUninterruptedMinutes: null,
		assignmentPriority: 2,
		assignmentSpecificity: 2,
		breakRules: [
			{
				workingMinutesThreshold: 30,
				requiredBreakMinutes: 60,
			},
		],
		...overrides,
	};
}

function splitDatabase(options?: {
	source?: Record<string, unknown>;
	periodUpdateRows?: unknown[];
	recordUpdateRows?: unknown[];
	gaps?: Array<{ gapStart: Date; gapEnd: Date }>;
	policies?: Record<string, unknown>[];
	missingAssignedPolicy?: boolean;
	failWrite?:
		| "synthetic_clock_out"
		| "synthetic_clock_in"
		| "original_period"
		| "original_canonical"
		| "second_canonical"
		| "second_work"
		| "allocation"
		| "second_period";
}) {
	const dialect = new PgDialect();
	const queries: Array<{ sql: string; params: unknown[] }> = [];
	let timeEntryInsertCount = 0;
	const execute = vi.fn(async (query: SQL) => {
		const compiled = dialect.sqlToQuery(query);
		queries.push(compiled);
		const text = compiled.sql;
		if (text.includes("pg_advisory_xact_lock"))
			return { rows: [{ locked: null }] };
		if (text.includes('as "clockOutTimezone"')) {
			return { rows: [lockedSource(options?.source)] };
		}
		const policies = options?.policies ?? [policyRow()];
		if (text.includes("work_policy_assignment")) {
			if (options?.missingAssignedPolicy) {
				return {
					rows: [
						{
							assignmentPolicyId: "90000000-0000-4000-8000-000000000009",
							assignmentPriority: 2,
							assignmentSpecificity: 2,
						},
					],
				};
			}
			return {
				rows: policies.map((policy) => ({
					assignmentPolicyId: policy.assignmentPolicyId,
					assignmentPriority: policy.assignmentPriority,
					assignmentSpecificity: policy.assignmentSpecificity,
				})),
			};
		}
		if (/from work_policy policy/i.test(text)) {
			if (options?.missingAssignedPolicy) return { rows: [] };
			const policy = policies[0];
			return {
				rows: policy
					? [
							{
								id: policy.id,
								policyOrganizationId: policy.policyOrganizationId,
								policyIsActive: policy.policyIsActive,
								regulationEnabled: policy.regulationEnabled,
								name: policy.name,
							},
						]
					: [],
			};
		}
		if (text.includes("from work_policy_regulation regulation")) {
			const policy = policies[0];
			return {
				rows:
					policy && typeof policy.regulationId === "string"
						? [
								{
									regulationId: policy.regulationId,
									regulationPolicyId: policy.regulationPolicyId,
									maxUninterruptedMinutes: policy.maxUninterruptedMinutes,
								},
							]
						: [],
			};
		}
		if (text.includes("from work_policy_break_rule rule")) {
			return { rows: policies[0]?.breakRules ?? [] };
		}
		if (text.includes('as "gapStart"')) return { rows: options?.gaps ?? [] };
		if (text.includes('as "latestHash"')) {
			return {
				rows: [
					{
						latestId: snapshot.clockOutId,
						latestHash: "real-clock-out-hash",
					},
				],
			};
		}
		if (/^\s*update work_period\b/i.test(text)) {
			if (options?.failWrite === "original_period") return { rows: [] };
			return { rows: options?.periodUpdateRows ?? [{ id: snapshot.id }] };
		}
		if (/^\s*update time_record\b/i.test(text)) {
			if (options?.failWrite === "original_canonical") return { rows: [] };
			return {
				rows: options?.recordUpdateRows ?? [{ id: snapshot.canonicalRecordId }],
			};
		}
		if (/^\s*insert\b/i.test(text)) {
			if (text.includes("into time_entry")) {
				timeEntryInsertCount += 1;
				if (
					(options?.failWrite === "synthetic_clock_out" &&
						timeEntryInsertCount === 1) ||
					(options?.failWrite === "synthetic_clock_in" &&
						timeEntryInsertCount === 2)
				) {
					return { rows: [] };
				}
			}
			if (
				(options?.failWrite === "second_canonical" &&
					/^\s*insert into time_record\s/i.test(text)) ||
				(options?.failWrite === "second_work" &&
					text.includes("into time_record_work")) ||
				(options?.failWrite === "allocation" &&
					text.includes("into time_record_allocation")) ||
				(options?.failWrite === "second_period" &&
					text.includes("into work_period"))
			) {
				return { rows: [] };
			}
			return { rows: [{ id: compiled.params[0] }] };
		}
		throw new Error(`unexpected statement: ${text}`);
	});
	return { execute, queries };
}

describe("enforcePolicyClockOutTerminalBreakInTransaction", () => {
	it("returns not_required without split writes when no historical regulation applies", async () => {
		const { execute, queries } = splitDatabase({ policies: [] });

		await expect(
			enforcePolicyClockOutTerminalBreakInTransaction(input(execute)),
		).resolves.toEqual({ kind: "not_required" });
		expect(
			queries.filter((query) => /^\s*(insert|update)\b/i.test(query.sql)),
		).toEqual([]);
	});

	it("fails closed when an effective assignment references a missing policy", async () => {
		const { execute, queries } = splitDatabase({ missingAssignedPolicy: true });

		await expect(
			enforcePolicyClockOutTerminalBreakInTransaction(input(execute)),
		).rejects.toThrow("Policy clock-out terminal break enforcement conflict");
		expect(
			queries.filter((query) => /^\s*(insert|update)\b/i.test(query.sql)),
		).toHaveLength(0);
	});

	it("treats a valid assigned policy with disabled regulation as not_required", async () => {
		const { execute, queries } = splitDatabase({
			policies: [
				policyRow({
					regulationEnabled: false,
					regulationId: null,
					regulationPolicyId: null,
					breakRules: [],
				}),
			],
		});

		await expect(
			enforcePolicyClockOutTerminalBreakInTransaction(input(execute)),
		).resolves.toEqual({ kind: "not_required" });
		expect(
			queries.filter((query) => /^\s*(insert|update)\b/i.test(query.sql)),
		).toHaveLength(0);
	});

	it.each([
		["foreign policy", { policyOrganizationId: "org-2" }],
		["inactive policy", { policyIsActive: false }],
		["missing regulation", { regulationId: null, regulationPolicyId: null }],
		[
			"foreign regulation",
			{ regulationPolicyId: "90000000-0000-4000-8000-000000000099" },
		],
		["malformed regulation", { maxUninterruptedMinutes: "six hours" }],
		[
			"malformed break rule",
			{
				breakRules: [
					{ workingMinutesThreshold: 30, requiredBreakMinutes: "sixty" },
				],
			},
		],
		[
			"negative break rule",
			{
				breakRules: [{ workingMinutesThreshold: 30, requiredBreakMinutes: -1 }],
			},
		],
	] as const)("fails closed on %s evidence", async (_label, policy) => {
		const { execute, queries } = splitDatabase({
			policies: [policyRow(policy)],
		});

		await expect(
			enforcePolicyClockOutTerminalBreakInTransaction(input(execute)),
		).rejects.toThrow("Policy clock-out terminal break enforcement conflict");
		expect(
			queries.filter((query) => /^\s*(insert|update)\b/i.test(query.sql)),
		).toHaveLength(0);
	});

	it("splits approved canonical and legacy records with exact DST capture and cloned allocations", async () => {
		const { execute, queries } = splitDatabase();

		await expect(
			enforcePolicyClockOutTerminalBreakInTransaction(input(execute)),
		).resolves.toEqual({ kind: "adjusted", breakMinutes: 60 });

		const inserts = queries.filter((query) => /^\s*insert\b/i.test(query.sql));
		const updates = queries.filter((query) => /^\s*update\b/i.test(query.sql));
		expect(
			inserts.filter((query) => query.sql.includes("time_entry")),
		).toHaveLength(2);
		expect(
			inserts.filter((query) => query.sql.includes("time_record ")),
		).toHaveLength(1);
		expect(
			inserts.filter((query) => query.sql.includes("time_record_work")),
		).toHaveLength(1);
		expect(
			inserts.filter((query) => query.sql.includes("time_record_allocation")),
		).toHaveLength(2);
		expect(
			inserts.filter((query) => query.sql.includes("work_period")),
		).toHaveLength(1);
		expect(
			updates.filter((query) => query.sql.includes("work_period")),
		).toHaveLength(1);
		expect(
			updates.filter((query) => query.sql.includes("time_record")),
		).toHaveLength(1);

		const entryInserts = inserts.filter((query) =>
			query.sql.includes("time_entry"),
		);
		const syntheticClockOutId = entryInserts[0]?.params[0];
		const syntheticClockInId = entryInserts[1]?.params[0];
		const expectedClockOutHash = calculateHash({
			employeeId,
			type: "clock_out",
			timestamp: "2026-03-29T00:30:00.000Z",
			previousHash: "real-clock-out-hash",
		});
		const expectedClockInHash = calculateHash({
			employeeId,
			type: "clock_in",
			timestamp: "2026-03-29T01:30:00.000Z",
			previousHash: expectedClockOutHash,
		});
		expect(entryInserts[0]?.params).toEqual(
			expect.arrayContaining([
				"clock_out",
				new Date("2026-03-29T00:30:00.000Z"),
				60,
				"Europe/Berlin",
				"historical_inference",
				snapshot.clockOutId,
				expectedClockOutHash,
				"real-clock-out-hash",
			]),
		);
		expect(entryInserts[0]?.params[8]).toBe(snapshot.clockOutId);
		expect(entryInserts[0]?.params[9]).toBe(expectedClockOutHash);
		expect(entryInserts[0]?.params[10]).toBe("real-clock-out-hash");
		expect(entryInserts[1]?.params).toEqual(
			expect.arrayContaining([
				"clock_in",
				new Date("2026-03-29T01:30:00.000Z"),
				120,
				"Europe/Berlin",
				"historical_inference",
				syntheticClockOutId,
				expectedClockInHash,
				expectedClockOutHash,
			]),
		);
		expect(entryInserts[1]?.params[8]).toBe(syntheticClockOutId);
		expect(entryInserts[1]?.params[9]).toBe(expectedClockInHash);
		expect(entryInserts[1]?.params[10]).toBe(expectedClockOutHash);

		const secondCanonical = inserts.find((query) =>
			/^\s*insert into time_record\s/i.test(query.sql),
		);
		const secondCanonicalId = secondCanonical?.params[0];
		expect(secondCanonical?.params).toEqual(
			expect.arrayContaining([
				organizationId,
				employeeId,
				new Date("2026-03-29T01:30:00.000Z"),
				endTime,
				391,
			]),
		);
		expect(secondCanonical?.sql).toContain("'approved', 'clock'");
		const secondWork = inserts.find((query) =>
			query.sql.includes("time_record_work"),
		);
		expect(secondWork?.params).toEqual([
			secondCanonicalId,
			organizationId,
			snapshot.workCategoryId,
			snapshot.workLocationType,
			"original-computation",
		]);
		const allocationInserts = inserts.filter((query) =>
			query.sql.includes("time_record_allocation"),
		);
		expect(allocationInserts.map((query) => query.params.slice(1, 7))).toEqual([
			[
				organizationId,
				secondCanonicalId,
				"project",
				snapshot.projectId,
				null,
				75,
			],
			[
				organizationId,
				secondCanonicalId,
				"cost_center",
				null,
				"80000000-0000-4000-8000-000000000001",
				25,
			],
		]);

		const secondPeriod = inserts.find((query) =>
			query.sql.includes("work_period"),
		);
		expect(secondPeriod?.params).toEqual(
			expect.arrayContaining([
				new Date("2026-03-29T01:30:00.000Z"),
				endTime,
				391,
				null,
			]),
		);
		expect(secondPeriod?.params[3]).toBe(syntheticClockInId);
		expect(secondPeriod?.params[4]).toBe(snapshot.clockOutId);
		expect(secondPeriod?.params).toEqual(
			expect.arrayContaining([
				secondCanonicalId,
				snapshot.projectId,
				snapshot.workCategoryId,
				snapshot.workLocationType,
			]),
		);
		expect(secondPeriod?.sql).toContain("approval_workflow_id");
		expect(secondPeriod?.sql).toContain("pending_changes");
		expect(secondPeriod?.params[11]).toBeNull();
		expect(secondPeriod?.params[14]).toBeNull();
		expect(secondPeriod?.params[15]).toBeNull();
		expect(secondPeriod?.params[16]).toBe(secondCanonicalId);
		expect(secondPeriod?.params[17]).toBeNull();
		const originalPeriodUpdate = updates.find((query) =>
			query.sql.includes("work_period"),
		);
		expect(originalPeriodUpdate?.params).toEqual(
			expect.arrayContaining([
				syntheticClockOutId,
				new Date("2026-03-29T00:30:00.000Z"),
				30,
				endTime,
				481,
				snapshot.approvalWorkflowId,
			]),
		);
		const originalCanonicalUpdate = updates.find((query) =>
			query.sql.includes("time_record"),
		);
		expect(originalCanonicalUpdate?.params).toEqual(
			expect.arrayContaining([
				new Date("2026-03-29T00:30:00.000Z"),
				30,
				snapshot.canonicalRecordId,
				organizationId,
				employeeId,
			]),
		);
		expect(originalPeriodUpdate?.params[3]).toBe(
			secondPeriod?.params.find(
				(value) =>
					typeof value === "string" && value.includes('"break_enforcement"'),
			),
		);
		expect(
			queries.some((query) =>
				query.sql.includes("time_record_approval_decision"),
			),
		).toBe(false);
	});

	it("locks assignment, policy, regulation, and break-rule evidence before split writes", async () => {
		const { execute, queries } = splitDatabase();

		await enforcePolicyClockOutTerminalBreakInTransaction(input(execute));

		const assignmentLock = queries.findIndex(
			(query) =>
				query.sql.includes("work_policy_assignment") &&
				query.sql.includes("for update of employee_row, assignment"),
		);
		const policyLock = queries.findIndex(
			(query) =>
				/^\s*select[\s\S]+from work_policy policy/i.test(query.sql) &&
				query.sql.includes("for update of policy"),
		);
		const regulationLock = queries.findIndex(
			(query) =>
				query.sql.includes("from work_policy_regulation regulation") &&
				query.sql.includes("for update of regulation"),
		);
		const ruleLock = queries.findIndex(
			(query) =>
				query.sql.includes("from work_policy_break_rule rule") &&
				query.sql.includes("for update of rule"),
		);
		const firstSplitWrite = queries.findIndex((query) =>
			/^\s*(insert|update)\b/i.test(query.sql),
		);
		expect([
			assignmentLock,
			policyLock,
			regulationLock,
			ruleLock,
		]).not.toContain(-1);
		expect(
			Math.max(assignmentLock, policyLock, regulationLock, ruleLock),
		).toBeLessThan(firstSplitWrite);
	});

	it("falls back from an invalid clock-out zone to the exact employee setting", async () => {
		const { execute, queries } = splitDatabase({
			source: {
				clockOutTimezone: "not/a-zone",
				employeeTimezone: "America/New_York",
			},
		});

		await enforcePolicyClockOutTerminalBreakInTransaction(input(execute));

		const entryInserts = queries.filter(
			(query) =>
				/^\s*insert\b/i.test(query.sql) && query.sql.includes("time_entry"),
		);
		expect(entryInserts).toHaveLength(2);
		for (const entry of entryInserts) {
			expect(entry.params).toEqual(
				expect.arrayContaining([
					-240,
					"America/New_York",
					"historical_inference",
				]),
			);
		}
	});

	it("counts only returned same-day approved gaps and performs no split when they satisfy the rule", async () => {
		const { execute, queries } = splitDatabase({
			gaps: [
				{
					gapStart: new Date("2026-03-29T00:00:00.000Z"),
					gapEnd: new Date("2026-03-29T01:00:00.000Z"),
				},
				{
					gapStart: new Date("2026-03-29T02:00:00.000Z"),
					gapEnd: new Date("2026-03-29T08:01:00.000Z"),
				},
			],
		});

		await expect(
			enforcePolicyClockOutTerminalBreakInTransaction(input(execute)),
		).resolves.toEqual({ kind: "not_required" });
		expect(
			queries.filter((query) => /^\s*(insert|update)\b/i.test(query.sql)),
		).toHaveLength(0);
		const gapQuery = queries.find((query) =>
			query.sql.includes('as "gapStart"'),
		);
		expect(gapQuery?.sql).toContain("organization_id =");
		expect(gapQuery?.sql).toContain("employee_id =");
		expect(gapQuery?.sql).toContain("approval_status = 'approved'");
		expect(gapQuery?.sql).toContain("deleted_at is null");
	});

	it("fails closed on a stale original-period CAS cardinality", async () => {
		const { execute, queries } = splitDatabase({ periodUpdateRows: [] });

		await expect(
			enforcePolicyClockOutTerminalBreakInTransaction(input(execute)),
		).rejects.toThrow("Policy clock-out terminal break enforcement conflict");
		expect(
			queries.filter((query) =>
				/^\s*insert into time_record\b/i.test(query.sql),
			),
		).toHaveLength(0);
		const policyQuery = queries.find((query) =>
			query.sql.includes('as "assignmentPolicyId"'),
		);
		expect(policyQuery?.params).toEqual(
			expect.arrayContaining([endTime, employeeId, organizationId]),
		);
	});

	it.each([
		["deleted", { deletedAt: new Date("2026-03-30T00:00:00Z") }],
		["active/incomplete", { isActive: true }],
		["pending changes", { pendingChanges: { private: true } }],
		["already adjusted", { wasAutoAdjusted: true }],
		["stored original endpoint", { originalEndTime: endTime }],
		["stale endpoint", { clockOutTimestamp: new Date("2026-03-29T08:00:00Z") }],
		[
			"wrong source link",
			{ clockOutId: "30000000-0000-4000-8000-000000000099" },
		],
		[
			"wrong canonical link",
			{ canonicalId: "40000000-0000-4000-8000-000000000099" },
		],
		["wrong workflow link", { approvalWorkflowId: null }],
		["wrong work subtype", { canonicalOrigin: "manual" }],
		["foreign organization", { organizationId: "org-2" }],
		[
			"foreign employee",
			{ employeeId: "10000000-0000-4000-8000-000000000099" },
		],
	] as const)("rejects %s source evidence before split writes", async (_label, source) => {
		const { execute, queries } = splitDatabase({ source });

		await expect(
			enforcePolicyClockOutTerminalBreakInTransaction(input(execute)),
		).rejects.toThrow("Policy clock-out terminal break enforcement conflict");
		expect(
			queries.filter((query) => /^\s*(insert|update)\b/i.test(query.sql)),
		).toHaveLength(0);
	});

	it.each([
		["zero", []],
		[
			"multiple",
			[{ id: snapshot.canonicalRecordId }, { id: snapshot.canonicalRecordId }],
		],
	] as const)("rejects %s canonical-record CAS rows", async (_label, recordUpdateRows) => {
		const { execute, queries } = splitDatabase({
			recordUpdateRows: [...recordUpdateRows],
		});

		await expect(
			enforcePolicyClockOutTerminalBreakInTransaction(input(execute)),
		).rejects.toThrow("Policy clock-out terminal break enforcement conflict");
		expect(
			queries.filter((query) =>
				/^\s*insert into time_record\s/i.test(query.sql),
			),
		).toHaveLength(0);
	});

	it.each([
		"synthetic_clock_out",
		"synthetic_clock_in",
		"original_period",
		"original_canonical",
		"second_canonical",
		"second_work",
		"allocation",
		"second_period",
	] as const)("surfaces a %s write failure", async (failWrite) => {
		const { execute } = splitDatabase({ failWrite });

		await expect(
			enforcePolicyClockOutTerminalBreakInTransaction(input(execute)),
		).rejects.toThrow("Policy clock-out terminal break enforcement conflict");
	});

	it("uses the highest historical assignment while allowing a lower-priority fallback", async () => {
		const { execute } = splitDatabase({
			policies: [
				policyRow(),
				policyRow({
					id: "90000000-0000-4000-8000-000000000002",
					name: "Organization fallback",
					assignmentPriority: 0,
					assignmentSpecificity: 0,
				}),
			],
		});

		await expect(
			enforcePolicyClockOutTerminalBreakInTransaction(input(execute)),
		).resolves.toEqual({ kind: "adjusted", breakMinutes: 60 });
	});
});
