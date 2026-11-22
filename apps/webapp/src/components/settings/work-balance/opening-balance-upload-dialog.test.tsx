// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Activity } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { OpeningBalanceUploadPanel } from "./opening-balance-upload-panel";

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
	harness.invalidate.mockResolvedValue(undefined);
});

it("unlocks a discarded preview that finishes while its cached view is hidden", async () => {
	let finish!: (value: unknown) => void;
	harness.preview.mockImplementation(
		() =>
			new Promise((resolve) => {
				finish = resolve;
			}),
	);
	const content = <OpeningBalanceUploadPanel />;
	const view = render(<Activity mode="visible">{content}</Activity>);
	await open();
	fireEvent.change(screen.getByLabelText("CSV file"), {
		target: { files: [file(async () => "CSV")] },
	});
	await waitFor(() => expect(harness.preview).toHaveBeenCalledTimes(1));
	view.rerender(<Activity mode="hidden">{content}</Activity>);
	await act(async () => finish(ready));
	view.rerender(<Activity mode="visible">{content}</Activity>);
	await waitFor(() =>
		expect((screen.getByLabelText("CSV file") as HTMLInputElement).disabled).toBe(false),
	);
	expect(screen.queryByText("Covered former employee")).toBeNull();
	await userEvent.setup().click(screen.getByRole("button", { name: "Cancel" }));
	await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
});

it("discards a preview from an earlier cached visit and accepts a fresh file after it settles", async () => {
	let finish!: (value: unknown) => void;
	harness.preview.mockImplementationOnce(
		() =>
			new Promise((resolve) => {
				finish = resolve;
			}),
	);
	const content = <OpeningBalanceUploadPanel />;
	const view = render(<Activity mode="visible">{content}</Activity>);
	await open();
	fireEvent.change(screen.getByLabelText("CSV file"), {
		target: { files: [file(async () => "OLD CSV")] },
	});
	await waitFor(() => expect(harness.preview).toHaveBeenCalledTimes(1));
	view.rerender(<Activity mode="hidden">{content}</Activity>);
	view.rerender(<Activity mode="visible">{content}</Activity>);
	expect((screen.getByLabelText("CSV file") as HTMLInputElement).disabled).toBe(true);
	fireEvent.change(screen.getByLabelText("CSV file"), {
		target: { files: [file(async () => "BLOCKED CSV")] },
	});
	expect(harness.preview).toHaveBeenCalledTimes(1);
	await act(async () => finish(ready));
	expect(screen.queryByText("Covered former employee")).toBeNull();
	expect((screen.getByLabelText("CSV file") as HTMLInputElement).disabled).toBe(false);
	fireEvent.change(screen.getByLabelText("CSV file"), {
		target: { files: [file(async () => "FRESH CSV")] },
	});
	await screen.findByText("Covered former employee");
	expect(harness.preview).toHaveBeenNthCalledWith(2, { csv: "FRESH CSV" });
});

it.each([false, true])(
	"requires a fresh preview after a commit crosses cached navigation (return before completion: %s)",
	async (returnBeforeCompletion) => {
		let finish!: (value: unknown) => void;
		const committed = {
			success: true,
			data: { status: "committed", rows: [row], created: 1 },
		};
		harness.commit
			.mockImplementationOnce(
				() =>
					new Promise((resolve) => {
						finish = resolve;
					}),
			)
			.mockResolvedValue(committed);
		const content = <OpeningBalanceUploadPanel />;
		const view = render(<Activity mode="visible">{content}</Activity>);
		await open();
		fireEvent.change(screen.getByLabelText("CSV file"), {
			target: { files: [file(async () => "OLD CSV")] },
		});
		await screen.findByText("Covered former employee");
		fireEvent.submit(screen.getByLabelText("CSV file").closest("form") as HTMLFormElement);
		await waitFor(() => expect(harness.commit).toHaveBeenCalledTimes(1));
		view.rerender(<Activity mode="hidden">{content}</Activity>);
		if (returnBeforeCompletion) {
			view.rerender(<Activity mode="visible">{content}</Activity>);
			expect((screen.getByLabelText("CSV file") as HTMLInputElement).disabled).toBe(true);
			fireEvent.submit(screen.getByLabelText("CSV file").closest("form") as HTMLFormElement);
			expect(harness.commit).toHaveBeenCalledTimes(1);
		}
		await act(async () => finish(committed));
		if (!returnBeforeCompletion) view.rerender(<Activity mode="visible">{content}</Activity>);
		expect(harness.success).not.toHaveBeenCalled();
		expect(harness.invalidate).not.toHaveBeenCalled();
		expect(screen.queryByText("Covered former employee")).toBeNull();
		expect((screen.getByLabelText("CSV file") as HTMLInputElement).disabled).toBe(false);
		expect(
			(screen.getByRole("button", { name: /Set.*opening balance/ }) as HTMLButtonElement).disabled,
		).toBe(true);
		fireEvent.change(screen.getByLabelText("CSV file"), {
			target: { files: [file(async () => "FRESH CSV")] },
		});
		await screen.findByText("Covered former employee");
		fireEvent.submit(screen.getByLabelText("CSV file").closest("form") as HTMLFormElement);
		await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
		expect(harness.commit).toHaveBeenNthCalledWith(2, { csv: "FRESH CSV" });
		expect(harness.success).toHaveBeenCalledTimes(1);
		expect(harness.invalidate).toHaveBeenCalledTimes(1);
	},
);

