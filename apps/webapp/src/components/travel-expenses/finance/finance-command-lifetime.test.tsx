// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Activity } from "react";
import { flushSync } from "react-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ConfirmPayrollRunButton } from "./confirm-payroll-run-dialog";
import { PayrollRunNotice } from "./payroll-run-notice";
import { PayrollRunsToConfirm } from "./payroll-runs-to-confirm";
import { RecordReimbursementForm } from "./record-reimbursement-form";

const boundary = vi.hoisted(() => ({
	actor: "a",
	org: "org",
	pending: false,
	record: vi.fn(),
	confirm: vi.fn(),
	remove: vi.fn(),
	getRuns: vi.fn(),
	success: vi.fn(),
}));
vi.mock("@/lib/auth-client", () => ({
	useSession: () => ({
		isPending: boundary.pending,
		data: { user: { id: boundary.actor }, session: { activeOrganizationId: boundary.org } },
	}),
}));
vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string, values?: Record<string, unknown>) =>
			fallback.replace(/\{(\w+)\}/g, (_all, name: string) => String(values?.[name] ?? "")),
	}),
}));
vi.mock("next-intl", () => ({ useLocale: () => "en-US" }));
vi.mock("sonner", () => ({ toast: { success: boundary.success, info: vi.fn() } }));
vi.mock("@/app/[locale]/(app)/travel-expenses/finance-actions", () => ({
	recordTravelExpenseReimbursementAction: boundary.record,
	confirmPayrollRunAction: boundary.confirm,
	removeTravelExpenseFromPayrollRunAction: boundary.remove,
	getPayrollRunsToConfirmAction: boundary.getRuns,
}));
vi.mock("@/app/[locale]/(app)/travel-expenses/finance-recovery-actions", () => ({
	recordTravelExpenseRecoveryAction: boundary.record,
}));
vi.mock("@/components/ui/date-picker", () => ({
	DatePicker: ({
		value,
		onChange,
		...props
	}: {
		value: string;
		onChange: (value: string) => void;
	}) => <input {...props} value={value} onChange={(e) => onChange(e.target.value)} />,
}));

const line = {
	currency: "EUR",
	entitlement: "90.00",
	reimbursed: "0.00",
	recovered: "0.00",
	balance: "90.00",
	state: "outstanding" as const,
};
const settled = vi.fn();
const form = (source = "a") => (
	<RecordReimbursementForm
		source={{ type: "report", id: source }}
		line={line}
		onSettled={settled}
	/>
);
function fill() {
	fireEvent.change(screen.getByLabelText("Amount paid (EUR)"), { target: { value: "20.50" } });
	fireEvent.change(screen.getByLabelText("Payment date"), { target: { value: "2026-10-01" } });
	fireEvent.change(screen.getByLabelText("Payment reference"), {
		target: { value: "Exact reference" },
	});
}
const submit = () => fireEvent.submit(screen.getByRole("form", { name: "Record a reimbursement" }));
beforeEach(() => {
	vi.resetAllMocks();
	boundary.actor = "a";
	boundary.org = "org";
	boundary.pending = false;
	boundary.record.mockResolvedValue({ success: false, error: "Refused" });
});
afterEach(cleanup);

it("keeps the loaded payroll confirmation draft and a reachable local retry when its parent read fails", async () => {
	const run = {
		jobId: "run",
		formatId: "datev",
		formatName: "DATEV",
		periodStart: "2026-10-01",
		periodEnd: "2026-10-31",
		defaultPayday: "2026-10-31",
		confirmableReports: 1,
		confirmableAmount: "75.00",
	};
	boundary.getRuns
		.mockResolvedValueOnce({ success: true, data: [run] })
		.mockResolvedValueOnce({ success: false, error: "Unavailable" })
		.mockResolvedValue({ success: true, data: [run] });
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	render(
		<QueryClientProvider client={client}>
			<PayrollRunsToConfirm />
		</QueryClientProvider>,
	);
	fireEvent.click(await screen.findByRole("button", { name: "Confirm as paid" }));
	fireEvent.change(screen.getByLabelText(/Payday/), { target: { value: "2026-10-30" } });
	await act(async () => {
		await client.invalidateQueries({ queryKey: ["travel-expenses", "payroll-runs"] });
	});
	expect(screen.queryByRole("dialog")).not.toBeNull();
	await screen.findByRole("alert");
	expect((screen.getByLabelText(/Payday/) as HTMLInputElement).value).toBe("2026-10-30");
	expect(screen.getByRole("button", { name: "Confirm as paid" }).hasAttribute("disabled")).toBe(
		true,
	);
	fireEvent.click(screen.getByRole("button", { name: "Retry" }));
	await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
	expect((screen.getByLabelText(/Payday/) as HTMLInputElement).value).toBe("2026-10-30");
});

