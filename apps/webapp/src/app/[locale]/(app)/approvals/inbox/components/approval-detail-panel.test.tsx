// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { UnifiedApprovalItem } from "@/lib/approvals/domain/types";
import { ApprovalDetailPanel, normalizeTravelExpenseDetailEntity } from "./approval-detail-panel";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
}));

vi.mock("sonner", () => ({
	toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/lib/query/use-approval-inbox", () => ({
	useApprovalDetail: () => ({
		data: {
			entity: {
				sickDetail: "child_sick",
				category: { type: "sick" },
			},
			timeline: [],
		},
	}),
	useApproveApproval: () => ({ isPending: false, mutateAsync: vi.fn() }),
	useRejectApproval: () => ({ isPending: false, mutateAsync: vi.fn() }),
}));

vi.mock("@/lib/query", () => ({
	useEmployeeClockStatuses: () => ({ getStatus: () => null }),
}));

const sickApproval: UnifiedApprovalItem = {
	id: "approval-1",
	approvalType: "absence_entry",
	entityId: "absence-1",
	typeName: "Absence Request",
	requester: {
		id: "employee-1",
		userId: "user-1",
		name: "Ada Lovelace",
		email: "ada@example.com",
		image: null,
		teamId: null,
	},
	approverId: "manager-1",
	organizationId: "org-1",
	status: "pending",
	createdAt: new Date("2026-05-01T00:00:00.000Z"),
	resolvedAt: null,
	priority: "normal",
	sla: { deadline: null, status: "on_time", hoursRemaining: null },
	display: {
		title: "Sick Leave",
		subtitle: "May 18, 2026",
		summary: "Sick Leave, May 18, 2026",
		badge: { label: "Sick Leave", color: null },
	},
};

describe("normalizeTravelExpenseDetailEntity", () => {
	it("converts serialized trip dates into Date objects", () => {
		const normalized = normalizeTravelExpenseDetailEntity({
			tripStart: "2026-04-15T00:00:00.000Z",
			tripEnd: "2026-04-17T00:00:00.000Z",
			destinationCity: "Berlin",
			calculatedCurrency: "EUR",
			calculatedAmount: "120.50",
			notes: "Client visit",
		});

		expect(normalized.tripStart).toBeInstanceOf(Date);
		expect(normalized.tripEnd).toBeInstanceOf(Date);
		expect(normalized.tripStart.toISOString()).toBe("2026-04-15T00:00:00.000Z");
		expect(normalized.tripEnd.toISOString()).toBe("2026-04-17T00:00:00.000Z");
	});
});

describe("ApprovalDetailPanel", () => {
	it("shows sick detail for sick absence approvals", async () => {
		render(
			<ApprovalDetailPanel
				approval={sickApproval}
				open={true}
				onOpenChange={vi.fn()}
				onActioned={vi.fn()}
			/>,
		);

		expect(await screen.findByText("Sick detail")).toBeTruthy();
		expect(screen.getByText("Child sick")).toBeTruthy();
	});
});
