import { describe, expect, it } from "vitest";
import { buildInboxTriage } from "./triage";

describe("policy-aware inbox assessment", () => {
 it("retains known high risk alongside every missing relevant check", () => {
  const result = buildInboxTriage({ type: "time_entry", requestKind: "time_correction", priority: "normal", status: "pending", createdAt: "2026-10-16T08:00:00Z", now: new Date("2026-10-16T09:00:00Z"), riskLevel: "high", riskReasons: ["policy_exception"], timeDeltaMinutes: 1 });
  expect(result.riskLevel).toBe("high");
  expect(result.riskReasons).toEqual(["policy_exception", "payroll_unverified", "correction_unverified"]);
  expect(result.fastLaneGroup).toBeNull();
 });
});

const context = { organizationId: "org", requestId: "request", entityId: "entity", revision: "revision-1", scope: "submitted_request" };
const base = { type: "absence_entry" as const, priority: "normal" as const, status: "pending" as const, createdAt: "2026-10-16T08:00:00Z", now: new Date("2026-10-16T09:00:00Z"), context };
it("retains simultaneous verified payroll and coverage findings and rejects mismatched clear evidence", () => {
 const result = buildInboxTriage({ ...base, evidence: [
  { check: "payroll", state: "finding", validity: "current", context, reason: "payroll_blocker", payrollPeriod: { startDate: "2026-10-01", endDate: "2026-10-31" }, facts: { period: "2026-10" } },
  { check: "coverage", state: "finding", validity: "current", context, reason: "staffing_shortfall", facts: { required: 3, available: 2 } },
  { check: "coverage", state: "clear", validity: "current", context: { ...context, organizationId: "another-org" } },
 ] });
 expect(result.riskLevel).toBe("high");
 expect(result.riskReasons).toEqual(["payroll_blocker", "staffing_shortfall", "coverage_unverified"]);
 expect(result.fastLaneGroup).toBe("payroll_blocker");
 expect(result.reasons?.[1].facts).toEqual({ required: 3, available: 2 });
});
it.each([
 ["2026-03-27T12:00:00Z", "2026-03-30T11:59:59.999Z", false],
 ["2026-03-27T12:00:00Z", "2026-03-30T12:00:00Z", true],
 ["2026-03-27T12:00:00Z", "2026-03-30T12:00:00.001Z", true],
 ["2026-10-23T14:00:00+02:00", "2026-10-26T13:00:00+01:00", true],
])("uses elapsed UTC hours across weekends and DST (%s to %s)", (createdAt, at, stale) => {
 const result = buildInboxTriage({ ...base, createdAt, now: new Date(at) });
 expect(result.riskReasons.includes("stale_pending")).toBe(stale);
 expect(result.riskLevel).toBe(stale ? "high" : "medium");
 expect(result.fastLaneGroup).toBe(stale ? "stale_pending" : null);
});
it("applies the supplied organization policy and retains every reason on a stale payroll blocker", () => {
 const result = buildInboxTriage({ ...base, now: new Date("2026-10-16T10:00:00Z"), policy: { staleAfterHours: 2, smallCorrectionMinutes: 15 }, evidence: [{ check: "payroll", state: "finding", validity: "current", context, reason: "payroll_blocker", payrollPeriod: { startDate: "2026-10-01", endDate: "2026-10-31" } }] });
 expect(result.riskReasons).toEqual(["payroll_blocker", "coverage_unverified", "stale_pending"]);
 expect(result.fastLaneGroup).toBe("payroll_blocker");
});
it("permits an absence-change low lane only with current complete evidence for the same revision", () => {
 const evidence = (["payroll", "coverage"] as const).map(check => ({ check, state: "clear" as const, validity: "current" as const, context }));
 const clear = buildInboxTriage({ ...base, type: "absence_change_request", evidence });
 expect(clear.riskLevel).toBe("low");
 expect(clear.fastLaneGroup).toBe("low_risk_absence");
 const stale = buildInboxTriage({ ...base, type: "absence_change_request", evidence: [evidence[0], { ...evidence[1], validity: "stale" }] });
 expect(stale.riskLevel).toBe("medium");
 expect(stale.riskReasons).toContain("coverage_unverified");
 const wrongRevision = buildInboxTriage({ ...base, evidence: evidence.map(item => ({ ...item, context: { ...context, revision: "previous" } })) });
 expect(wrongRevision.fastLaneGroup).toBeNull();
});
it.each([
 ["2026-10-16T08:15:00Z", "2026-10-16T16:15:00Z", 15, "low"],
 ["2026-10-16T07:45:00Z", "2026-10-16T15:45:00Z", 15, "low"],
 ["2026-10-16T08:15:00.000000001Z", "2026-10-16T16:00:00Z", 15, "medium"],
 ["2026-10-16T10:00:00Z", "2026-10-16T18:00:00Z", 15, "medium"],
 ["2026-10-16T08:00:00Z", "2026-10-16T16:00:00Z", 0, "medium"],
])("checks exact endpoint movement and duration, including disabled threshold (%s)", (proposedStart, proposedEnd, limit, riskLevel) => {
 const result = buildInboxTriage({ ...base, type: "time_entry", requestKind: "time_correction", policy: { staleAfterHours: 72, smallCorrectionMinutes: limit }, evidence: [
  { check: "payroll", state: "clear", validity: "current", context },
  { check: "correction", state: "clear", validity: "current", context, correction: { plainTimeEdit: true, originalStart: "2026-10-16T08:00:00Z", originalEnd: "2026-10-16T16:00:00Z", proposedStart, proposedEnd } },
 ] });
 expect(result.riskLevel).toBe(riskLevel);
 expect(result.fastLaneGroup).toBe(riskLevel === "low" ? "small_time_correction" : null);
});
it("never treats payroll relevance or a prior blocker label as current blocker evidence", () => {
 const result = buildInboxTriage({ ...base, isPayrollRelevant: true, riskLevel: "high", riskReasons: ["payroll_blocker"] });
 expect(result.riskReasons).not.toContain("payroll_blocker");
 expect(result.riskReasons).toContain("payroll_unverified");
 expect(result.fastLaneGroup).toBeNull();
});

