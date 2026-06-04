import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("src/lib/approvals/handlers/time-correction.handler.ts", "utf8");

function handlerSection() {
	const start = source.indexOf("getDetail: (entityId");
	const end = source.indexOf("\n\tapprove:", start);

	expect(start).toBeGreaterThanOrEqual(0);
	expect(end).toBeGreaterThan(start);

	return source.slice(start, end);
}

describe("TimeCorrectionHandler detail loading", () => {
	it("binds approval detail to the selected approval request within the organization", () => {
		const body = handlerSection();

		expect(body).toContain("context?.approvalId");
		expect(body).toContain("eq(approvalRequest.id, context.approvalId)");
		expect(body).toContain("eq(approvalRequest.organizationId, organizationId)");
		expect(body).toContain("eq(approvalRequest.entityType, \"time_entry\")");
		expect(body).toContain("eq(approvalRequest.entityId, entityId)");
	});
});
