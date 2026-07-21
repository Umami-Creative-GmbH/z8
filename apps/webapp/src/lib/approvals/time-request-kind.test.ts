import { describe, expect, it } from "vitest";
import { classifyTimeApprovalRequest } from "./time-request-kind";

describe("classifyTimeApprovalRequest", () => {
	it("classifies correction metadata before every other signal", () => {
		expect(
			classifyTimeApprovalRequest({
				metadata: {
					timeCorrection: { action: "edit" },
					timeRequest: { kind: "manual_time_submission" },
				},
				reason: "Manual time entry: missed punch",
				pendingChanges: { isManualEntry: true },
				hasRelationalCorrectionEvidence: false,
			}),
		).toBe("time_correction");
	});

	it.each([
		"manual_time_submission",
		"policy_clock_out",
	] as const)("classifies explicit %s metadata before legacy and relational signals", (kind) => {
		expect(
			classifyTimeApprovalRequest({
				metadata: { timeRequest: { kind } },
				reason: "Manual time entry: legacy reason",
				pendingChanges: { isManualEntry: true },
				hasRelationalCorrectionEvidence: true,
			}),
		).toBe(kind);
	});

	it("classifies a legacy manual request from its reason and marker", () => {
		expect(
			classifyTimeApprovalRequest({
				metadata: null,
				reason: "Manual time entry: forgot to clock in",
				pendingChanges: { isManualEntry: true },
			}),
		).toBe("manual_time_submission");
	});

	it("classifies a legacy manual request when old rows have no marker", () => {
		expect(
			classifyTimeApprovalRequest({
				metadata: null,
				reason: "Manual time entry: forgot to clock in",
				pendingChanges: null,
			}),
		).toBe("manual_time_submission");
	});

	it("classifies a legacy manual request when pending changes predate kind markers", () => {
		expect(
			classifyTimeApprovalRequest({
				metadata: null,
				reason: "Manual time entry: forgot to clock in",
				pendingChanges: { reason: "forgot to clock in", requestedBy: "user-1" },
			}),
		).toBe("manual_time_submission");
	});

	it("prefers a single positive clock-out marker over conflicting legacy prose", () => {
		expect(
			classifyTimeApprovalRequest({
				metadata: null,
				reason: "Manual time entry: ambiguous legacy row",
				pendingChanges: { isNewClockOut: true },
			}),
		).toBe("policy_clock_out");
	});

	it("classifies the exact legacy policy clock-out reason", () => {
		expect(
			classifyTimeApprovalRequest({
				metadata: null,
				reason: "Clock-out requires approval (0-day policy)",
				pendingChanges: { isNewClockOut: true },
			}),
		).toBe("policy_clock_out");
	});

	it("classifies a marker-only manual request when a later chain stage has no reason", () => {
		expect(
			classifyTimeApprovalRequest({
				metadata: null,
				reason: null,
				pendingChanges: { isManualEntry: true },
			}),
		).toBe("manual_time_submission");
	});

	it("classifies a marker-only policy clock-out even when prose is unavailable", () => {
		expect(
			classifyTimeApprovalRequest({
				metadata: null,
				reason: null,
				pendingChanges: { isNewClockOut: true },
			}),
		).toBe("policy_clock_out");
	});

	it("leaves contradictory marker-only requests unclassified", () => {
		expect(
			classifyTimeApprovalRequest({
				metadata: null,
				reason: null,
				pendingChanges: { isManualEntry: true, isNewClockOut: true },
			}),
		).toBe("unclassified");
	});

	it("uses relational correction evidence after ordinary legacy signals", () => {
		expect(
			classifyTimeApprovalRequest({
				metadata: null,
				reason: "Please fix this shift",
				pendingChanges: null,
				hasRelationalCorrectionEvidence: true,
			}),
		).toBe("time_correction");
	});

	it("leaves requests unclassified when no reliable signal exists", () => {
		expect(
			classifyTimeApprovalRequest({
				metadata: { timeRequest: { kind: "unknown" } },
				reason: "Please review",
				pendingChanges: { reason: "missing context" },
				hasRelationalCorrectionEvidence: false,
			}),
		).toBe("unclassified");
	});
});
