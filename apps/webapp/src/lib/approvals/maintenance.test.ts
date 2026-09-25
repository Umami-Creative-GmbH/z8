import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { deleteApprovalInTransaction } from "./maintenance";

const dialect = new PgDialect();
const WORKFLOW_ID = "60000000-0000-4000-8000-000000000001";

function fakeTransaction(options: {
	workflowIds: string[];
	match?: string;
	lifecycle?: Array<{ kind: string; id: string }>;
}) {
	const statements: Array<{ sql: string; params: unknown[] }> = [];
	const rowsFor = (text: string): Record<string, unknown>[] => {
		if (text.includes("select 'legacy' as storage_type")) {
			return [{ storage_type: options.match ?? "workflow", id: WORKFLOW_ID }];
		}
		if (text.includes("with recursive edges")) {
			return (
				options.lifecycle ??
				options.workflowIds.map((id) => ({ kind: "workflow", id }))
			);
		}
		if (text.startsWith("delete from approval_escalation_transfer")) {
			return [{ id: "transfer-2" }, { id: "transfer-1" }];
		}
		if (text.startsWith("delete from approval_delivery_work")) {
			return [{ id: "work-2" }, { id: "work-1" }];
		}
		if (text.startsWith("delete from approval_delivery_message")) {
			return [{ id: "message-1" }];
		}
		if (text.startsWith("delete from approval_invocation")) {
			return [{ id: "invocation-1" }];
		}
		if (text.startsWith("delete from approval_decision_evidence")) {
			return text.includes("authority = 'legacy'")
				? [{ id: "legacy-decision-1" }]
				: [{ id: "decision-2" }, { id: "decision-1" }];
		}
		if (
			text.startsWith("delete from approval_submitted_revision") &&
			text.includes("authority = 'legacy'")
		) {
			return [{ id: "legacy-revision-1" }];
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
			invocations: ["invocation-1"],
		});
		expect(result.escalationTransfers).toEqual(["transfer-1", "transfer-2"]);
		expect(result.delivery).toEqual({
			work: ["work-1", "work-2"],
			messages: ["message-1"],
		});
		const deletes = statements
			.map((statement) => statement.sql)
			.filter((text) => text.startsWith("delete from"))
			.map((text) => text.split(" ")[2]);
		expect(deletes).toEqual([
			"approval_escalation_transfer",
			"approval_delivery_work",
			"approval_delivery_message",
			"approval_invocation",
			"approval_decision_evidence",
			"approval_review_binding",
			"approval_submitted_revision",
			"approval_workflow",
		]);
		for (const statement of statements.filter((candidate) =>
			/^delete from approval_(escalation_transfer|delivery_work|delivery_message|invocation|decision_evidence|review_binding|submitted_revision)/.test(
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
		expect(statements[2]?.sql).toContain("approval_invocation");
		expect(statements[2]?.sql).toContain("approval_delivery_work");
		expect(statements[2]?.sql).toContain("approval_delivery_message");
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
			invocations: [],
		});
		expect(result.escalationTransfers).toEqual([]);
		expect(result.delivery).toEqual({ work: [], messages: [] });
		expect(
			statements.some((statement) =>
				/^delete from approval_(escalation_transfer|delivery_work|delivery_message|invocation|decision_evidence|review_binding|submitted_revision)/.test(
					statement.sql,
				),
			),
		).toBe(false);
	});

	it("follows legacy evidence links, not source IDs, and reports what it removed", async () => {
		const LEGACY_REQUEST = "70000000-0000-4000-8000-000000000001";
		const LEGACY_REVISION = "70000000-0000-4000-8000-000000000002";
		const { statements, transaction } = fakeTransaction({
			workflowIds: [],
			match: "legacy_evidence",
			lifecycle: [
				{ kind: "legacy", id: LEGACY_REQUEST },
				{ kind: "legacy_evidence", id: LEGACY_REVISION },
			],
		});

		const result = await deleteApprovalInTransaction(
			transaction,
			"org-1",
			LEGACY_REVISION,
		);

		expect(result.evidence).toEqual({
			submittedRevisions: ["legacy-revision-1"],
			decisionEvidence: ["legacy-decision-1"],
			reviewBindings: [],
			invocations: [],
		});
		const lifecycle = statements.find((statement) =>
			statement.sql.includes("with recursive edges"),
		);
		// Legacy evidence is linked through the rows it recorded, never source_id.
		expect(lifecycle?.sql).toContain(
			"select 'legacy_evidence', id, 'legacy', legacy_approval_request_id",
		);
		expect(lifecycle?.sql).toContain(
			"select 'legacy_evidence', id, 'chain', legacy_chain_instance_id",
		);
		expect(lifecycle?.sql).toContain(
			"select 'legacy_evidence', id, 'workflow', observed_workflow_id",
		);
		expect(lifecycle?.sql).not.toContain("source_id");
		const legacyDeletes = statements.filter(
			(statement) =>
				statement.sql.startsWith("delete from approval_") &&
				statement.sql.includes("authority = 'legacy'"),
		);
		expect(
			legacyDeletes.map((statement) => statement.sql.split(" ")[2]),
		).toEqual(["approval_decision_evidence", "approval_submitted_revision"]);
		for (const statement of legacyDeletes) {
			expect(statement.params).toEqual(["org-1", [LEGACY_REVISION]]);
		}
	});

	it("removes a legacy lifecycle's escalation transfers through the links they recorded", async () => {
		const LEGACY_REQUEST = "70000000-0000-4000-8000-000000000001";
		const LEGACY_TRANSFER = "70000000-0000-4000-8000-000000000003";
		const { statements, transaction } = fakeTransaction({
			workflowIds: [],
			match: "legacy",
			lifecycle: [
				{ kind: "legacy", id: LEGACY_REQUEST },
				{ kind: "legacy_transfer", id: LEGACY_TRANSFER },
			],
		});

		const result = await deleteApprovalInTransaction(transaction, "org-1", LEGACY_REQUEST);

		const lifecycle = statements.find((statement) =>
			statement.sql.includes("with recursive edges"),
		);
		expect(lifecycle?.sql).toContain(
			"select 'legacy_transfer', id, 'legacy', legacy_approval_request_id from approval_escalation_transfer",
		);
		expect(lifecycle?.sql).toContain(
			"select 'legacy_transfer', id, 'workflow', observed_workflow_id from approval_escalation_transfer",
		);
		const transferDeletes = statements.filter((statement) =>
			statement.sql.startsWith("delete from approval_escalation_transfer"),
		);
		expect(transferDeletes).toHaveLength(1);
		expect(transferDeletes[0]?.sql).toContain("authority_mode = 'legacy'");
		expect(transferDeletes[0]?.params).toEqual(["org-1", [LEGACY_TRANSFER]]);
		expect(result.escalationTransfers).toEqual(["transfer-1", "transfer-2"]);
	});

	it("addresses a legacy escalation transfer whose request was already deleted", async () => {
		const LEGACY_TRANSFER = "70000000-0000-4000-8000-000000000003";
		const { statements, transaction } = fakeTransaction({
			workflowIds: [],
			match: "legacy_transfer",
			lifecycle: [{ kind: "legacy_transfer", id: LEGACY_TRANSFER }],
		});

		const result = await deleteApprovalInTransaction(transaction, "org-1", LEGACY_TRANSFER);

		const match = statements.find((statement) =>
			statement.sql.includes("select 'legacy' as storage_type"),
		);
		expect(match?.sql).toContain(
			"select 'legacy_transfer' as storage_type, id from approval_escalation_transfer",
		);
		expect(result.escalationTransfers).toEqual(["transfer-1", "transfer-2"]);
		expect(result.legacyRequests).toEqual([]);
	});
});
