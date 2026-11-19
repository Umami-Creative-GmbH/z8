// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Activity, type ReactNode } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { OrganizationContextProvider } from "@/components/providers/organization-context-provider";
import type { PayslipBatchPreview } from "@/lib/personnel-file/payslip-batch-store";
import { queryKeys } from "@/lib/query/keys";
import { PayslipBatchWorkspace } from "./payslip-batch-workspace";
import { PayslipBatchesScope } from "./payslip-batches-scope";

const boundary = vi.hoisted(() => ({
	get: vi.fn(),
	confirm: vi.fn(),
	update: vi.fn(),
	fetch: vi.fn(),
	success: vi.fn(),
	error: vi.fn(),
	noop: () => {},
	session: {
		data: { user: { id: "actor" }, session: { activeOrganizationId: "org" } },
		isPending: false,
	},
}));

vi.mock("@/lib/auth-client", () => ({ useSession: () => boundary.session }));
vi.mock("sonner", () => ({
	toast: { success: boundary.success, error: boundary.error },
}));
vi.mock("@/lib/fetch", async (original) => ({
	...(await original<typeof import("@/lib/fetch")>()),
	fetchApi: boundary.fetch,
}));
vi.mock("@/navigation", () => ({
	useRouter: () => ({ replace: boundary.noop }),
}));
vi.mock("@/stores/organization-settings-store", () => ({
	OrganizationSettingsStoreProvider: ({ children }: { children: ReactNode }) => children,
	useOrganizationSettings: (selector: (store: unknown) => unknown) =>
		selector({ hydrate: boundary.noop, reset: boundary.noop }),
}));
vi.mock("@/app/[locale]/(app)/personnel-files/payslip-batches/actions", () => ({
	getPayslipBatchAction: boundary.get,
	confirmPayslipBatchAction: boundary.confirm,
	updatePayslipBatchFileAction: boundary.update,
}));
vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string, values?: Record<string, unknown>) =>
			fallback.replace(/\{(\w+)\}/g, (match, key: string) => String(values?.[key] ?? match)),
	}),
}));
vi.mock("@/components/providers/app-locale-provider", () => ({
	useAppLocale: () => "en",
}));
vi.mock("./use-payslip-batch-upload", () => ({
	usePayslipBatchUpload: () => ({
		addFiles: boundary.noop,
		isUploading: false,
		progress: { total: 0, staged: 0, failed: [] },
	}),
}));

const contextResponse = {
	user: { id: "actor" },
	session: { activeOrganizationId: "org" },
	employee: null,
	organizationSettings: null,
};
const preview: PayslipBatchPreview = {
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

function readyPreview(): PayslipBatchPreview {
	return {
		...preview,
		employees: [
			{
				id: "employee",
				name: "Employee One",
				employeeNumber: "100",
				teamId: null,
				teamName: null,
				isActive: true,
			},
		],
		files: [
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
		],
	};
}

function setup(
	content: ReactNode = (
		<PayslipBatchWorkspace batchId="batch" userId="actor" organizationId="org" />
	),
) {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false, gcTime: 0 } },
	});
	const initialContext = {
		userId: "actor",
		organizationId: "org",
		employee: null,
		organizationSettings: null,
		updatedAt: Date.now(),
	};
	const tree = (mode: "visible" | "hidden" = "visible") => (
		<QueryClientProvider client={client}>
			<OrganizationContextProvider initialContext={initialContext}>
				<Activity mode={mode}>{content}</Activity>
			</OrganizationContextProvider>
		</QueryClientProvider>
	);
	const view = render(tree());
	return {
		client,
		tree,
		view,
		cleanup: () => {
			view.unmount();
			client.clear();
		},
	};
}

beforeEach(() => {
	vi.clearAllMocks();
	boundary.session = {
		data: { user: { id: "actor" }, session: { activeOrganizationId: "org" } },
		isPending: false,
	};
	boundary.fetch.mockResolvedValue(contextResponse);
	boundary.get.mockResolvedValue({ success: true, data: preview });
	boundary.confirm.mockResolvedValue({ success: false, error: "Unexpected confirmation" });
	boundary.update.mockResolvedValue({ success: false, error: "Unexpected edit" });
});

it("keeps an admitted matching session usable while its session refresh is pending", async () => {
	const subject = setup();
	try {
		await screen.findByText("No files yet.");
		boundary.session.isPending = true;
		subject.view.rerender(subject.tree());
		expect(screen.getByText("No files yet.")).toBeTruthy();
	} finally {
		subject.cleanup();
	}
});