it("keeps the returned dialog open when an earlier commit's cache refresh finishes", async () => {
	let finish!: () => void;
	harness.commit.mockResolvedValue({
		success: true,
		data: { status: "committed", rows: [row], created: 1 },
	});
	harness.invalidate.mockImplementationOnce(
		() =>
			new Promise<void>((resolve) => {
				finish = resolve;
			}),
	);
	const content = <OpeningBalanceUploadPanel />;
	const view = render(<Activity mode="visible">{content}</Activity>);
	await open();
	fireEvent.change(screen.getByLabelText("CSV file"), {
		target: { files: [file(async () => "CSV")] },
	});
	await screen.findByText("Covered former employee");
	fireEvent.submit(screen.getByLabelText("CSV file").closest("form") as HTMLFormElement);
	await waitFor(() => expect(harness.invalidate).toHaveBeenCalledTimes(1));
	expect(harness.success).toHaveBeenCalledTimes(1);
	view.rerender(<Activity mode="hidden">{content}</Activity>);
	view.rerender(<Activity mode="visible">{content}</Activity>);
	await act(async () => finish());
	expect(screen.getByRole("dialog")).toBeTruthy();
	expect(screen.queryByText("Covered former employee")).toBeNull();
	expect((screen.getByLabelText("CSV file") as HTMLInputElement).disabled).toBe(false);
	await userEvent.setup().click(screen.getByRole("button", { name: "Cancel" }));
	await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
});

it("locks selection before file reading, prevents duplicates and keeps pending dismissal blocked", async () => {
	let resolve!: (text: string) => void;
	const read = vi.fn(
		() =>
			new Promise<string>((r) => {
				resolve = r;
			}),
	);
	render(<OpeningBalanceUploadPanel />);
	const user = await open();
	const describedBy = screen.getByLabelText("CSV file").getAttribute("aria-describedby");
	expect(describedBy).toBeTruthy();
	for (const id of describedBy?.split(" ") ?? []) expect(document.getElementById(id)).toBeTruthy();
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
	render(<OpeningBalanceUploadPanel />);
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
	const view = render(<OpeningBalanceUploadPanel />);
	await open();
	fireEvent.change(screen.getByLabelText("CSV file"), {
		target: { files: [file(async () => "CSV-A")] },
	});
	await waitFor(() => expect(harness.preview).toHaveBeenCalledTimes(1));
	harness.scope = { userId: "actor", activeOrganizationId: "B" };
	view.rerender(<OpeningBalanceUploadPanel />);
	expect(screen.queryByRole("dialog")).toBeNull();
	harness.scope = { userId: "actor", activeOrganizationId: "A" };
	view.rerender(<OpeningBalanceUploadPanel />);
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
	const view = render(<OpeningBalanceUploadPanel />);
	await open();
	fireEvent.change(screen.getByLabelText("CSV file"), {
		target: { files: [file(async () => "CSV-A")] },
	});
	await screen.findByText("Covered former employee");
	fireEvent.submit(screen.getByLabelText("CSV file").closest("form") as HTMLFormElement);
	await waitFor(() => expect(harness.commit).toHaveBeenCalledTimes(1));
	harness.scope = { userId: "new-actor", activeOrganizationId: "A" };
	view.rerender(<OpeningBalanceUploadPanel />);
	await act(async () =>
		resolve({ success: true, data: { status: "committed", rows: [row], created: 1 } }),
	);
	expect(harness.success).not.toHaveBeenCalled();
	expect(harness.invalidate).not.toHaveBeenCalled();
	expect(screen.queryByRole("dialog")).toBeNull();
});
