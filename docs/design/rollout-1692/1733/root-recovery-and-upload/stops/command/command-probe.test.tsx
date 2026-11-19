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
	noop: () => {},
	session: {
		data: { user: { id: "actor" }, session: { activeOrganizationId: "org" } },
		isPending: false,
	},
}));

vi.mock("@/lib/auth-client", () => ({ useSession: () => boundary.session }));
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


function readyPreview(): PayslipBatchPreview {
  return {
    ...preview,
    employees: [{ id: "employee", name: "Employee One", employeeNumber: "100", teamId: null, teamName: null, isActive: true }],
    files: [{ id: "file", fileName: "100.pdf", sizeBytes: 100, matchKind: "matched", matchedEmployeeIds: ["employee"], assignedEmployeeId: null, employeeId: "employee", included: true, state: "staged", failure: null, alreadyHasPayslip: false }],
  };
}

it.each([false, true])("prevents a duplicate pending confirmation with Activity resume=%s", async (resume) => {
  const pending: ((value: unknown) => void)[] = [];
  boundary.get.mockResolvedValue({ success: true, data: readyPreview() });
  boundary.confirm.mockImplementation(() => new Promise((resolve) => pending.push(resolve)));
  const subject = setup();
  try {
    fireEvent.click(await screen.findByRole("button", { name: "Save 1 payslips" }));
    expect(boundary.confirm).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Save payslips" }));
    await waitFor(() => expect(boundary.confirm).toHaveBeenCalledTimes(1));
    expect(pending).toHaveLength(1);
    const first = screen.getByRole("button", { name: "Save payslips" });
    expect(first.hasAttribute("disabled")).toBe(true);
    fireEvent.click(first);
    expect(boundary.confirm).toHaveBeenCalledTimes(1);
    if (resume) {
      subject.view.rerender(subject.tree("hidden"));
      subject.view.rerender(subject.tree("visible"));
      await waitFor(() => expect(boundary.get.mock.calls.length).toBeGreaterThanOrEqual(2));
      const reopen = await screen.findByRole("button", { name: "Save 1 payslips" });
      await waitFor(() => expect(reopen.hasAttribute("disabled")).toBe(false));
      // First promise remains unsettled; perform a second ordinary public confirmation.
      expect(pending).toHaveLength(1);
      fireEvent.click(reopen);
      fireEvent.click(screen.getByRole("button", { name: "Save payslips" }));
    }
    expect(boundary.confirm).toHaveBeenCalledTimes(1);
    expect(pending).toHaveLength(1);
  } finally {
    subject.view.unmount();
    await act(async () => { for (const resolve of pending) resolve({ success: false, error: "Synthetic command settled after observation" }); });
    subject.client.clear();
  }
});
