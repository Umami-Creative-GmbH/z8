import { expect, it } from "vitest";
import { resolveApprovalInboxTriage } from "./triage-evidence";
it("cannot certify clear using evidence resolved for another organization", async () => {
 const context = { organizationId: "org", requestId: "request", entityId: "entity", revision: null, scope: "submitted_request" };
 const other = { ...context, organizationId: "other", revision: "r1" };
 const result = await resolveApprovalInboxTriage({ target: { context, requestKind: "absence", type: "absence_entry", status: "pending", createdAt: "2026-10-16T08:00:00Z", priority: "normal" }, now: new Date("2026-10-16T09:00:00Z"), loadEvidence: async () => ({ context: other, evidence: (["payroll", "coverage"] as const).map(check => ({check, state: "clear", validity: "current", context: other})) }) });
 expect(result.riskLevel).toBe("medium");
 expect(result.riskReasons).toEqual(["payroll_unverified", "coverage_unverified"]);
 expect(result.fastLaneGroup).toBeNull();
});
