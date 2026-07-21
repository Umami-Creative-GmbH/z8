import { PgDialect, type SQL } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { parseInstant } from "@/lib/datetime/temporal-core";
import type { ApprovalDbService } from "../workflow/ports";
import type { ApprovalProjectionWriteInput } from "./contracts";
import { createApprovalProjectionWriter } from "./writer";

const updatedAt = parseInstant("2026-07-16T10:11:12.345Z");

function input(
	overrides: Partial<ApprovalProjectionWriteInput> = {},
): ApprovalProjectionWriteInput {
	return {
		organizationId: "org-1",
		workflowId: "10000000-0000-4000-8000-000000000001",
		workflowType: "absence",
		sourceType: "absence_entry",
		sourceId: "20000000-0000-4000-8000-000000000001",
		status: "pending",
		currentStageOrder: 1,
		requesterEmployeeId: "30000000-0000-4000-8000-000000000001",
		displayPayload: { kind: "absence", category: "vacation", dayCount: 2 },
		searchText: "ada vacation",
		activeInboxStage: {
			stageId: "40000000-0000-4000-8000-000000000001",
			stageOrder: 1,
		},
		updatedAt,
		...overrides,
	};
}

function fakeService(options: { failAt?: number } = {}) {
	const calls: SQL[] = [];
	let transactionCalls = 0;
	const service = {
		db: {
			execute: async (query: SQL) => {
				calls.push(query);
				if (calls.length === options.failAt) throw new Error("database failed");
				return { rows: [] };
			},
			transaction: () => {
				transactionCalls += 1;
			},
		},
	} as unknown as ApprovalDbService;
	return { service, calls, transactionCalls: () => transactionCalls };
}

describe("approval projection writer", () => {
	it("upserts requester and active inbox projections with organization-scoped keys", async () => {
		const fake = fakeService();
		await createApprovalProjectionWriter(fake.service).write(input());

		const rendered = fake.calls.map((query) =>
			new PgDialect().sqlToQuery(query),
		);
		expect(rendered).toHaveLength(2);
		expect(rendered[0]?.sql).toContain(
			"insert into approval_requester_projection",
		);
		expect(rendered[0]?.sql).toContain(
			"on conflict (organization_id, workflow_id) do update",
		);
		expect(rendered[1]?.sql).toContain("insert into approval_inbox_projection");
		expect(rendered[1]?.sql).toContain(
			"on conflict (organization_id, workflow_id, active_stage_id) do update",
		);
		for (const query of rendered) expect(query.params).toContain("org-1");
		expect(rendered[1]?.sql).toContain("delete from approval_inbox_projection");
		expect(rendered[1]?.sql).toContain("and active_stage_id <>");
		expect(rendered[1]?.params.slice(0, 3)).toEqual([
			"org-1",
			"10000000-0000-4000-8000-000000000001",
			"40000000-0000-4000-8000-000000000001",
		]);
		expect(rendered[1]?.params.slice(3, 6)).toEqual([
			"org-1",
			"10000000-0000-4000-8000-000000000001",
			"40000000-0000-4000-8000-000000000001",
		]);
		expect(fake.transactionCalls()).toBe(0);
	});

	it.each([
		"approved",
		"rejected",
		"cancelled",
		"expired",
	] as const)("removes the organization-scoped inbox row for terminal status %s", async (status) => {
		const fake = fakeService();
		await createApprovalProjectionWriter(fake.service).write(
			input({ status, currentStageOrder: null, activeInboxStage: null }),
		);

		const rendered = fake.calls.map((query) =>
			new PgDialect().sqlToQuery(query),
		);
		expect(rendered).toHaveLength(2);
		expect(rendered[1]?.sql).toContain("delete from approval_inbox_projection");
		expect(rendered[1]?.params).toEqual([
			"org-1",
			"10000000-0000-4000-8000-000000000001",
		]);
	});

	it("converts Temporal instants only at the database boundary", async () => {
		const fake = fakeService();
		await createApprovalProjectionWriter(fake.service).write(input());
		const rendered = fake.calls.map((query) =>
			new PgDialect().sqlToQuery(query),
		);
		const dates = rendered.flatMap((query) =>
			query.params.filter((value): value is Date => value instanceof Date),
		);
		expect(dates.length).toBeGreaterThan(0);
		expect(
			dates.every((value) => value.toISOString() === updatedAt.toString()),
		).toBe(true);
	});

	it("propagates a write failure so the caller transaction can roll back", async () => {
		const fake = fakeService({ failAt: 2 });
		await expect(
			createApprovalProjectionWriter(fake.service).write(input()),
		).rejects.toThrow("database failed");
	});
});
