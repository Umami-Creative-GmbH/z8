import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { deleteApprovalInTransaction } from "./maintenance";

const dialect = new PgDialect();
const WORKFLOW_ID = "60000000-0000-4000-8000-000000000001";

function fakeTransaction(options: { workflowIds: string[] }) {
	const statements: Array<{ sql: string; params: unknown[] }> = [];
	const rowsFor = (text: string): Record<string, unknown>[] => {
		if (text.includes("select 'legacy' as storage_type")) {
			return [{ storage_type: "workflow", id: WORKFLOW_ID }];
		}
		if (text.includes("with recursive edges")) {
			return options.workflowIds.map((id) => ({ kind: "workflow", id }));
		}
		if (text.startsWith("delete from approval_decision_evidence")) {
			return [{ id: "decision-2" }, { id: "decision-1" }];
		}
		if (text.startsWith("delete from approval_review_binding")) {
			return [{ id: "binding-1" }];
		}
		if (text.startsWith("delete from approval_submitted_revision")) {
			return [{ id: "revision-1" }];
		}
		if (text.startsWith("delete from approval_workflow")) {
			return options.workflowIds.map((id) => ({ id }));
		}
		return [];
	};
	return {
		statements,
		transaction: {
			execute: async (query: SQL) => {
				const rendered = dialect.sqlToQuery(query);
				const text = rendered.sql.replace(/\s+/g, " ").trim();
				statements.push({ sql: text, params: rendered.params });
				return { rows: rowsFor(text) };
			},
		},
	};
}

describe("deleteApprovalInTransaction evidence cleanup", () => {
	it("removes and reports the lifecycle's evidence before its workflows", async () => {
		const { statements, transaction } = fakeTransaction({
			workflowIds: [WORKFLOW_ID],
		});

		const result = await deleteApprovalInTransaction(
			transaction,
			"org-1",
			WORKFLOW_ID,
		);

		expect(result.evidence).toEqual({
			submittedRevisions: ["revision-1"],
			decisionEvidence: ["decision-1", "decision-2"],
			reviewBindings: ["binding-1"],
		});
		const deletes = statements
			.map((statement) => statement.sql)
			.filter((text) => text.startsWith("delete from"))
			.map((text) => text.split(" ")[2]);
		expect(deletes).toEqual([
			"approval_decision_evidence",
			"approval_review_binding",
			"approval_submitted_revision",
			"approval_workflow",
		]);
		for (const statement of statements.filter((candidate) =>
			/^delete from approval_(decision_evidence|review_binding|submitted_revision)/.test(
				candidate.sql,
			),
		)) {
			// Scoped by organization and the verified workflow links only.
			expect(statement.sql).toContain("organization_id = $1");
			expect(statement.sql).toContain("workflow_id = any($2::uuid[])");
			expect(statement.params).toEqual(["org-1", [WORKFLOW_ID]]);
		}
		expect(statements[2]?.sql).toContain("approval_submitted_revision");
		expect(statements[2]?.sql).toContain("approval_decision_evidence");
	});

	it("touches no evidence when the lifecycle has no canonical workflow", async () => {
		const { statements, transaction } = fakeTransaction({ workflowIds: [] });

		const result = await deleteApprovalInTransaction(
			transaction,
			"org-1",
			WORKFLOW_ID,
		);

		expect(result.evidence).toEqual({
			submittedRevisions: [],
			decisionEvidence: [],
			reviewBindings: [],
		});
		expect(
			statements.some((statement) =>
				/approval_(decision_evidence|review_binding|submitted_revision) where/.test(
					statement.sql,
				),
			),
		).toBe(false);
	});
});
