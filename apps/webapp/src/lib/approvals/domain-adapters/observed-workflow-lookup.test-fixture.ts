import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";

interface ObservableWorkflow {
	id: string;
	organizationId: string;
	workflowType: string;
	sourceType: string;
	sourceId: string;
	stages: ReadonlyArray<{ legacyApprovalRequestId: string | null }>;
}

const dialect = new PgDialect();

/**
 * Answers the legacy write coordinator's observed-workflow lookup (#475) from
 * in-memory workflows, the way `createObservedWorkflowReader` reads them;
 * null for any other statement.
 */
export function answerObservedWorkflowLookup(
	statement: SQL,
	workflows: Iterable<ObservableWorkflow>,
): { rows: Array<{ id: string }> } | null {
	const query = dialect.sqlToQuery(statement);
	if (!query.sql.includes("stage.legacy_approval_request_id =")) return null;
	const [organizationId, workflowType, sourceType, sourceId, legacyApprovalRequestId] =
		query.params;
	const rows = [...workflows]
		.filter(
			(workflow) =>
				workflow.organizationId === organizationId &&
				workflow.workflowType === workflowType &&
				workflow.sourceType === sourceType &&
				workflow.sourceId === sourceId &&
				workflow.stages.some((stage) => stage.legacyApprovalRequestId === legacyApprovalRequestId),
		)
		.map((workflow) => ({ id: workflow.id }));
	return { rows };
}
