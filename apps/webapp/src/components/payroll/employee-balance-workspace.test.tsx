// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { Activity } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { EmployeeBalanceWorkspace } from "./employee-balance-workspace";

const mocks = vi.hoisted(() => ({
	read: vi.fn(),
	opening: vi.fn(),
	payout: vi.fn(),
	cancel: vi.fn(),
	saved: vi.fn(),
	scope: { userId: "holder", activeOrganizationId: "org", isLoading: false },
}));
vi.mock("sonner", () => ({ toast: { success: mocks.saved, error: vi.fn() } }));
vi.mock("@/app/[locale]/(app)/settings/employees/work-balance-actions", () => ({
	getEmployeeWorkBalanceSectionAction: mocks.read,
	setOpeningBalanceAction: mocks.opening,
	recordOvertimePayoutAction: mocks.payout,
	cancelBalanceAdjustmentAction: mocks.cancel,
}));
vi.mock("@/app/[locale]/(app)/payroll/work-balances/[employeeId]/actions", () => ({
	getPayrollEmployeeBalanceAction: mocks.read,
}));
vi.mock("@/hooks/use-organization", () => ({ useOrganization: () => mocks.scope }));
vi.mock("@tolgee/react", () => ({
	useTolgee: () => ({ getLanguage: () => "en" }),
	useTranslate: () => ({
		t: (_key: string, fallback: string, values?: Record<string, unknown>) =>
			fallback.replace(/\{(\w+)\}/g, (_, key: string) => String(values?.[key] ?? key)),
	}),
}));
vi.mock("@/hooks/use-display-context", () => ({
	useDisplayContext: () => ({ locale: "en", timezone: "UTC" }),
}));
vi.mock("@/navigation", () => ({ Link: (props: React.ComponentProps<"a">) => <a {...props} /> }));

const employee = {
	id: "employee",
	name: "Covered former employee",
	employeeNumber: "0044",
	isActive: false,
};
const record = {
	id: "opening",
	kind: "opening_balance",
	day: "2026-11-01",
	minutes: 600,
	reason: "Imported balance evidence",
	recordedAt: "2026-11-01T10:00:00Z",
	recordedBy: { userId: "holder", name: "Payroll holder" },
	cancellation: null,
};
const data = {
	balance: null,
	adjustments: [record],
	today: "2026-11-15",
	timezone: "Europe/Berlin",
	canManage: true,
};
function mount() {
	const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
	return {
		client,
		...render(
			<QueryClientProvider client={client}>
				<EmployeeBalanceWorkspace employee={employee} organizationId="org" userId="holder" />
			</QueryClientProvider>,
		),
	};
}
afterEach(() => {
	cleanup();
	vi.clearAllMocks();
	mocks.scope = { userId: "holder", activeOrganizationId: "org", isLoading: false };
});

it("keeps unavailable projection distinct from zero and retains full ledger on failed refresh with retry", async () => {
	mocks.read.mockResolvedValueOnce({ success: true, data });
	const view = mount();
	await screen.findByText("Imported balance evidence");
	expect(screen.getByRole("heading", { level: 1 }).textContent).toContain(employee.name);
	expect(screen.getByText("Former employee")).toBeTruthy();
	expect(screen.getByText("Not calculated yet")).toBeTruthy();
	mocks.read.mockResolvedValueOnce({
		success: false,
		code: "DatabaseError",
		error: "private diagnostic",
	});
	fireEvent.click(screen.getByRole("button", { name: "Refresh work balance" }));
	await screen.findByRole("alert");
	expect(screen.getByText("Imported balance evidence")).toBeTruthy();
	expect(screen.queryByText("private diagnostic")).toBeNull();
	expect(screen.getByRole("button", { name: "Set opening balance" }).hasAttribute("disabled")).toBe(
		true,
	);
	mocks.read.mockResolvedValueOnce({ success: true, data: { ...data, adjustments: [] } });
	fireEvent.click(screen.getByRole("button", { name: "Retry work balance" }));
	await screen.findByText("No balance adjustments yet.");
	expect(screen.queryByRole("alert")).toBeNull();
	view.client.clear();
});

it("submits the reasoned opening replacement once, blocks pending dismissal and retains refused draft", async () => {
	mocks.read.mockResolvedValue({ success: true, data });
	let finish!: (value: unknown) => void;
	mocks.opening.mockImplementation(
		() =>
			new Promise((resolve) => {
				finish = resolve;
			}),
	);
	mount();
	fireEvent.click(await screen.findByRole("button", { name: "Set opening balance" }));
	const panel = await screen.findByRole("dialog");
	expect(
		within(panel).getByText("The opening balance in effect is cancelled, with this reason."),
	).toBeTruthy();
	fireEvent.change(within(panel).getByRole("spinbutton", { name: /^Hours/ }), {
		target: { value: "5" },
	});
	fireEvent.change(within(panel).getByRole("textbox", { name: /^Reason/ }), {
		target: { value: "Verified replacement" },
	});
	const form = panel.querySelector("form");
	if (!form) throw Error("Missing opening form");
	fireEvent.submit(form);
	fireEvent.submit(form);
	await waitFor(() => expect(mocks.opening).toHaveBeenCalledTimes(1));
	expect(mocks.opening).toHaveBeenCalledWith({
		employeeId: "employee",
		day: "2026-11-15",
		negative: false,
		hours: 5,
		minutes: 0,
		reason: "Verified replacement",
	});
	fireEvent.click(within(panel).getByRole("button", { name: "Cancel" }));
	expect(screen.getByRole("dialog")).toBeTruthy();
	await act(async () =>
		finish({
			success: false,
			code: "ValidationError",
			refusal: "conflicting_payouts",
			error: "diagnostic",
			details: { conflictingPayouts: [{ id: "later", day: "2026-11-14", minutes: -60 }] },
		}),
	);
	await screen.findByText("Overtime payouts on or before this day");
	expect((screen.getByRole("textbox", { name: /^Reason/ }) as HTMLTextAreaElement).value).toBe(
		"Verified replacement",
	);
	expect(screen.queryByText("diagnostic")).toBeNull();
});

