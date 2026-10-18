import { expect, it } from "vitest";
import { resolveApprovalInboxTriage } from "./triage-evidence";
it("cannot certify clear using evidence resolved for another organization", async () => {
 const context = { organizationId: "org", requestId: "request", entityId: "entity", revision: null, scope: "submitted_request" };
 const other = { ...context, organizationId: "other", revision: "r1" };
 const result = await resolveApprovalInboxTriage({ policy: { staleAfterHours: 72, smallCorrectionMinutes: 15 }, target: { context, requestKind: "absence", type: "absence_entry", status: "pending", createdAt: "2026-10-16T08:00:00Z", priority: "normal" }, now: new Date("2026-10-16T09:00:00Z"), loadEvidence: async () => ({ context: other, evidence: (["payroll", "coverage"] as const).map(check => ({check, state: "clear", validity: "current", context: other})) }) });
 expect(result.riskLevel).toBe("medium");
 expect(result.riskReasons).toEqual(["payroll_unverified", "coverage_unverified"]);
 expect(result.fastLaneGroup).toBeNull();
});
it("keeps manual review available and labels unavailable evidence when an adapter cannot be read", async () => {
 const context = { organizationId: "org", requestId: "request", entityId: "entity", revision: null, scope: "submitted_request" };
 const result = await resolveApprovalInboxTriage({ policy: { staleAfterHours: 72, smallCorrectionMinutes: 15 }, target: { context, requestKind: "absence", type: "absence_entry", status: "pending", createdAt: "2026-10-16T08:00:00Z", priority: "normal" }, now: new Date("2026-10-16T09:00:00Z"), loadEvidence: async () => { throw new Error("Unavailable evidence source"); } });
 expect(result.riskLevel).toBe("medium");
 expect(result.evidence?.every(item => item.state === "unknown" && item.limitation === "unavailable")).toBe(true);
 expect(result.fastLaneGroup).toBeNull();
});