it("keeps payroll removal pending and retryable after refusal, publishing only a completed removal", async () => {
	let finish!: (value: unknown) => void;
	boundary.remove
		.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					finish = resolve;
				}),
		)
		.mockResolvedValue({ success: true, data: { status: "removed" } });
	const removed = vi.fn();
	render(
		<PayrollRunNotice
			reportId="report"
			run={{
				jobId: "run",
				formatId: "datev",
				formatName: "DATEV",
				periodStart: "2026-10-01",
				periodEnd: "2026-10-31",
				includedAt: "2026-10-31T10:00:00Z",
				partlyConfirmed: false,
			}}
			canRemove
			onRemoved={removed}
		/>,
	);
	fireEvent.click(screen.getByRole("button", { name: "Remove from payroll run" }));
	const submit = () => screen.getAllByRole("button", { name: "Remove from payroll run" }).at(-1)!;
	fireEvent.click(submit());
	fireEvent.click(submit());
	await waitFor(() => expect(boundary.remove).toHaveBeenCalledOnce());
	fireEvent.keyDown(screen.getByRole("alertdialog"), { key: "Escape", code: "Escape" });
	expect(screen.getByRole("alertdialog")).toBeTruthy();
	await act(async () => finish({ success: false, error: "Refused" }));
	expect(await screen.findByRole("alert")).toBeTruthy();
	expect(removed).not.toHaveBeenCalled();
	fireEvent.click(submit());
	await waitFor(() => expect(removed).toHaveBeenCalledOnce());
	expect(screen.queryByRole("alertdialog")).toBeNull();
});

it.each(["Activity", "account", "actor", "organization"] as const)(
	"retires queued TanStack payment validation after %s changes, including return",
	async (change) => {
		let source = "a";
		const page = (mode: "visible" | "hidden" = "visible") => (
			<Activity mode={mode}>{form(source)}</Activity>
		);
		const view = render(page());
		fill();
		act(() => {
			submit();
			expect(boundary.record).not.toHaveBeenCalled();
			if (change === "Activity") {
				flushSync(() => view.rerender(page("hidden")));
				flushSync(() => view.rerender(page()));
			} else {
				if (change === "account") source = "b";
				if (change === "actor") boundary.actor = "b";
				if (change === "organization") boundary.org = "b";
				flushSync(() => view.rerender(page()));
				source = "a";
				boundary.actor = "a";
				boundary.org = "org";
				flushSync(() => view.rerender(page()));
			}
		});
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 30));
		});
		expect(boundary.record).not.toHaveBeenCalled();
		expect(settled).not.toHaveBeenCalled();
		expect((screen.getByLabelText("Payment reference") as HTMLInputElement).value).toBe(
			"Exact reference",
		);
		submit();
		await waitFor(() => expect(boundary.record).toHaveBeenCalledOnce());
	},
);

it("keeps an unchanged pending session continuation and rejects native duplicate payments", async () => {
	let finish!: (value: unknown) => void;
	boundary.record.mockImplementation(
		() =>
			new Promise((resolve) => {
				finish = resolve;
			}),
	);
	const view = render(form());
	fill();
	submit();
	await waitFor(() => expect(boundary.record).toHaveBeenCalledOnce());
	boundary.pending = true;
	view.rerender(form());
	submit();
	expect(boundary.record).toHaveBeenCalledOnce();
	await act(async () =>
		finish({ success: true, data: { status: "recorded", replayed: false, account: null } }),
	);
	expect(boundary.success).toHaveBeenCalledOnce();
	expect(settled).toHaveBeenCalledOnce();
});

it("does not publish a late payment response into another account", async () => {
	let finish!: (value: unknown) => void;
	boundary.record.mockImplementation(
		() =>
			new Promise((resolve) => {
				finish = resolve;
			}),
	);
	const view = render(form());
	fill();
	submit();
	await waitFor(() => expect(boundary.record).toHaveBeenCalledOnce());
	view.rerender(form("b"));
	await act(async () =>
		finish({ success: true, data: { status: "recorded", replayed: false, account: null } }),
	);
	expect(boundary.success).not.toHaveBeenCalled();
	expect(settled).not.toHaveBeenCalled();
});

it("keeps payroll confirmation pending through Escape and transport failure with its payday", async () => {
	let finish!: (value: unknown) => void;
	boundary.confirm.mockImplementation(
		() =>
			new Promise((resolve) => {
				finish = resolve;
			}),
	);
	render(
		<ConfirmPayrollRunButton
			run={{
				jobId: "run",
				formatName: "DATEV",
				periodStart: "2026-10-01",
				periodEnd: "2026-10-31",
				defaultPayday: "2026-10-31",
			}}
			onConfirmed={vi.fn()}
			defaultOpen
		/>,
	);
	const dialog = screen.getByRole("dialog");
	const node = dialog.querySelector("form");
	if (!node) throw new Error("Missing payroll form");
	fireEvent.submit(node);
	await waitFor(() => expect(boundary.confirm).toHaveBeenCalledOnce());
	fireEvent.submit(node);
	fireEvent.keyDown(dialog, { key: "Escape", code: "Escape" });
	expect(screen.getByRole("dialog")).toBeTruthy();
	expect(boundary.confirm).toHaveBeenCalledOnce();
	await act(async () => finish({ success: false, error: "Unavailable" }));
	expect(await screen.findByText(/The payroll run could not be confirmed/)).toBeTruthy();
	expect((screen.getByLabelText(/Payday/) as HTMLInputElement).value).toBe("2026-10-31");
});
