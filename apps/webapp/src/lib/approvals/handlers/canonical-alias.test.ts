import { and } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { expect, it } from "vitest";
import { buildBaseConditions } from "./base-handler";

const dialect = new PgDialect();
function predicate(
	type: "absence_entry" | "time_entry",
	status: "pending" | "approved" = "pending",
) {
	return dialect.sqlToQuery(
		and(
			...buildBaseConditions(type, {
				organizationId: "org",
				approverId: "manager",
				status,
			}),
		),
	).sql;
}
it("suppresses pending compatibility aliases owned by canonical absence or correction workflows in list and count predicates", () => {
	for (const type of ["absence_entry", "time_entry"] as const) {
		const sql = predicate(type);
		expect(sql).toContain("not exists");
		expect(sql).toContain(
			type === "absence_entry" ? "absence_entry" : "work_period",
		);
		expect(sql).toContain("approval_workflow_rollout");
		expect(sql).toContain("source.approval_workflow_id = workflow.id");
	}
});
it("keeps resolved compatibility history available", () => {
	expect(predicate("absence_entry", "approved")).not.toContain("not exists");
});
