/* @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import { TolgeeProvider } from "@tolgee/react";
import { describe, expect, it, vi } from "vitest";
import { AbsenceRequestHandler } from "@/lib/approvals/handlers/absence-request.handler";
import type { ApprovalInboxItem } from "@/lib/approvals/inbox/types";
import { createTestTolgee } from "@/test/render-with-translations";
import { ApprovalInboxTable } from "./approval-inbox-table";

vi.mock("next-intl", () => ({ useLocale: () => "de" }));
vi.mock("@/components/user-avatar", () => ({
	UserAvatar: ({ name }: { name: string }) => <span>{name}</span>,
}));
vi.mock("@/lib/query", () => ({
	useEmployeeClockStatuses: () => ({ getStatus: () => null }),
}));

/** A legacy absence request's inbox row, its summary exactly as the handler sends it (#1978). */
function legacyAbsenceRow(): ApprovalInboxItem {
	const display = AbsenceRequestHandler.getDisplayMetadata({
		id: "absence-1",
		startDate: "2026-06-01",
		startPeriod: "full_day",
		endDate: "2026-06-04",
		endPeriod: "full_day",
		notes: null,
		sickDetail: null,
		status: "pending",
		createdAt: new Date("2026-05-01T00:00:00.000Z"),
		absenceDays: 4,
		employee: {
			id: "employee-1",
			userId: "user-1",
			teamId: null,
			organizationId: "org-1",
			user: { id: "user-1", name: "Ada Lovelace", email: "ada@example.com", image: null },
		},
		category: { id: "category-1", name: "Urlaub", type: "vacation", color: null },
	});
	return {
		id: "approval-1",
		type: "absence_entry",
		entityId: "absence-1",
		status: "pending",
		requester: {
			id: "employee-1",
			name: "Ada Lovelace",
			email: "ada@example.com",
			image: null,
			teamId: null,
		},
		summary: {
			title: display.title,
			subtitle: display.subtitle,
			detail: display.summary,
			badge: null,
			...(display.localized
				? {
						localized: {
							title: display.localized.title,
							subtitle: display.localized.subtitle,
							detail: display.localized.summary,
						},
					}
				: {}),
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
			fastLaneGroup: null,
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

describe("a legacy absence request in the inbox table, in German (#1978)", () => {
	it("renders its summary in the viewer's language and date format", () => {
		const tolgee = createTestTolgee("de", {
			"approvals:approvals.absenceRequest.summary":
				"{days, plural, one {# Tag} other {# Tage}} frei – {range}",
		});

		render(
			<TolgeeProvider tolgee={tolgee}>
				<ApprovalInboxTable
					items={[legacyAbsenceRow()]}
					selectedIds={new Set()}
					onSelectItem={vi.fn()}
					onRowClick={vi.fn()}
					isFetching={false}
				/>
			</TolgeeProvider>,
		);

		expect(screen.getByText("Urlaub")).toBeTruthy();
		expect(screen.getByText("4 Tage frei – 01.06.2026 – 04.06.2026")).toBeTruthy();
		expect(screen.queryByText(/days off/)).toBeNull();
	});
});
