import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";
import { parseInstant } from "@/lib/datetime/temporal-core";
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
	gaps?: Array<{ gapStart: Date; gapEnd: Date }>;
	policies?: Record<string, unknown>[];
}) {
	const dialect = new PgDialect();
	const queries: Array<{ sql: string; params: unknown[] }> = [];
	const execute = vi.fn(async (query: SQL) => {
		const compiled = dialect.sqlToQuery(query);
		queries.push(compiled);
		const text = compiled.sql;
		if (text.includes("pg_advisory_xact_lock"))
			return { rows: [{ locked: null }] };
		if (text.includes('as "clockOutTimezone"')) {
			return { rows: [lockedSource(options?.source)] };
		}
		if (text.includes('as "breakRules"')) {
			return { rows: options?.policies ?? [policyRow()] };
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
			return { rows: options?.periodUpdateRows ?? [{ id: snapshot.id }] };
		}
		if (/^\s*update time_record\b/i.test(text)) {
			return { rows: [{ id: snapshot.canonicalRecordId }] };
		}
		if (/^\s*insert\b/i.test(text)) {
			return { rows: [{ id: compiled.params[0] }] };
		}
		throw new Error(`unexpected statement: ${text}`);
	});
	return { execute, queries };
}

describe("enforcePolicyClockOutTerminalBreakInTransaction", () => {
	it("returns not_required without split writes when no historical regulation applies", async () => {
		const dialect = new PgDialect();
		const statements: string[] = [];
		const execute = vi.fn(async (query: SQL) => {
			const text = dialect.sqlToQuery(query).sql;
			statements.push(text);
			if (text.includes("pg_advisory_xact_lock"))
				return { rows: [{ locked: null }] };
			if (text.includes('as "clockOutTimezone"')) {
				return { rows: [lockedSource()] };
			}
			if (text.includes('as "breakRules"')) return { rows: [] };
			throw new Error(`unexpected statement: ${text}`);
		});

		await expect(
			enforcePolicyClockOutTerminalBreakInTransaction(input(execute)),
		).resolves.toEqual({ kind: "not_required" });
		expect(
			statements.filter((text) => /^\s*(insert|update)\b/i.test(text)),
		).toEqual([]);
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
		expect(entryInserts[0]?.params).toEqual(
			expect.arrayContaining([
				"clock_out",
				new Date("2026-03-29T00:30:00.000Z"),
				60,
				"Europe/Berlin",
				"historical_inference",
				"real-clock-out-hash",
			]),
		);
		expect(entryInserts[1]?.params).toEqual(
			expect.arrayContaining([
				"clock_in",
				new Date("2026-03-29T01:30:00.000Z"),
				120,
				"Europe/Berlin",
				"historical_inference",
			]),
		);

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
		expect(secondPeriod?.sql).toContain("approval_workflow_id");
		expect(secondPeriod?.sql).toContain("pending_changes");
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
