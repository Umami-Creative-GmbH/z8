import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { deleteApprovalInTransaction, deleteEmployeeApprovalLifecycles } from "./maintenance";

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
		if (text.startsWith("delete from approval_escalation_attention")) {
			return [{ id: "attention-2" }, { id: "attention-1" }];
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
			intents: [],
		});
		const deletes = statements
			.map((statement) => statement.sql)
			.filter((text) => text.startsWith("delete from"))
			.map((text) => text.split(" ")[2]);
		// Delivery work first: replacement work would otherwise cascade
		// unreported from the escalation journal.
		expect(deletes).toEqual([
			"approval_escalation_attention",
			"approval_delivery_work",
			"approval_delivery_message",
			"approval_escalation_transfer",
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
		expect(statements[2]?.sql).toContain("approval_delivery_intent");
		expect(statements[2]?.sql).toContain("approval_escalation_attention");
	});

	it("removes the lifecycle's escalation attention through the links each incident recorded", async () => {
		const LEGACY_REQUEST = "70000000-0000-4000-8000-000000000001";
		const { statements, transaction } = fakeTransaction({
			workflowIds: [WORKFLOW_ID],
			lifecycle: [
				{ kind: "workflow", id: WORKFLOW_ID },
				{ kind: "legacy", id: LEGACY_REQUEST },
			],
		});

		const result = await deleteApprovalInTransaction(transaction, "org-1", WORKFLOW_ID);

		expect(result.attention).toEqual(["attention-1", "attention-2"]);
		const attention = statements.filter((statement) =>
			statement.sql.startsWith("delete from approval_escalation_attention"),
		);
		expect(attention).toHaveLength(1);
		// Incidents follow the workflow, its assignments (also as lineage root) or the
		// legacy request they recorded; their events cascade.
		expect(attention[0]?.sql).toContain("organization_id = $1");
		expect(attention[0]?.sql).toContain("workflow_id = any($2::uuid[])");
		expect(attention[0]?.sql).toContain("approval_request_id = any($3::uuid[])");
		expect(attention[0]?.sql).toContain(
			"assignment_id in (select id from approval_stage_assignment",
		);
		expect(attention[0]?.sql).toContain(
			"lineage_root_assignment_id in (select id from approval_stage_assignment",
		);
		expect(attention[0]?.sql).not.toContain("source_id");
		expect(attention[0]?.params.slice(0, 3)).toEqual(["org-1", [WORKFLOW_ID], [LEGACY_REQUEST]]);
		// Recovery state goes before the approval rows it describes.
		const deletes = statements.filter((statement) => statement.sql.startsWith("delete from"));
		expect(deletes[0]?.sql.split(" ")[2]).toBe("approval_escalation_attention");
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
		expect(result.delivery).toEqual({ work: [], messages: [], intents: [] });
		expect(
			statements.some((statement) =>
				/^delete from approval_(escalation_attention|escalation_transfer|delivery_work|delivery_message|invocation|decision_evidence|review_binding|submitted_revision)/.test(
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
			// Legacy card decisions (#296) name legacy bindings and invocations.
			reviewBindings: ["binding-1"],
			invocations: ["invocation-1"],
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
		).toEqual([
			"approval_invocation",
			"approval_decision_evidence",
			"approval_review_binding",
			"approval_submitted_revision",
		]);
		for (const statement of legacyDeletes) {
			expect(statement.params.at(0)).toBe("org-1");
			expect(statement.params.at(-1)).toEqual([LEGACY_REVISION]);
		}
	});

	it("removes a legacy lifecycle's delivery before its legacy requests (#296)", async () => {
		const LEGACY_REQUEST = "70000000-0000-4000-8000-000000000001";
		const { statements, transaction } = fakeTransaction({
			workflowIds: [],
			match: "legacy",
			lifecycle: [{ kind: "legacy", id: LEGACY_REQUEST }],
		});

		const result = await deleteApprovalInTransaction(transaction, "org-1", LEGACY_REQUEST);

		const deletes = statements
			.map((statement) => statement)
			.filter((statement) => statement.sql.startsWith("delete from"));
		expect(deletes.map((statement) => statement.sql.split(" ")[2])).toEqual([
			"approval_escalation_attention",
			"approval_delivery_work",
			"approval_delivery_message",
			"approval_delivery_intent",
			"approval_request",
		]);
		for (const statement of deletes.slice(1, 4)) {
			// Scoped by organization and the lifecycle's legacy requests only.
			expect(statement.sql).toContain("legacy_approval_request_id = any($2::uuid[])");
			expect(statement.params).toEqual(["org-1", [LEGACY_REQUEST]]);
		}
		expect(deletes[1]?.sql).toContain("lifecycle = 'legacy'");
		expect(deletes[2]?.sql).toContain("lifecycle = 'legacy'");
		expect(result.delivery).toEqual({
			work: ["work-1", "work-2"],
			messages: ["message-1"],
			intents: [],
		});
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

describe("deleteEmployeeApprovalLifecycles", () => {
	const EMPLOYEE = "80000000-0000-4000-8000-000000000001";
	const FIRST = "80000000-0000-4000-8000-000000000002";
	const SECOND = "80000000-0000-4000-8000-000000000003";

	function employeeTransaction(options: { roots: string[]; purged: string[] }) {
		const statements: Array<{ sql: string; params: unknown[] }> = [];
		return {
			statements,
			transaction: {
				execute: async (query: SQL) => {
					const rendered = dialect.sqlToQuery(query);
					const text = rendered.sql.replace(/\s+/g, " ").trim();
					statements.push({ sql: text, params: rendered.params });
					if (text.includes("as root_kind")) {
						return { rows: options.roots.map((id) => ({ root_kind: "workflow", id })) };
					}
					if (text.includes("select 'legacy' as storage_type")) {
						// An earlier lifecycle's deletion already removed a purged root.
						const id = rendered.params.find((param) => options.roots.includes(String(param)));
						return {
							rows: options.purged.includes(String(id)) ? [] : [{ storage_type: "workflow", id }],
						};
					}
					if (text.includes("with recursive edges")) {
						const id = rendered.params.find((param) => options.roots.includes(String(param)));
						return { rows: [{ kind: "workflow", id }] };
					}
					if (text.startsWith("delete from approval_workflow ")) {
						return { rows: [{ id: rendered.params.at(-1)?.toString() ?? "" }] };
					}
					if (text.startsWith("delete from approval_escalation_attention")) {
						return {
							rows: text.includes("current_approver_employee_id") ? [{ id: "attention-9" }] : [],
						};
					}
					return { rows: [] };
				},
			},
		};
	}

	it("finds lifecycles through every employee reference and purges each through its links", async () => {
		const { statements, transaction } = employeeTransaction({ roots: [FIRST, SECOND], purged: [] });

		const result = await deleteEmployeeApprovalLifecycles(transaction, {
			organizationId: "org-1",
			employeeIds: [EMPLOYEE],
		});

		expect(result.lifecycles.map((lifecycle) => lifecycle.approvalId)).toEqual([FIRST, SECOND]);
		const roots = statements.find((statement) => statement.sql.includes("as root_kind"));
		for (const reference of [
			"approval_workflow where",
			"requester_employee_id",
			"approver_employee_id",
			"reassigned_by_employee_id",
			"resolved_by_actor_id",
			"actor_employee_id",
			"recipient_employee_id",
			"requested_by",
			"approver_id",
			"decided_by",
			"resolved_approver_employee_id",
			"subject_employee_id",
			"submitter_employee_id",
			"source_approver_employee_id",
			"replacement_approver_employee_id",
			"current_approver_employee_id",
		]) {
			expect({ reference, found: roots?.sql.includes(reference) }).toEqual({
				reference,
				found: true,
			});
		}
		// Scoped to the organization and the given employees; never a shared source ID.
		expect(roots?.params.at(0)).toBe("org-1");
		expect(roots?.params).toContainEqual([EMPLOYEE]);
		expect(roots?.sql).not.toContain("source_id");
		// Attention that names an employee without a remaining lifecycle goes last.
		expect(result.attention).toEqual(["attention-9"]);
		const last = statements.filter((statement) => statement.sql.startsWith("delete from")).at(-1);
		expect(last?.sql).toContain("current_approver_employee_id = any(");
	});

	it("skips a root that an earlier lifecycle's deletion already removed", async () => {
		const { transaction } = employeeTransaction({ roots: [FIRST, SECOND], purged: [SECOND] });

		const result = await deleteEmployeeApprovalLifecycles(transaction, {
			organizationId: "org-1",
			employeeIds: [EMPLOYEE],
		});

		expect(result.lifecycles.map((lifecycle) => lifecycle.approvalId)).toEqual([FIRST]);
	});

	it("does nothing without employees", async () => {
		const { statements, transaction } = employeeTransaction({ roots: [FIRST], purged: [] });

		const result = await deleteEmployeeApprovalLifecycles(transaction, {
			organizationId: "org-1",
			employeeIds: [],
		});

		expect(result).toEqual({ lifecycles: [], attention: [] });
		expect(statements).toEqual([]);
	});
});
