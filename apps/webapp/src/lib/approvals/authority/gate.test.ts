import { type SQL, sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import type { ApprovalDbService } from "../workflow/ports";
import { acquireApprovalWriteGate, approvalAuthoritySql } from "./gate";
import { approvalWriteGateResult } from "./resolution";

describe("approval write gate", () => {
	it("acquires the shared write lock before reading mode on the caller transaction", async () => {
		const timeline: string[] = [];
		let transactionCalls = 0;
		const service = {
			db: {
				execute: async (query: SQL) => {
					const rendered = new PgDialect().sqlToQuery(query);
					if (rendered.sql.includes("lock_shared")) {
						timeline.push("lock");
						return { rows: [] };
					}
					if (rendered.sql.includes("insert into approval_workflow_rollout")) {
						timeline.push("initialize");
						return { rows: [] };
					}
					timeline.push("mode");
					return { rows: [{ lifecycle_mode: "canonical" }] };
				},
				transaction: () => {
					transactionCalls += 1;
				},
			},
		} as unknown as ApprovalDbService;

		await expect(
			acquireApprovalWriteGate(service, {
				organizationId: "org-1",
				workflowType: "absence",
			}),
		).resolves.toEqual(approvalWriteGateResult("canonical"));
		expect(timeline).toEqual(["lock", "initialize", "mode"]);
		expect(transactionCalls).toBe(0);
	});

	it("initializes a missing rollout row in legacy mode under the write lock", async () => {
		const timeline: string[] = [];
		const service = {
			db: {
				execute: async (query: SQL) => {
					const rendered = new PgDialect().sqlToQuery(query);
					if (rendered.sql.includes("lock_shared")) {
						timeline.push("lock");
						return { rows: [] };
					}
					if (rendered.sql.includes("insert into approval_workflow_rollout")) {
						timeline.push("initialize");
						expect(rendered.sql).toContain("on conflict");
						expect(rendered.sql).toContain("updated_at");
						expect(rendered.params).toEqual([
							"org-1",
							"time_correction",
							"legacy",
							"legacy",
							expect.any(Date),
						]);
						return { rows: [] };
					}
					timeline.push("mode");
					return { rows: [{ lifecycle_mode: "legacy" }] };
				},
			},
		} as unknown as ApprovalDbService;

		await expect(
			acquireApprovalWriteGate(service, {
				organizationId: "org-1",
				workflowType: "time_correction",
			}),
		).resolves.toEqual(approvalWriteGateResult("legacy"));
		expect(timeline).toEqual(["lock", "initialize", "mode"]);
	});

	it("propagates write-gate lock, initialization, and mode-read failures", async () => {
		for (const [failureAt, failureCall] of [
			["lock", 1],
			["initialize", 2],
			["mode", 3],
		] as const) {
			let calls = 0;
			const service = {
				db: {
					execute: async () => {
						calls += 1;
						if (calls === failureCall) {
							throw new Error(`${failureAt} failed`);
						}
						return calls === 3 ? { rows: [{ lifecycle_mode: "legacy" }] } : { rows: [] };
					},
				},
			} as ApprovalDbService;
			await expect(
				acquireApprovalWriteGate(service, {
					organizationId: "org-1",
					workflowType: "absence",
				}),
			).rejects.toThrow(`${failureAt} failed`);
			expect(calls).toBe(failureCall);
		}
	});

	it("refuses a mode the rollout table cannot hold", async () => {
		const service = {
			db: {
				execute: async (query: SQL) =>
					new PgDialect().sqlToQuery(query).sql.includes("select lifecycle_mode")
						? { rows: [{ lifecycle_mode: "retired" }] }
						: { rows: [] },
			},
		} as ApprovalDbService;
		await expect(
			acquireApprovalWriteGate(service, { organizationId: "org-1", workflowType: "absence" }),
		).rejects.toThrow("Approval lifecycle mode is unavailable");
	});
});

describe("approval authority SQL", () => {
	it("renders each authority's modes from the table, with no row as legacy", () => {
		const dialect = new PgDialect();
		const column = sql.raw("r.lifecycle_mode");
		expect(dialect.sqlToQuery(approvalAuthoritySql(column, "canonical")).sql).toBe(
			"(r.lifecycle_mode is not null and r.lifecycle_mode in ('canonical', 'complete'))",
		);
		expect(dialect.sqlToQuery(approvalAuthoritySql(column, "legacy")).sql).toBe(
			"(r.lifecycle_mode is null or r.lifecycle_mode in ('legacy', 'shadow', 'ready'))",
		);
	});
});
