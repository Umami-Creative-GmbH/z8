// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AbsenceApprovalsTable } from "./absence-approvals-table";
import { LegacyApprovalsWorkspace } from "./legacy-approvals-workspace";

const mocks = vi.hoisted(() => ({
	read: vi.fn(),
	approve: vi.fn(),
	reject: vi.fn(),
}));
const context = vi.hoisted(() => ({
	activeOrganizationId: "org-a",
	userId: "manager",
	isManagerOrAbove: true,
	isLoading: false,
	error: null,
	role: "manager",
	refetch: vi.fn(),
}));
vi.mock("@/hooks/use-organization", () => ({ useOrganization: () => context }));

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
}));
vi.mock("@/navigation", () => ({ Link: "a" }));
vi.mock("@/app/[locale]/(app)/approvals/actions", () => ({
	getPendingApprovals: mocks.read,
	approveAbsence: mocks.approve,
	rejectAbsence: mocks.reject,
}));
const rows = Array.from({ length: 12 }, (_, i) => ({
	id: `request-${i + 1}`,
	entityId: `absence-${i + 1}`,
	entityType: "absence_entry",
	status: "pending",
	createdAt: new Date("2026-05-01T00:00:00Z"),
	requester: {
		user: {
			id: `user-${i}`,
			name: `Person ${i + 1}`,
			email: `p${i}@example.test`,
			image: null,
		},
	},
	absence: {
		id: `absence-${i + 1}`,
		employeeId: `employee-${i}`,
		startDate: "2026-12-01",
		endDate: "2026-12-01",
		startPeriod: "full_day",
		endPeriod: "full_day",
		absenceDays: 1,
		notes: "Complete coverage evidence",
		sickNotes: null,
		sickDetail: null,
		deputy: null,
		category: { name: "Leave", type: "custom", color: null },
	},
}));
function mount() {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
	});
	render(
		<QueryClientProvider client={client}>
			<AbsenceApprovalsTable
				scope={{ userId: "manager", organizationId: "org-a" }}
			/>
		</QueryClientProvider>,
	);
	return client;
}
describe("legacy absence queue", () => {
	it("discards the old queue when organization changes during a read", async () => {
		let finish!: (value: unknown) => void;
		mocks.read.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					finish = resolve;
				}),
		);
		const client = new QueryClient({
			defaultOptions: { queries: { retry: false } },
		});
		const view = () => (
			<QueryClientProvider client={client}>
				<LegacyApprovalsWorkspace userId="manager" organizationId="org-a" />
			</QueryClientProvider>
		);
		const rendered = render(view());
		await waitFor(() => expect(mocks.read).toHaveBeenCalled());
		context.activeOrganizationId = "org-b";
		rendered.rerender(view());
		finish({ absenceApprovals: rows, timeCorrectionApprovals: [] });
		await screen.findByText("Checking your current approval access…");
		expect(screen.queryByText("Person 1")).toBeNull();
		context.activeOrganizationId = "org-a";
	});
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.read.mockResolvedValue({
			absenceApprovals: rows,
			timeCorrectionApprovals: [],
		});
		mocks.reject.mockResolvedValue({
			success: false,
			error: "The approver has changed",
		});
	});
	it("keeps refused requests and the entered reason available to retry", async () => {
		const user = userEvent.setup();
		mount();
		await user.click(
			(
				await screen.findAllByRole("button", { name: "Reject", exact: true })
			)[0],
		);
		const panel = screen.getByRole("dialog");
		await user.type(within(panel).getByRole("textbox"), "Coverage needed");
		await user.click(
			within(panel).getByRole("button", { name: "Reject", exact: true }),
		);
		await within(panel).findByText("The approver has changed");
		expect(
			(within(panel).getByRole("textbox") as HTMLTextAreaElement).value,
		).toBe("Coverage needed");
		expect(screen.getByText("Person 1")).toBeTruthy();
	});
	it("reaches the twelfth request and starts search at the first matching page", async () => {
		const user = userEvent.setup();
		mount();
		await screen.findByText("Person 1");
		await user.click(screen.getByRole("button", { name: "Go to next page" }));
		await screen.findByText("Person 12");
		await user.type(
			screen.getByRole("textbox", { name: "Search absence requests" }),
			"Person 1",
		);
		await waitFor(() => expect(screen.getByText("Person 1")).toBeTruthy());
	});
	it("retains cached rows and search after failed refresh, then retries the real reader", async () => {
		const user = userEvent.setup();
		mount();
		await screen.findByText("Person 1");
		const search = screen.getByRole("textbox", {
			name: "Search absence requests",
		});
		await user.type(search, "Person 1");
		mocks.read.mockRejectedValueOnce(new Error("Offline"));
		await user.click(screen.getByRole("button", { name: "Refresh" }));
		await screen.findByRole("button", { name: "Retry" });
		expect(screen.getByText("Person 1")).toBeTruthy();
		expect((search as HTMLInputElement).value).toBe("Person 1");
		await user.click(screen.getByRole("button", { name: "Retry" }));
		await waitFor(() =>
			expect(screen.queryByRole("button", { name: "Retry" })).toBeNull(),
		);
	});
});
