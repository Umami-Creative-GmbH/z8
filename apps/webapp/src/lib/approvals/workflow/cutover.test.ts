import { PgDialect, type SQL } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { parseInstant } from "@/lib/datetime/temporal-core";
import {
	acquireApprovalCutoverLock,
	acquireApprovalWriteGate,
	approvalRolloutLockScope,
	getCutoverBehavior,
	validateCutoverTransition,
} from "./cutover";
import type { ApprovalDbService, ApprovalWorkflowLifecycleMode } from "./ports";

const actor = {
	kind: "system" as const,
	employeeId: null,
	userId: "operator-1",
	fingerprint: "operator:operator-1",
};
const recordedAt = parseInstant("2026-07-16T08:00:00Z");

function transition(
	from: ApprovalWorkflowLifecycleMode,
	to: ApprovalWorkflowLifecycleMode,
) {
	return {
		organizationId: "org-1",
		workflowType: "absence" as const,
		from,
		to,
		actor,
		evidence: { reason: "approved rollout", recordedAt },
	};
}

describe("approval workflow cutover", () => {
	it.each([
		["legacy", "legacy", true, false, false, "none"],
		["shadow", "legacy", true, true, false, "legacy_to_canonical"],
		["ready", "legacy", true, true, false, "legacy_to_canonical"],
		["canonical", "canonical", true, true, true, "canonical_to_legacy"],
		["complete", "canonical", false, true, true, "none"],
	] as const)("maps %s behavior exactly", (mode, serveFrom, writeLegacy, writeCanonical, decideCanonical, mirror) => {
		expect(getCutoverBehavior(mode)).toEqual({
			serveFrom,
			writeLegacy,
			writeCanonical,
			decideCanonical,
			mirror,
		});
	});

	it.each([
		["legacy", "shadow"],
		["shadow", "ready"],
		["canonical", "complete"],
	] as const)("accepts the explicit %s -> %s lifecycle edge", (from, to) => {
		expect(validateCutoverTransition(transition(from, to)).to).toBe(to);
	});

	it("requires passing reconciliation evidence before canonical authority", () => {
		expect(() =>
			validateCutoverTransition(transition("ready", "canonical")),
		).toThrow(/reconciliation/i);

		expect(
			validateCutoverTransition({
				...transition("ready", "canonical"),
				evidence: {
					reason: "zero mismatches",
					recordedAt,
					reconciliation: {
						passed: true,
						mismatchCount: 0,
						backfilledThrough: recordedAt,
						reconciledAt: recordedAt,
					},
				},
			}).to,
		).toBe("canonical");
	});

	it("rejects canonical authority when reconciliation still has mismatches", () => {
		const candidate = {
			...transition("ready", "canonical"),
			evidence: {
				reason: "reconciliation has drift",
				recordedAt,
				reconciliation: {
					passed: true,
					mismatchCount: 2,
					backfilledThrough: recordedAt,
					reconciledAt: recordedAt,
				},
			},
		};
		expect(() =>
			validateCutoverTransition(
				candidate as unknown as Parameters<typeof validateCutoverTransition>[0],
			),
		).toThrow(/mismatch|reconciliation/i);
	});

	it.each([
		["legacy", "ready"],
		["legacy", "canonical"],
		["shadow", "legacy"],
		["ready", "shadow"],
		["canonical", "ready"],
		["complete", "canonical"],
		["complete", "complete"],
	] as const)("rejects invalid or irreversible %s -> %s transitions", (from, to) => {
		expect(() => validateCutoverTransition(transition(from, to))).toThrow(
			/transition/i,
		);
	});

	it("derives an unambiguous stable scope from organization and workflow type", () => {
		expect(approvalRolloutLockScope("ab", "absence")).toBe(
			approvalRolloutLockScope("ab", "absence"),
		);
		expect(approvalRolloutLockScope("ab", "absence")).not.toBe(
			approvalRolloutLockScope("a", "absence"),
		);
		expect(approvalRolloutLockScope("ab", "absence")).not.toBe(
			approvalRolloutLockScope("ab", "travel_expense"),
		);
	});

	it("uses the caller transaction for matching shared and exclusive PostgreSQL locks", async () => {
		const calls: SQL[] = [];
		let transactionCalls = 0;
		const service = {
			db: {
				execute: async (query: SQL) => {
					calls.push(query);
					const rendered = new PgDialect().sqlToQuery(query);
					return rendered.sql.includes("from approval_workflow_rollout")
						? { rows: [{ lifecycle_mode: "shadow" }] }
						: { rows: [] };
				},
				transaction: () => {
					transactionCalls += 1;
				},
			},
		} as unknown as ApprovalDbService;

		await acquireApprovalWriteGate(service, {
			organizationId: "org-1",
			workflowType: "absence",
		});
		await acquireApprovalCutoverLock(service, {
			organizationId: "org-1",
			workflowType: "absence",
		});

		const dialect = new PgDialect();
		const rendered = calls.map((query) => dialect.sqlToQuery(query));
		expect(rendered[0]?.sql).toContain("pg_advisory_xact_lock_shared");
		expect(rendered[1]?.sql).toContain("from approval_workflow_rollout");
		expect(rendered[2]?.sql).toMatch(/pg_advisory_xact_lock\(/);
		expect(rendered[2]?.sql).not.toContain("lock_shared");
		expect(rendered[0]?.params).toEqual(rendered[2]?.params);
		expect(transactionCalls).toBe(0);
	});

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
		).resolves.toEqual({
			mode: "canonical",
			behavior: getCutoverBehavior("canonical"),
		});
		expect(timeline).toEqual(["lock", "mode"]);
		expect(transactionCalls).toBe(0);
	});

	it("propagates write-gate lock and mode-read failures", async () => {
		for (const failureAt of ["lock", "mode"] as const) {
			let calls = 0;
			const service = {
				db: {
					execute: async () => {
						calls += 1;
						if (failureAt === "lock" || calls === 2) {
							throw new Error(`${failureAt} failed`);
						}
						return { rows: [] };
					},
				},
			} as ApprovalDbService;
			await expect(
				acquireApprovalWriteGate(service, {
					organizationId: "org-1",
					workflowType: "absence",
				}),
			).rejects.toThrow(`${failureAt} failed`);
			expect(calls).toBe(failureAt === "lock" ? 1 : 2);
		}
	});
});
