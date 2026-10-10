import { PgDialect, type SQL } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";
import { parseInstant } from "@/lib/datetime/temporal-core";
import type { ApprovalDbService, ApprovalWorkflowLifecycleMode } from "../workflow/ports";

// No kind is canonical-only yet (#1058); compliance exceptions stand in for one.
vi.mock("../workflow/kind-start", async (importOriginal) => {
	const original = await importOriginal<typeof import("../workflow/kind-start")>();
	return {
		...original,
		APPROVAL_KIND_START: {
			...original.APPROVAL_KIND_START,
			compliance_exception: "canonical_only",
		},
	};
});

const { acquireApprovalWriteGate } = await import("./gate");
const { approvalWriteGateResult, isCanonicalOnlyApprovalKind, resolveApprovalKindAuthority } =
	await import("./resolution");
const { validateCutoverTransition } = await import("../workflow/cutover");
const { createOrganizationApprovalRollouts } = await import("../workflow/organization-rollout");
const { executeApprovalWorkflowRollout } = await import(
	"../../../../scripts/approval-workflow-rollout"
);

/** A write-gate transaction whose rollout row reads back as `storedMode`. */
function gateService(storedMode: ApprovalWorkflowLifecycleMode) {
	const inserts: unknown[][] = [];
	const service = {
		db: {
			execute: async (query: SQL) => {
				const rendered = new PgDialect().sqlToQuery(query);
				if (rendered.sql.includes("insert into approval_workflow_rollout")) {
					inserts.push(rendered.params);
				}
				return rendered.sql.includes("select lifecycle_mode")
					? { rows: [{ lifecycle_mode: storedMode }] }
					: { rows: [] };
			},
		},
	} as unknown as ApprovalDbService;
	return { service, inserts };
}

describe("a canonical-only approval kind", () => {
	it("is declared per kind; every existing kind still starts as legacy requests", () => {
		expect(isCanonicalOnlyApprovalKind("compliance_exception")).toBe(true);
		expect(isCanonicalOnlyApprovalKind("absence")).toBe(false);
		expect(isCanonicalOnlyApprovalKind("policy_clock_out")).toBe(false);
	});

	it("resolves an organization without a rollout row to complete mode", () => {
		expect(resolveApprovalKindAuthority("compliance_exception", null)).toEqual({
			mode: "complete",
			authority: "canonical",
			shadowMirroring: false,
			compatibilityWriting: false,
		});
		expect(resolveApprovalKindAuthority("absence", null)).toMatchObject({
			mode: "legacy",
			authority: "legacy",
		});
		expect(resolveApprovalKindAuthority("absence", "canonical")).toMatchObject({
			mode: "canonical",
		});
	});

	it("is inserted in complete mode by the write gate", async () => {
		const { service, inserts } = gateService("complete");
		await expect(
			acquireApprovalWriteGate(service, {
				organizationId: "org-1",
				workflowType: "compliance_exception",
			}),
		).resolves.toEqual(approvalWriteGateResult("complete"));
		expect(inserts).toEqual([
			["org-1", "compliance_exception", "complete", "canonical", expect.any(Date)],
		]);
	});

	it("still inserts an ordinary kind in legacy mode", async () => {
		const { service, inserts } = gateService("legacy");
		await acquireApprovalWriteGate(service, { organizationId: "org-1", workflowType: "absence" });
		expect(inserts).toEqual([["org-1", "absence", "legacy", "legacy", expect.any(Date)]]);
	});

	it.each(["legacy", "shadow", "ready", "canonical"] as const)(
		"refuses to gate a write when its stored row is %s",
		async (storedMode) => {
			const { service } = gateService(storedMode);
			await expect(
				acquireApprovalWriteGate(service, {
					organizationId: "org-1",
					workflowType: "compliance_exception",
				}),
			).rejects.toThrow(/canonical-only/i);
		},
	);

	it("is pre-created in complete mode for a new organization", async () => {
		const values: unknown[] = [];
		const database = {
			insert: () => ({
				values: (rows: unknown[]) => {
					values.push(...rows);
					return { onConflictDoNothing: async () => undefined };
				},
			}),
		};
		await createOrganizationApprovalRollouts(database as never, "org-1");
		const modes = Object.fromEntries(
			(
				values as Array<{ workflowType: string; lifecycleMode: string; sideEffectMode: string }>
			).map((row) => [row.workflowType, [row.lifecycleMode, row.sideEffectMode]]),
		);
		expect(modes.compliance_exception).toEqual(["complete", "canonical"]);
		expect(modes.absence).toEqual(["legacy", "legacy"]);
		expect(modes.travel_expense).toEqual(["legacy", "legacy"]);
	});

	it("is bootstrapped in complete mode for every organization", async () => {
		const calls: SQL[] = [];
		await executeApprovalWorkflowRollout(
			{ kind: "bootstrap" },
			{
				transaction: async (callback) =>
					callback({
						execute: async (query: SQL) => {
							calls.push(query);
							return { rows: [] };
						},
					} as never),
			},
		);
		const rendered = new PgDialect().sqlToQuery(calls[0] as SQL);
		expect(rendered.sql).toContain("workflow_type.lifecycle_mode");
		// The update time is rendered first, then each kind's (type, lifecycle, side effect).
		const rows = rendered.params.slice(1);
		const modes = new Map<unknown, unknown[]>();
		for (let index = 0; index < rows.length; index += 3) {
			modes.set(rows[index], rows.slice(index + 1, index + 3));
		}
		expect(modes.get("compliance_exception")).toEqual(["complete", "canonical"]);
		expect(modes.get("absence")).toEqual(["legacy", "legacy"]);
		expect(modes.size).toBe(7);
	});

	it("refuses to enter shadow before touching the database", async () => {
		const transaction = vi.fn();
		await expect(
			executeApprovalWorkflowRollout(
				{
					kind: "enter-shadow",
					organizationId: "org-1",
					workflowType: "compliance_exception",
					operatorUserId: "user-1",
					evidence: "change-1",
				},
				{ transaction },
			),
		).rejects.toThrow(/canonical-only/i);
		expect(transaction).not.toHaveBeenCalled();
	});

	it.each([
		["complete", "canonical"],
		["complete", "legacy"],
		["legacy", "shadow"],
		["shadow", "ready"],
		["canonical", "complete"],
	] as const)("refuses the cutover %s -> %s", (from, to) => {
		expect(() =>
			validateCutoverTransition({
				organizationId: "org-1",
				workflowType: "compliance_exception",
				from,
				to,
				actor: {
					kind: "system",
					employeeId: null,
					userId: "operator-1",
					fingerprint: "operator:operator-1",
				},
				evidence: { reason: "rollout", recordedAt: parseInstant("2026-10-10T08:00:00Z") },
			}),
		).toThrow(/canonical-only/i);
	});
});