it("hides retained private records on permission refusal and keeps zero as an actual projection", async () => {
	mocks.read.mockResolvedValueOnce({
		success: true,
		data: { ...data, balance: { balanceMinutes: 0, computedThroughDate: "2026-11-14" } },
	});
	mount();
	await screen.findByText("0:00h");
	expect(screen.queryByText("Not calculated yet")).toBeNull();
	mocks.read.mockResolvedValueOnce({
		success: false,
		code: "AuthorizationError",
		error: "private",
	});
	fireEvent.click(screen.getByRole("button", { name: "Refresh work balance" }));
	await screen.findByRole("alert");
	expect(screen.queryByText("Imported balance evidence")).toBeNull();
	expect(screen.queryByRole("button", { name: "Set opening balance" })).toBeNull();
});

it.each(["organization", "account"])(
	"does not reuse an abandoned A response after %s A→B→A",
	async (kind) => {
		let finish!: (value: unknown) => void;
		mocks.read.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					finish = resolve;
				}),
		);
		const view = mount();
		await waitFor(() => expect(mocks.read).toHaveBeenCalledTimes(1));
		mocks.scope = {
			userId: kind === "account" ? "another-holder" : "holder",
			activeOrganizationId: kind === "organization" ? "foreign" : "org",
			isLoading: false,
		};
		const route = () => (
			<QueryClientProvider client={view.client}>
				<EmployeeBalanceWorkspace employee={employee} organizationId="org" userId="holder" />
			</QueryClientProvider>
		);
		view.rerender(route());
		mocks.read.mockResolvedValueOnce({ success: true, data: { ...data, adjustments: [] } });
		mocks.scope = { userId: "holder", activeOrganizationId: "org", isLoading: false };
		view.rerender(route());
		await screen.findByText("No balance adjustments yet.");
		await act(async () => finish({ success: true, data }));
		expect(screen.queryByText("Imported balance evidence")).toBeNull();
	},
);

it("discards a late read across Activity hide/reveal", async () => {
	let finish!: (value: unknown) => void;
	mocks.read.mockImplementationOnce(
		() =>
			new Promise((resolve) => {
				finish = resolve;
			}),
	);
	const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
	const route = (mode: "visible" | "hidden") => (
		<QueryClientProvider client={client}>
			<Activity mode={mode}>
				<EmployeeBalanceWorkspace employee={employee} organizationId="org" userId="holder" />
			</Activity>
		</QueryClientProvider>
	);
	const view = render(route("visible"));
	await waitFor(() => expect(mocks.read).toHaveBeenCalledTimes(1));
	view.rerender(route("hidden"));
	mocks.read.mockResolvedValueOnce({ success: true, data: { ...data, adjustments: [] } });
	await act(async () => finish({ success: true, data }));
	view.rerender(route("visible"));
	await screen.findByText("No balance adjustments yet.");
	expect(screen.queryByText("Imported balance evidence")).toBeNull();
	client.clear();
});

it("does not complete an abandoned payout panel into a new account arrival", async () => {
	mocks.read.mockResolvedValue({ success: true, data });
	let finish!: (value: unknown) => void;
	mocks.payout.mockImplementation(
		() =>
			new Promise((resolve) => {
				finish = resolve;
			}),
	);
	const view = mount();
	fireEvent.click(await screen.findByRole("button", { name: "Record overtime payout" }));
	const panel = await screen.findByRole("dialog");
	fireEvent.change(within(panel).getByRole("spinbutton", { name: /^Hours/ }), {
		target: { value: "1" },
	});
	fireEvent.change(within(panel).getByRole("textbox", { name: /^Reason/ }), {
		target: { value: "Abandoned wages record" },
	});
	const form = panel.querySelector("form");
	if (!form) throw Error("Missing payout form");
	fireEvent.submit(form);
	await waitFor(() => expect(mocks.payout).toHaveBeenCalledTimes(1));
	mocks.scope = { userId: "new-account", activeOrganizationId: "org", isLoading: false };
	const route = () => (
		<QueryClientProvider client={view.client}>
			<EmployeeBalanceWorkspace employee={employee} organizationId="org" userId="holder" />
		</QueryClientProvider>
	);
	view.rerender(route());
	await act(async () => finish({ success: true, data: { adjustmentId: "saved-for-old-account" } }));
	expect(mocks.saved).not.toHaveBeenCalled();
	expect(screen.queryByRole("dialog")).toBeNull();
});

it("keeps the authoritative read-only ledger without offering management commands", async () => {
	mocks.read.mockResolvedValue({ success: true, data: { ...data, canManage: false } });
	mount();
	await screen.findByText("Imported balance evidence");
	expect(screen.queryByRole("button", { name: "Set opening balance" })).toBeNull();
	expect(screen.queryByRole("button", { name: "Record overtime payout" })).toBeNull();
	expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
});
