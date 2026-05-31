import { describe, expect, it } from "vitest";
import {
	SUPPORTED_APPROVAL_INBOX_TYPES,
	type ApprovalInboxItem,
} from "@/lib/approvals/inbox/types";

describe("approval inbox contract types", () => {
	it("exposes only current live approval sources", () => {
		expect(SUPPORTED_APPROVAL_INBOX_TYPES).toEqual([
			"absence_entry",
			"time_entry",
			"travel_expense_claim",
		]);
		expect(SUPPORTED_APPROVAL_INBOX_TYPES).not.toContain("shift_request");
	});

	it("allows a fully serializable inbox item", () => {
		const item: ApprovalInboxItem = {
			id: "approval-1",
			type: "absence_entry",
			entityId: "absence-1",
			status: "pending",
			requester: {
				id: "employee-1",
				name: "Avery Employee",
				email: "avery@example.com",
				image: null,
				teamId: "team-1",
			},
			summary: {
				title: "Vacation",
				subtitle: "May 31, 2026",
				detail: "1 day off",
				badge: { label: "Vacation", color: "#4f46e5" },
			},
			timing: {
				createdAt: "2026-05-31T09:00:00.000Z",
				resolvedAt: null,
				slaDeadline: null,
				ageDays: 0,
			},
			triage: {
				priority: "normal",
				riskLevel: "low",
				riskReasons: ["no_conflicts_detected"],
				fastLaneGroup: "low_risk_absence",
				isPayrollRelevant: false,
				explanation: "No conflicts detected.",
			},
			capabilities: {
				canApprove: true,
				canReject: true,
				canBulkApprove: true,
				requiresRejectReason: true,
			},
		};

		expect(JSON.parse(JSON.stringify(item))).toEqual(item);
	});
});
