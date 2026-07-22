import { describe, expect, it } from "vitest";
import { classifyTimeApprovalRequest } from "./time-request-kind";

describe("classifyTimeApprovalRequest", () => {
	it("leaves correction and ordinary metadata conflicts unclassified", () => {
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
		).toBe("unclassified");
	});

	it.each([
		"manual_time_submission",
		"policy_clock_out",
	] as const)("classifies unambiguous explicit %s metadata", (kind) => {
		expect(
			classifyTimeApprovalRequest({
				metadata: { timeRequest: { kind } },
			}),
		).toBe(kind);
	});

	it.each([
		{
			kind: "manual_time_submission" as const,
			reason: "Manual time entry: forgot to clock in",
			pendingChanges: { isManualEntry: true },
		},
		{
			kind: "policy_clock_out" as const,
			reason: "Clock-out requires approval (0-day policy)",
			pendingChanges: { isNewClockOut: true },
		},
	])("classifies matching explicit $kind evidence", (input) => {
		expect(
			classifyTimeApprovalRequest({
				metadata: { timeRequest: { kind: input.kind } },
				reason: input.reason,
				pendingChanges: input.pendingChanges,
			}),
		).toBe(input.kind);
	});

	it("retains correction classification when no ordinary evidence conflicts", () => {
		expect(
			classifyTimeApprovalRequest({
				metadata: { timeCorrection: { action: "edit" } },
			}),
		).toBe("time_correction");
	});

	it.each([
		{
			name: "a manual marker",
			pendingChanges: { isManualEntry: true },
		},
		{
			name: "a clock-out marker",
			pendingChanges: { isNewClockOut: true },
		},
		{
			name: "a manual reason",
			reason: "Manual time entry: forgot to clock in",
		},
		{
			name: "the policy clock-out reason",
			reason: "Clock-out requires approval (0-day policy)",
		},
	] as const)("retains correction precedence over legacy-only $name", (legacy) => {
		expect(
			classifyTimeApprovalRequest({
				metadata: { timeCorrection: { action: "edit" } },
				reason: "reason" in legacy ? legacy.reason : undefined,
				pendingChanges:
					"pendingChanges" in legacy ? legacy.pendingChanges : undefined,
			}),
		).toBe("time_correction");
	});

	it.each([
		{
			name: "manual metadata with correction metadata",
			input: {
				metadata: {
					timeRequest: { kind: "manual_time_submission" },
					timeCorrection: { action: "edit" },
				},
			},
		},
		{
			name: "manual metadata with a clock-out marker",
			input: {
				metadata: { timeRequest: { kind: "manual_time_submission" } },
				pendingChanges: { isNewClockOut: true },
			},
		},
		{
			name: "policy metadata with a manual marker",
			input: {
				metadata: { timeRequest: { kind: "policy_clock_out" } },
				pendingChanges: { isManualEntry: true },
			},
		},
		{
			name: "explicit metadata with dual markers",
			input: {
				metadata: { timeRequest: { kind: "manual_time_submission" } },
				pendingChanges: { isManualEntry: true, isNewClockOut: true },
			},
		},
		{
			name: "manual metadata with the policy reason",
			input: {
				metadata: { timeRequest: { kind: "manual_time_submission" } },
				reason: "Clock-out requires approval (0-day policy)",
			},
		},
		{
			name: "policy metadata with a manual reason",
			input: {
				metadata: { timeRequest: { kind: "policy_clock_out" } },
				reason: "Manual time entry: forgot to clock in",
			},
		},
	] as const)("leaves $name unclassified", ({ input }) => {
		expect(classifyTimeApprovalRequest(input)).toBe("unclassified");
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

	it("prefers a clock-out marker over manual legacy prose", () => {
		expect(
			classifyTimeApprovalRequest({
				metadata: null,
				reason: "Manual time entry: ambiguous legacy row",
				pendingChanges: { isNewClockOut: true },
			}),
		).toBe("policy_clock_out");
	});

	it("prefers a manual marker over policy clock-out prose", () => {
		expect(
			classifyTimeApprovalRequest({
				metadata: null,
				reason: "Clock-out requires approval (0-day policy)",
				pendingChanges: { isManualEntry: true },
			}),
		).toBe("manual_time_submission");
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
