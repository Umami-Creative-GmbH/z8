/**
 * #1058 runtime evidence: a canonical-only approval kind starts in `complete`
 * mode on every path that can create or stand in for its rollout row.
 *
 * Local contract: pnpm --filter webapp test:integration
 * The runner creates, migrates, verifies, and removes a label-owned PostgreSQL 16 database.
 *
 * No kind is canonical-only yet, so compliance exceptions are declared one
 * here; everything else runs against real rows.
 */

import { sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { integrationAdminPool } from "@/test/integration-database";

vi.mock("@/lib/approvals/workflow/kind-start", async (importOriginal) => {
	const original = await importOriginal<typeof import("@/lib/approvals/workflow/kind-start")>();
	return {
		...original,
		APPROVAL_KIND_START: {
			...original.APPROVAL_KIND_START,
			compliance_exception: "canonical_only",
		},
	};
});

const { db } = await import("@/db");
const {
	acquireApprovalWriteGate,
	approvalWriteGateResult,
	readApprovalAuthoritySnapshot,
	readApprovalAuthoritySnapshots,
} = await import(".");
const { createOrganizationApprovalRollouts } = await import(
	"@/lib/approvals/workflow/organization-rollout"
);
const { executeApprovalWorkflowRollout } = await import(
	"../../../../scripts/approval-workflow-rollout"
);

const organizationId = "t1058-canonical-only";

describe("a canonical-only approval kind on PostgreSQL", () => {
	const admin = integrationAdminPool();
	const timestamp = new Date("2026-10-10T08:00:00Z");

	async function cleanup() {
		await admin.query("delete from organization where id = $1", [organizationId]);
	}

	async function rollout(workflowType: string) {
		const { rows } = await admin.query<{ lifecycle_mode: string; side_effect_mode: string }>(
			`select lifecycle_mode, side_effect_mode from approval_workflow_rollout
			 where organization_id = $1 and workflow_type = $2`,
			[organizationId, workflowType],
		);
		return rows[0] ?? null;
	}

	beforeEach(async () => {
		await cleanup();
		await admin.query(
			"insert into organization (id, name, slug, created_at) values ($1, 'T1058', $1, $2)",
			[organizationId, timestamp],
		);
	});

	afterAll(cleanup);

	it("resolves an organization without a rollout row to complete mode", async () => {
		await expect(
			readApprovalAuthoritySnapshot(db, { organizationId, workflowType: "compliance_exception" }),
		).resolves.toEqual({
			mode: "complete",
			authority: "canonical",
			shadowMirroring: false,
			compatibilityWriting: false,
		});
		const snapshots = await readApprovalAuthoritySnapshots(db, organizationId, [
			"compliance_exception",
			"absence",
		]);
		expect(snapshots.get("compliance_exception")?.mode).toBe("complete");
		expect(snapshots.get("absence")?.mode).toBe("legacy");
		expect(await rollout("compliance_exception")).toBeNull();
	});

	it("is created in complete mode with a new organization", async () => {
		await db.transaction((tx) => createOrganizationApprovalRollouts(tx, organizationId));
		expect(await rollout("compliance_exception")).toEqual({
			lifecycle_mode: "complete",
			side_effect_mode: "canonical",
		});
		expect(await rollout("absence")).toEqual({
			lifecycle_mode: "legacy",
			side_effect_mode: "legacy",
		});
	});

	it("is inserted in complete mode by the write gate", async () => {
		const gate = await db.transaction((tx) =>
			acquireApprovalWriteGate(
				{ db: tx },
				{ organizationId, workflowType: "compliance_exception" },
			),
		);
		expect(gate).toEqual(approvalWriteGateResult("complete"));
		expect(await rollout("compliance_exception")).toEqual({
			lifecycle_mode: "complete",
			side_effect_mode: "canonical",
		});
	});

	it("refuses a write when its stored row is not complete", async () => {
		await admin.query(
			`insert into approval_workflow_rollout
			 (organization_id, workflow_type, lifecycle_mode, side_effect_mode, created_at, updated_at)
			 values ($1, 'compliance_exception', 'legacy', 'legacy', $2, $2)`,
			[organizationId, timestamp],
		);
		await expect(
			db.transaction((tx) =>
				acquireApprovalWriteGate(
					{ db: tx },
					{ organizationId, workflowType: "compliance_exception" },
				),
			),
		).rejects.toThrow(/canonical-only/i);
	});

	it("is bootstrapped in complete mode next to existing kinds in legacy", async () => {
		// The bootstrap covers every organization in the database; roll it back.
		const rolledBack = new Error("t1058 rollback");
		let observed: unknown[] = [];
		await expect(
			db.transaction(async (tx) => {
				await executeApprovalWorkflowRollout(
					{ kind: "bootstrap" },
					{ transaction: (callback) => callback(tx as never) },
				);
				const result = await tx.execute(sql`
					select workflow_type::text as workflow_type, lifecycle_mode::text as lifecycle_mode,
						side_effect_mode::text as side_effect_mode
					from approval_workflow_rollout
					where organization_id = ${organizationId}
						and workflow_type in ('compliance_exception', 'policy_clock_out')
					order by workflow_type::text
				`);
				observed = result.rows;
				throw rolledBack;
			}),
		).rejects.toBe(rolledBack);
		expect(observed).toEqual([
			{
				workflow_type: "compliance_exception",
				lifecycle_mode: "complete",
				side_effect_mode: "canonical",
			},
			{ workflow_type: "policy_clock_out", lifecycle_mode: "legacy", side_effect_mode: "legacy" },
		]);
	});
});
