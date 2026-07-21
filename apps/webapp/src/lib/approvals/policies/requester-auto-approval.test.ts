import { describe, expect, it } from "vitest";
import { classifyLegacyStage } from "./requester-auto-approval";

describe("classifyLegacyStage", () => {
	it("auto-approves a stage resolved to the requester", () => {
		expect(
			classifyLegacyStage({
				requesterEmployeeId: "employee-1",
				approverEmployeeId: "employee-1",
			}),
		).toEqual({ kind: "auto_approve", reason: "requester_is_approver" });
	});

	it("keeps a stage resolved to another employee as human approval", () => {
		expect(
			classifyLegacyStage({
				requesterEmployeeId: "employee-1",
				approverEmployeeId: "employee-2",
			}),
		).toEqual({ kind: "human", approverEmployeeId: "employee-2" });
	});
});
