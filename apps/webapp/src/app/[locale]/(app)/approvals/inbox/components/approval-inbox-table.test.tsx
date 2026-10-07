/* @vitest-environment jsdom */

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ApprovalInboxItem } from "@/lib/approvals/inbox/types";
import { ApprovalInboxTable } from "./approval-inbox-table";

vi.mock("next-intl", () => ({ useLocale: () => "en" }));

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback?: string, values?: Record<string, unknown>) =>
			(fallback ?? _key).replace(/\{(\w+)\}/g, (match, name: string) =>
				values?.[name] === undefined ? match : String(values[name]),
			),
	}),
}));

vi.mock("@/components/ui/checkbox", () => ({
	Checkbox: ({
		checked,
		onCheckedChange,
		...props
	}: React.InputHTMLAttributes<HTMLInputElement> & {
		onCheckedChange?: (checked: boolean) => void;
	}) => (
		<input
			type="checkbox"
			checked={!!checked}
			onChange={(event) => onCheckedChange?.(event.target.checked)}
			{...props}
		/>
	),
}));

vi.mock("@/components/ui/badge", () => ({
	Badge: ({ children }: { children: React.ReactNode }) => (
		<span>{children}</span>
	),
}));

vi.mock("@/components/user-avatar", () => ({
	UserAvatar: ({ name }: { name: string }) => <span>{name}</span>,
}));

vi.mock("@/lib/query", () => ({
	useEmployeeClockStatuses: () => ({
		getStatus: () => null,
	}),
}));

function makeApprovalInboxItem(): ApprovalInboxItem {
	return {
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
			title: "Vacation request",
			subtitle: "Jun 3-4",
			detail: "2 days away",
			badge: null,
		},
		timing: {
			createdAt: "2026-05-30T08:00:00.000Z",
			resolvedAt: null,
			slaDeadline: null,
			ageDays: 1,
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
}

describe("ApprovalInboxTable", () => {
	it("keeps selection and details as separate controls", () => {
		const item = makeApprovalInboxItem();
		const onSelectItem = vi.fn();
		const onRowClick = vi.fn();

		render(
			<ApprovalInboxTable
				items={[item]}
				selectedIds={new Set()}
				onSelectItem={onSelectItem}
				onRowClick={onRowClick}
				isFetching={false}
			/>,
		);

		const checkbox = screen.getByRole("checkbox", { name: "Select row" });
		const detailsButton = screen.getByRole("button", {
			name: /Open details for Vacation request/,
		});

		fireEvent.click(checkbox);
		expect(onSelectItem).toHaveBeenCalledWith("approval-1", true);
		expect(onRowClick).not.toHaveBeenCalled();

		fireEvent.click(detailsButton);
		expect(onRowClick).toHaveBeenCalledWith(item);
		expect(onSelectItem).toHaveBeenCalledTimes(1);
	});

	it("does not let the viewer select their own request and says who decides it (#686)", () => {
		const own: ApprovalInboxItem = {
			...makeApprovalInboxItem(),
			capabilities: {
				canApprove: false,
				canReject: false,
				canBulkApprove: false,
				requiresRejectReason: true,
				ownRequest: true,
			},
		};

		render(
			<ApprovalInboxTable
				items={[own]}
				selectedIds={new Set()}
				onSelectItem={vi.fn()}
				onRowClick={vi.fn()}
				isFetching={false}
			/>,
		);

		expect(
			(screen.getByRole("checkbox", { name: "Select row" }) as HTMLInputElement).disabled,
		).toBe(true);
		expect(screen.getByText("Your own request: another approver decides it.")).toBeTruthy();
	});
});
