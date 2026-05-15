// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AbsenceApprovalsTable } from "./absence-approvals-table";

vi.mock("@/env", () => ({
	env: {
		BETTER_AUTH_SECRET: "test-secret-value-with-enough-length",
		NODE_ENV: "test",
	},
}));

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
}));

vi.mock("@/app/[locale]/(app)/approvals/actions", () => ({
	getPendingApprovals: vi.fn().mockResolvedValue({
		absenceApprovals: [
			{
				id: "approval-1",
				entityId: "absence-1",
				entityType: "absence_entry",
				status: "pending",
				createdAt: new Date("2026-05-01T00:00:00.000Z"),
				requester: {
					user: {
						id: "user-1",
						name: "Ada Lovelace",
						email: "ada@example.com",
						image: null,
					},
				},
				absence: {
					id: "absence-1",
					startDate: "2026-05-18",
					startPeriod: "full_day",
					endDate: "2026-05-18",
					endPeriod: "full_day",
					notes: null,
					sickDetail: "child_sick",
					category: { name: "Sick Leave", type: "sick", color: null },
				},
			},
			{
				id: "approval-2",
				entityId: "absence-2",
				entityType: "absence_entry",
				status: "pending",
				createdAt: new Date("2026-05-01T00:00:00.000Z"),
				requester: {
					user: {
						id: "user-2",
						name: "Grace Hopper",
						email: "grace@example.com",
						image: null,
					},
				},
				absence: {
					id: "absence-2",
					startDate: "2026-06-01",
					startPeriod: "full_day",
					endDate: "2026-06-01",
					endPeriod: "full_day",
					notes: null,
					sickDetail: "with_certificate",
					category: { name: "Vacation", type: "vacation", color: null },
				},
			},
		],
		timeCorrectionApprovals: [],
	}),
	approveAbsence: vi.fn(),
	rejectAbsence: vi.fn(),
}));

function renderTable() {
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
	});

	return render(
		<QueryClientProvider client={queryClient}>
			<AbsenceApprovalsTable />
		</QueryClientProvider>,
	);
}

describe("AbsenceApprovalsTable", () => {
	it("shows sick detail labels for sick absence approvals only", async () => {
		renderTable();

		expect(await screen.findByText("Child sick")).toBeTruthy();
		expect(screen.queryByText("With certificate")).toBeNull();
	});
});
