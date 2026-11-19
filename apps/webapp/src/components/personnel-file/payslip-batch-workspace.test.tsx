// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	act,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { Activity } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import type { PayslipBatchPreview } from "@/lib/personnel-file/payslip-batch-store";
import { PayslipBatchWorkspace } from "./payslip-batch-workspace";

const boundary = vi.hoisted(() => ({
	get: vi.fn(),
	confirm: vi.fn(),
	update: vi.fn(),
	scope: { userId: "actor", activeOrganizationId: "org", isLoading: false },
}));
vi.mock("@/components/providers/organization-context-provider", () => ({
	useOrganization: () => boundary.scope,
}));
vi.mock("@/app/[locale]/(app)/personnel-files/payslip-batches/actions", () => ({
	getPayslipBatchAction: boundary.get,
	confirmPayslipBatchAction: boundary.confirm,
	updatePayslipBatchFileAction: boundary.update,
}));
vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string, values?: Record<string, unknown>) =>
			fallback.replace(/\{(\w+)\}/g, (match, key: string) =>
				String(values?.[key] ?? match),
			),
	}),
}));
vi.mock("@/components/providers/app-locale-provider", () => ({
	useAppLocale: () => "en",
}));
vi.mock("./use-payslip-batch-upload", () => ({
	usePayslipBatchUpload: () => ({
		addFiles: vi.fn(),
		isUploading: false,
		progress: { total: 0, staged: 0, failed: [] },
	}),
}));
const props = { batchId: "batch", userId: "actor", organizationId: "org" };
function preview(): PayslipBatchPreview {
	return {
		batch: {
			id: "batch",
			payPeriod: { year: 2026, month: 11 },
			visibility: "shared",
			status: "open",
			createdAt: "2026-11-15T12:00:00Z",
			confirmedAt: null,
		},
		files: [],
		employees: [],
	};
}
function mount() {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	return render(
		<QueryClientProvider client={client}>
			<PayslipBatchWorkspace {...props} />
		</QueryClientProvider>,
	);
}
function readyFile() {
	const data = preview();
	data.employees = [
		{
			id: "employee",
			name: "Employee One",
			employeeNumber: "100",
			teamId: null,
			teamName: null,
			isActive: true,
		},
	];
	data.files = [
		{
			id: "file",
			fileName: "100.pdf",
			sizeBytes: 100,
			matchKind: "matched",
			matchedEmployeeIds: ["employee"],
			assignedEmployeeId: null,
			employeeId: "employee",
			included: true,
			state: "staged",
			failure: null,
			alreadyHasPayslip: false,
		},
	];
	return data;
}
beforeEach(() => {
	vi.clearAllMocks();
	boundary.scope = {
		userId: "actor",
		activeOrganizationId: "org",
		isLoading: false,
	};
});

it("retries the authorized preview after a read failure", async () => {
	boundary.get
		.mockResolvedValueOnce({ success: false, error: "Unavailable" })
		.mockResolvedValue({ success: true, data: preview() });
	mount();
	fireEvent.click(await screen.findByRole("button", { name: "Retry" }));
	await screen.findByText("No files yet.");
	expect(boundary.get).toHaveBeenCalledTimes(2);
});

it("does not issue a preview command for an abandoned organization arrival", async () => {
	boundary.scope.activeOrganizationId = "other";
	boundary.get.mockResolvedValue({ success: true, data: preview() });
	mount();
	await act(async () => {});
	expect(boundary.get).not.toHaveBeenCalled();
});

it("freezes file edits until the confirmed command and readback settle", async () => {
	let complete!: (value: unknown) => void;
	boundary.get.mockResolvedValue({ success: true, data: readyFile() });
	boundary.confirm.mockImplementation(
		() =>
			new Promise((resolve) => {
				complete = resolve;
			}),
	);
	mount();
	fireEvent.click(
		await screen.findByRole("button", { name: "Save 1 payslips" }),
	);
	expect(boundary.confirm).not.toHaveBeenCalled();
	fireEvent.click(screen.getByRole("button", { name: "Save payslips" }));
	const include = screen.getByRole("checkbox", {
		name: "Include 100.pdf",
		hidden: true,
	});
	expect(include.getAttribute("aria-disabled")).toBe("true");
	fireEvent.click(include);
	expect(boundary.update).not.toHaveBeenCalled();
	await act(async () => {
		complete({
			success: true,
			data: { batch: readyFile().batch, created: [], failed: [] },
		});
	});
	await waitFor(() => expect(boundary.confirm).toHaveBeenCalledTimes(1));
});