it("recovers the batch through local organization Retry after the real provider read fails", async () => {
	const subject = setup();
	try {
		await screen.findByText("No files yet.");
		boundary.fetch.mockRejectedValueOnce(new Error("Internal read diagnostics"));
		await act(async () => {
			await subject.client.refetchQueries({
				queryKey: queryKeys.organizationContext.current("actor", "org"),
				exact: true,
			});
		});
		await waitFor(() => expect(screen.queryByText("No files yet.")).toBeNull());
		const alert = screen.getByRole("alert");
		expect(alert.textContent).toContain("Your current organization could not be confirmed.");
		expect(alert.textContent).not.toContain("Internal read diagnostics");
		fireEvent.click(screen.getByRole("button", { name: "Retry" }));
		await screen.findByText("No files yet.");
		expect(boundary.fetch).toHaveBeenCalledTimes(2);
		expect(screen.queryByRole("alert")).toBeNull();
	} finally {
		subject.cleanup();
	}
});

it("preserves the start-page control through the same provider failure and Retry", async () => {
	const subject = setup(
		<PayslipBatchesScope userId="actor" organizationId="org">
			<p>Admitted start-page records</p>
		</PayslipBatchesScope>,
	);
	try {
		await screen.findByText("Admitted start-page records");
		boundary.fetch.mockRejectedValueOnce(new Error("Internal read diagnostics"));
		await act(async () => {
			await subject.client.refetchQueries({
				queryKey: queryKeys.organizationContext.current("actor", "org"),
				exact: true,
			});
		});
		await screen.findByRole("alert");
		expect(screen.queryByText("Admitted start-page records")).toBeNull();
		fireEvent.click(screen.getByRole("button", { name: "Retry" }));
		await screen.findByText("Admitted start-page records");
		expect(boundary.fetch).toHaveBeenCalledTimes(2);
	} finally {
		subject.cleanup();
	}
});

it.each(["success", "refusal", "rejection"])(
	"holds one confirmation through Activity until %s settles and readback finishes",
	async (outcome) => {
		const pending: Array<{
			resolve: (value: unknown) => void;
			reject: (reason: Error) => void;
		}> = [];
		let finishRead: ((value: unknown) => void) | undefined;
		boundary.get.mockResolvedValue({ success: true, data: readyPreview() });
		boundary.confirm.mockImplementation(
			() => new Promise((resolve, reject) => pending.push({ resolve, reject })),
		);
		const subject = setup();
		try {
			fireEvent.click(await screen.findByRole("button", { name: "Save 1 payslips" }));
			fireEvent.click(screen.getByRole("button", { name: "Save payslips" }));
			expect(boundary.confirm).toHaveBeenCalledTimes(1);
			fireEvent.click(screen.getByRole("button", { name: "Save payslips" }));
			expect(boundary.confirm).toHaveBeenCalledTimes(1);

			subject.view.rerender(subject.tree("hidden"));
			subject.view.rerender(subject.tree("visible"));
			await waitFor(() => expect(boundary.get.mock.calls.length).toBeGreaterThanOrEqual(2));
			await waitFor(() => expect(subject.client.isFetching()).toBe(0));
			const reopen = screen.getByRole("button", { name: "Save 1 payslips" });
			fireEvent.click(reopen);
			const repeatedDecision = screen.queryByRole("button", { name: "Save payslips" });
			if (repeatedDecision) fireEvent.click(repeatedDecision);
			expect(boundary.confirm).toHaveBeenCalledTimes(1);
			expect(reopen.hasAttribute("disabled")).toBe(true);

			boundary.get.mockImplementationOnce(
				() =>
					new Promise((resolve) => {
						finishRead = resolve;
					}),
			);
			await act(async () => {
				if (outcome === "rejection") pending[0].reject(new Error("Retired transport diagnostics"));
				else
					pending[0].resolve(
						outcome === "success"
							? {
									success: true,
									data: { batch: readyPreview().batch, created: [], failed: [] },
								}
							: { success: false, error: "Retired refusal" },
					);
			});
			await waitFor(() => expect(boundary.get).toHaveBeenCalledTimes(3));
			expect(screen.getByRole("button", { name: "Save 1 payslips" }).hasAttribute("disabled")).toBe(
				true,
			);
			expect(boundary.confirm).toHaveBeenCalledTimes(1);
			await act(async () => {
				if (!finishRead) throw new Error("Authoritative readback did not start");
				finishRead({ success: true, data: readyPreview() });
			});
			await waitFor(() =>
				expect(
					screen.getByRole("button", { name: "Save 1 payslips" }).hasAttribute("disabled"),
				).toBe(false),
			);
			expect(boundary.success).not.toHaveBeenCalled();
			expect(boundary.error).not.toHaveBeenCalled();
			expect(screen.queryByRole("alert")).toBeNull();
			fireEvent.click(screen.getByRole("button", { name: "Save 1 payslips" }));
			fireEvent.click(screen.getByRole("button", { name: "Save payslips" }));
			expect(boundary.confirm).toHaveBeenCalledTimes(2);
		} finally {
			subject.view.unmount();
			await act(async () => {
				finishRead?.({ success: true, data: readyPreview() });
				for (const { resolve } of pending) resolve({ success: false, error: "Cleanup outcome" });
			});
			subject.client.clear();
		}
	},
);

