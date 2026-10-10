// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { AbsenceApprovalsTable } from "./absence-approvals-table";

vi.mock("@/env", () => ({
	env: {
		BETTER_AUTH_SECRET: "test-secret-value-with-enough-length",
		SCIM_CREDENTIAL_HASH_SECRET: "test-scim-credential-hash-secret-value",
		NODE_ENV: "test",
	},
}));

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
}));

vi.mock("@/navigation", () => ({
	Link: ({
		href,
		children,
		className,
	}: {
		href: string;
		children: ReactNode;
		className?: string;
	}) => (
		<a href={href} className={className}>
			{children}
		</a>
	),
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
					employeeId: "employee-1",
					startDate: "2026-05-18",
					startPeriod: "full_day",
					endDate: "2026-05-18",
					endPeriod: "full_day",
					notes: null,
					sickDetail: "child_sick",
					sickNotes: { count: 2, viewable: false },
					category: { name: "Sick Leave", type: "sick", color: null },
				},
			},
			{
				id: "approval-3",
				entityId: "absence-3",
				entityType: "absence_entry",
				status: "pending",
				createdAt: new Date("2026-05-01T00:00:00.000Z"),
				requester: {
					user: {
						id: "user-3",
						name: "Katherine Johnson",
						email: "katherine@example.com",
						image: null,
					},
				},
				absence: {
					id: "absence-3",
					employeeId: "employee-3",
					startDate: "2026-05-19",
					startPeriod: "full_day",
					endDate: "2026-05-19",
					endPeriod: "full_day",
					notes: null,
					sickDetail: "other",
					sickNotes: { count: 1, viewable: true },
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
					employeeId: "employee-2",
					startDate: "2026-06-01",
					startPeriod: "full_day",
					endDate: "2026-06-01",
					endPeriod: "full_day",
					notes: null,
					sickDetail: "with_certificate",
					sickNotes: null,
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

	it("shows that sick notes are attached, linking only for approvers who may open them (#982)", async () => {
		renderTable();

		const markers = await screen.findAllByText("Sick note attached ({count})");
		expect(markers).toHaveLength(2);
		// A manager without personnel file access sees the marker only.
		expect(markers[0]?.closest("a")).toBeNull();
		expect(markers[1]?.closest("a")?.getAttribute("href")).toBe(
			"/personnel-files/employee-3?category=sick_note",
		);
	});
});