it("requires resolving included unmatched files and preserves manual drop commands", async () => {
	const data = readyFile();
	data.files[0].employeeId = null;
	data.files[0].matchKind = "unmatched";
	boundary.get.mockResolvedValue({ success: true, data });
	boundary.update.mockResolvedValue({
		success: false,
		error: "Authority changed",
	});
	mount();
	const save = await screen.findByRole("button", { name: "Save 0 payslips" });
	expect(save.hasAttribute("disabled")).toBe(true);
	fireEvent.click(screen.getByRole("checkbox", { name: "Include 100.pdf" }));
	await screen.findByText("Authority changed");
	expect(boundary.update).toHaveBeenCalledWith({
		batchId: "batch",
		fileId: "file",
		assignedEmployeeId: null,
		included: false,
	});
	expect(boundary.confirm).not.toHaveBeenCalled();
});

it("does not publish an old preview after organization ABA", async () => {
	let old!: (value: unknown) => void;
	boundary.get
		.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					old = resolve;
				}),
		)
		.mockResolvedValue({ success: true, data: preview() });
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	const tree = () => (
		<QueryClientProvider client={client}>
			<PayslipBatchWorkspace {...props} />
		</QueryClientProvider>
	);
	const view = render(tree());
	await waitFor(() => expect(boundary.get).toHaveBeenCalledTimes(1));
	boundary.scope.activeOrganizationId = "other";
	view.rerender(tree());
	boundary.scope.activeOrganizationId = "org";
	view.rerender(tree());
	await screen.findByText("No files yet.");
	await act(async () => old({ success: true, data: readyFile() }));
	expect(screen.queryByText("100.pdf")).toBeNull();
});

it("discards late confirmation effects while cached Activity is hidden and revalidates on return", async () => {
	let finish!: (value: unknown) => void;
	boundary.get.mockResolvedValue({ success: true, data: readyFile() });
	boundary.confirm.mockImplementation(
		() =>
			new Promise((resolve) => {
				finish = resolve;
			}),
	);
	const client = new QueryClient();
	const tree = (mode: "visible" | "hidden") => (
		<QueryClientProvider client={client}>
			<Activity mode={mode}>
				<PayslipBatchWorkspace {...props} />
			</Activity>
		</QueryClientProvider>
	);
	const view = render(tree("visible"));
	fireEvent.click(
		await screen.findByRole("button", { name: "Save 1 payslips" }),
	);
	fireEvent.click(screen.getByRole("button", { name: "Save payslips" }));
	view.rerender(tree("hidden"));
	await act(async () =>
		finish({
			success: true,
			data: { batch: preview().batch, created: [], failed: [] },
		}),
	);
	view.rerender(tree("visible"));
	await screen.findByRole("button", { name: "Save 1 payslips" });
	expect(screen.queryByText("Result")).toBeNull();
	expect(screen.queryByRole("alertdialog")).toBeNull();
});

it("does not submit a queued match edit into a new Activity lifetime", async () => {
	boundary.get.mockResolvedValue({ success: true, data: readyFile() });
	boundary.update.mockResolvedValue({
		success: true,
		data: { fileId: "file" },
	});
	const client = new QueryClient();
	const tree = (mode: "visible" | "hidden") => (
		<QueryClientProvider client={client}>
			<Activity mode={mode}>
				<PayslipBatchWorkspace {...props} />
			</Activity>
		</QueryClientProvider>
	);
	const view = render(tree("visible"));
	const include = await screen.findByRole("checkbox", {
		name: "Include 100.pdf",
	});
	act(() => {
		fireEvent.click(include);
		view.rerender(tree("hidden"));
	});
	view.rerender(tree("visible"));
	await act(async () => {});
	expect(boundary.update).not.toHaveBeenCalled();
});

it("offers retry only for included failed files in a confirmed batch", async () => {
	const data = readyFile();
	data.batch.status = "confirmed";
	data.files[0].state = "created";
	data.files.push({
		...data.files[0],
		id: "failed",
		fileName: "retry.pdf",
		state: "failed",
		failure: "error",
	});
	boundary.get.mockResolvedValue({ success: true, data });
	boundary.confirm.mockResolvedValue({
		success: true,
		data: { batch: data.batch, created: [], failed: [] },
	});
	mount();
	fireEvent.click(
		await screen.findByRole("button", { name: "Retry 1 failed files" }),
	);
	await waitFor(() => expect(boundary.confirm).toHaveBeenCalledTimes(1));
	expect(screen.queryByLabelText("Payslip files")).toBeNull();
	expect(
		screen
			.getByRole("checkbox", { name: "Include 100.pdf" })
			.getAttribute("aria-disabled"),
	).toBe("true");
});