it("keeps an edit reserved through Activity and recovers a failed readback without overlapping confirmation", async () => {
	let finishEdit: ((value: unknown) => void) | undefined;
	boundary.get.mockResolvedValue({ success: true, data: readyPreview() });
	boundary.update.mockImplementationOnce(
		() =>
			new Promise((resolve) => {
				finishEdit = resolve;
			}),
	);
	const subject = setup();
	try {
		fireEvent.click(await screen.findByRole("checkbox", { name: "Include 100.pdf" }));
		await waitFor(() => expect(boundary.update).toHaveBeenCalledTimes(1));
		subject.view.rerender(subject.tree("hidden"));
		subject.view.rerender(subject.tree("visible"));
		await waitFor(() => expect(boundary.get.mock.calls.length).toBeGreaterThanOrEqual(2));
		await waitFor(() => expect(subject.client.isFetching()).toBe(0));
		const save = screen.getByRole("button", { name: "Save 1 payslips" });
		fireEvent.click(save);
		const decision = screen.queryByRole("button", { name: "Save payslips" });
		if (decision) fireEvent.click(decision);
		expect(boundary.confirm).not.toHaveBeenCalled();
		expect(save.hasAttribute("disabled")).toBe(true);
		boundary.get.mockResolvedValueOnce({ success: false, error: "Readback unavailable" });
		await act(async () => {
			if (!finishEdit) throw new Error("The matching edit did not start");
			finishEdit({ success: false, error: "Retired edit refusal" });
		});
		const alert = await screen.findByRole("alert");
		expect(alert.textContent).toContain("The payslip batch could not be loaded.");
		expect(alert.textContent).not.toContain("Retired edit refusal");
		fireEvent.click(screen.getByRole("button", { name: "Retry" }));
		await waitFor(() =>
			expect(screen.getByRole("button", { name: "Save 1 payslips" }).hasAttribute("disabled")).toBe(
				false,
			),
		);
		expect(boundary.update).toHaveBeenCalledTimes(1);
		expect(boundary.confirm).not.toHaveBeenCalled();
	} finally {
		subject.view.unmount();
		await act(async () => {
			finishEdit?.({ success: false, error: "Cleanup outcome" });
		});
		subject.client.clear();
	}
});

it("releases a confirmation that settles while hidden before restoring the workspace", async () => {
	let finish: ((value: unknown) => void) | undefined;
	boundary.get.mockResolvedValue({ success: true, data: readyPreview() });
	boundary.confirm.mockImplementationOnce(
		() =>
			new Promise((resolve) => {
				finish = resolve;
			}),
	);
	const subject = setup();
	try {
		fireEvent.click(await screen.findByRole("button", { name: "Save 1 payslips" }));
		fireEvent.click(screen.getByRole("button", { name: "Save payslips" }));
		subject.view.rerender(subject.tree("hidden"));
		await act(async () => {
			if (!finish) throw new Error("The confirmation did not start");
			finish({ success: true, data: { batch: readyPreview().batch, created: [], failed: [] } });
		});
		expect(boundary.get).toHaveBeenCalledTimes(1);
		subject.view.rerender(subject.tree("visible"));
		await waitFor(() => expect(boundary.get.mock.calls.length).toBeGreaterThanOrEqual(2));
		await waitFor(() =>
			expect(screen.getByRole("button", { name: "Save 1 payslips" }).hasAttribute("disabled")).toBe(
				false,
			),
		);
		expect(boundary.success).not.toHaveBeenCalled();
		expect(boundary.error).not.toHaveBeenCalled();
		fireEvent.click(screen.getByRole("button", { name: "Save 1 payslips" }));
		fireEvent.click(screen.getByRole("button", { name: "Save payslips" }));
		await waitFor(() => expect(boundary.confirm).toHaveBeenCalledTimes(2));
	} finally {
		subject.view.unmount();
		await act(async () => {
			finish?.({ success: false, error: "Cleanup outcome" });
		});
		subject.client.clear();
	}
});
