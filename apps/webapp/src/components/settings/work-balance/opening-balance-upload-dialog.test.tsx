// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { OpeningBalanceUploadDialog } from "./opening-balance-upload-dialog";

const harness = vi.hoisted(() => ({
	preview: vi.fn(),
	commit: vi.fn(),
	invalidate: vi.fn(),
	error: vi.fn(),
	success: vi.fn(),
	scope: { userId: "actor", activeOrganizationId: "A" },
}));
vi.mock("@/components/providers/organization-context-provider", () => ({
	useOrganization: () => harness.scope,
}));
vi.mock("@tanstack/react-query", () => ({
	useQueryClient: () => ({ invalidateQueries: harness.invalidate }),
}));
vi.mock("@/app/[locale]/(app)/settings/employees/opening-balance-upload-actions", () => ({
	previewOpeningBalanceUploadAction: harness.preview,
	commitOpeningBalanceUploadAction: harness.commit,
}));
vi.mock("./use-employee-work-balance", () => ({ EMPLOYEE_WORK_BALANCE_QUERY_KEY: ["balance"] }));
vi.mock("@/hooks/use-display-context", () => ({
	useDisplayContext: () => ({ locale: "en-GB", timezone: "UTC" }),
}));
vi.mock("sonner", () => ({ toast: { error: harness.error, success: harness.success } }));
vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
	useTolgee: () => ({ getLanguage: () => "en" }),
}));
const row = {
	row: 2,
	employeeNumber: "EMP-1",
	employee: { id: "employee", name: "Covered former employee", isActive: false },
	day: "2026-03-31",
	minutes: 150,
	reason: "Carry forward",
	errors: [],
	replaces: { day: "2026-02-28", minutes: 60 },
};
const ready = { success: true, data: { status: "ready", rows: [row] } };
function file(read: () => Promise<string>) {
	const f = new File(["csv"], "balances.csv", { type: "text/csv" });
	Object.defineProperty(f, "text", { value: read });
	return f;
}
async function open() {
	const user = userEvent.setup();
	await user.click(screen.getByRole("button", { name: "Upload opening balances" }));
	return user;
}
beforeEach(() => {
	vi.clearAllMocks();
	harness.scope = { userId: "actor", activeOrganizationId: "A" };
	harness.preview.mockResolvedValue(ready);
	harness.commit.mockResolvedValue({ success: false, refusal: "not_permitted" });
});

it("locks selection before file reading, prevents duplicates and keeps pending dismissal blocked", async () => {
	let resolve!: (text: string) => void;
	const read = vi.fn(
		() =>
			new Promise<string>((r) => {
				resolve = r;
			}),
	);
	render(<OpeningBalanceUploadDialog />);
	const user = await open();
	fireEvent.change(screen.getByLabelText("CSV file"), { target: { files: [file(read)] } });
	expect((screen.getByLabelText("CSV file") as HTMLInputElement).disabled).toBe(true);
	fireEvent.change(screen.getByLabelText("CSV file"), { target: { files: [file(read)] } });
	expect(read).toHaveBeenCalledTimes(1);
	await user.keyboard("{Escape}");
	expect(screen.getByRole("dialog")).toBeTruthy();
	await act(async () =>
		resolve("employee_number,day,balance,reason\nEMP-1,2026-03-31,2:30,Carry forward"),
	);
	await screen.findByText("Covered former employee");
	expect(harness.preview).toHaveBeenCalledTimes(1);
});

it("retains a failed preview for inline retry, and blocks native duplicate commits with recoverable input", async () => {
	harness.preview.mockRejectedValueOnce(Error("transport detail must stay private"));
	render(<OpeningBalanceUploadDialog />);
	const user = await open();
	fireEvent.change(screen.getByLabelText("CSV file"), {
		target: { files: [file(async () => "CSV")] },
	});
	await user.click(await screen.findByRole("button", { name: "Retry" }));
	await screen.findByText("Covered former employee");
	expect(screen.getByText("Former employee")).toBeTruthy();
	expect(screen.getByText(/Replaces the opening balance/)).toBeTruthy();
	let resolve!: (value: unknown) => void;
	harness.commit.mockImplementation(
		() =>
			new Promise((r) => {
				resolve = r;
			}),
	);
	const form = screen.getByLabelText("CSV file").closest("form");
	expect(form).toBeTruthy();
	fireEvent.submit(form as HTMLFormElement);
	fireEvent.submit(form as HTMLFormElement);
	await waitFor(() => expect(harness.commit).toHaveBeenCalledTimes(1));
	await act(async () => resolve({ success: false, refusal: "not_permitted" }));
	expect(await screen.findByRole("alert")).toBeTruthy();
	expect(screen.getByText("Covered former employee")).toBeTruthy();
	expect(harness.invalidate).not.toHaveBeenCalled();
});

it("discards A's pending draft across A to B to A and ignores its late result", async () => {
	let resolve!: (value: unknown) => void;
	harness.preview.mockImplementation(
		() =>
			new Promise((r) => {
				resolve = r;
			}),
	);
	const view = render(<OpeningBalanceUploadDialog />);
	await open();
	fireEvent.change(screen.getByLabelText("CSV file"), {
		target: { files: [file(async () => "CSV-A")] },
	});
	await waitFor(() => expect(harness.preview).toHaveBeenCalledTimes(1));
	harness.scope = { userId: "actor", activeOrganizationId: "B" };
	view.rerender(<OpeningBalanceUploadDialog />);
	expect(screen.queryByRole("dialog")).toBeNull();
	harness.scope = { userId: "actor", activeOrganizationId: "A" };
	view.rerender(<OpeningBalanceUploadDialog />);
	await open();
	await act(async () => resolve(ready));
	expect(screen.queryByText("Covered former employee")).toBeNull();
	expect(harness.success).not.toHaveBeenCalled();
});

it("does not announce or invalidate a late successful commit after the actor changes", async () => {
	let resolve!: (value: unknown) => void;
	harness.commit.mockImplementation(
		() =>
			new Promise((r) => {
				resolve = r;
			}),
	);
	const view = render(<OpeningBalanceUploadDialog />);
	await open();
	fireEvent.change(screen.getByLabelText("CSV file"), {
		target: { files: [file(async () => "CSV-A")] },
	});
	await screen.findByText("Covered former employee");
	fireEvent.submit(screen.getByLabelText("CSV file").closest("form") as HTMLFormElement);
	await waitFor(() => expect(harness.commit).toHaveBeenCalledTimes(1));
	harness.scope = { userId: "new-actor", activeOrganizationId: "A" };
	view.rerender(<OpeningBalanceUploadDialog />);
	await act(async () =>
		resolve({ success: true, data: { status: "committed", rows: [row], created: 1 } }),
	);
	expect(harness.success).not.toHaveBeenCalled();
	expect(harness.invalidate).not.toHaveBeenCalled();
	expect(screen.queryByRole("dialog")).toBeNull();
});
