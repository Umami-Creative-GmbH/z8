import { describe, expect, it } from "vitest";
import { buildInboxTriage } from "@/lib/approvals/inbox/triage";

describe("buildInboxTriage", () => {
	it("marks payroll relevant items as high-risk payroll blockers", () => {
		expect(
			buildInboxTriage({
				type: "travel_expense_claim",
				priority: "urgent",
				status: "pending",
				createdAt: new Date("2026-05-31T08:00:00.000Z"),
				now: new Date("2026-05-31T09:00:00.000Z"),
				isPayrollRelevant: true,
			}),
		).toMatchObject({
			riskLevel: "high",
			riskReasons: ["payroll_relevant"],
			fastLaneGroup: "payroll_blocker",
			isPayrollRelevant: true,
			explanation: "Blocks payroll readiness.",
		});
	});

	it("marks old pending requests as stale high-risk items", () => {
		expect(
			buildInboxTriage({
				type: "travel_expense_claim",
				priority: "normal",
				status: "pending",
				createdAt: new Date("2026-05-27T09:00:00.000Z"),
				now: new Date("2026-05-31T09:00:00.000Z"),
			}),
		).toMatchObject({
			riskLevel: "high",
			riskReasons: ["stale_pending"],
			fastLaneGroup: "stale_pending",
			explanation: "Pending longer than 3 days.",
		});
	});

	it("marks small time corrections as low risk only with a safe delta", () => {
		expect(
			buildInboxTriage({
				type: "time_entry",
				priority: "low",
				status: "pending",
				createdAt: new Date("2026-05-31T08:00:00.000Z"),
				now: new Date("2026-05-31T09:00:00.000Z"),
				timeDeltaMinutes: 10,
			}),
		).toMatchObject({
			riskLevel: "low",
			riskReasons: ["small_time_delta"],
			fastLaneGroup: "small_time_correction",
		});
	});

	it("defaults ambiguous items to medium risk and no low-risk fast lane", () => {
		expect(
			buildInboxTriage({
				type: "time_entry",
				priority: "normal",
				status: "pending",
				createdAt: new Date("2026-05-31T08:00:00.000Z"),
				now: new Date("2026-05-31T09:00:00.000Z"),
			}),
		).toMatchObject({
			riskLevel: "medium",
			riskReasons: ["needs_review"],
			fastLaneGroup: null,
		});
	});

	it("marks absence entries without high risk as low risk", () => {
		expect(
			buildInboxTriage({
				type: "absence_entry",
				priority: "normal",
				status: "pending",
				createdAt: new Date("2026-05-31T08:00:00.000Z"),
				now: new Date("2026-05-31T09:00:00.000Z"),
			}),
		).toMatchObject({
			riskLevel: "low",
			riskReasons: ["no_conflicts_detected"],
			fastLaneGroup: "low_risk_absence",
			explanation: "No conflicts detected.",
		});
	});

	it("ignores provided risk metadata for ambiguous time entries without a safe delta", () => {
		expect(
			buildInboxTriage({
				type: "time_entry",
				priority: "normal",
				status: "pending",
				createdAt: new Date("2026-05-31T08:00:00.000Z"),
				now: new Date("2026-05-31T09:00:00.000Z"),
				riskLevel: "high",
			}),
		).toMatchObject({
			riskLevel: "medium",
			riskReasons: ["needs_review"],
			fastLaneGroup: null,
			explanation: "Needs manual review.",
		});
	});
});
