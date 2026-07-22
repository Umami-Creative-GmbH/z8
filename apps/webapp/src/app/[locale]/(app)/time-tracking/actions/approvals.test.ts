import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = readFileSync(
	fileURLToPath(new URL("./approvals.ts", import.meta.url)),
	"utf8",
);

describe("ordinary approval ownership", () => {
	it("contains notification delivery only", () => {
		expect(source).not.toContain("resolvePolicyAndCreateApproval");
		expect(source).not.toContain("createTimeEntryApprovalRequest");
		expect(source).not.toContain("createClockOutApprovalRequest");
		expect(source).not.toContain("createManualEntryApprovalRequest");
		expect(source).not.toContain(".insert(approvalRequest)");
	});
});
