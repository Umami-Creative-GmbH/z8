/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { type ReactElement, type ReactNode, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ReportPage from "@/app/[locale]/(app)/travel-expenses/reports/[reportId]/page";
import { OrganizationContextProvider } from "@/components/providers/organization-context-provider";
import {
	useViewRefreshAction,
	ViewRefreshProvider,
} from "@/components/providers/view-refresh-provider";
import type { OrganizationDisplayContext } from "@/lib/auth/organization-display-context";

const REPORT_ID = "6a020000-0000-4000-8000-000000000001";
const ITEM_ID = "6a020000-0000-4000-8000-000000000002";
const SAVED = "Recorded train fare";
const ENTERED = "Unsaved return train fare";

const deps = vi.hoisted(() => ({
	authorized: vi.fn(),
	employee: { id: "review-employee", organizationId: "review-org" },
	user: { id: "review-user" },
	read: vi.fn(),
	save: vi.fn(),
	refresh: vi.fn(),
	replace: vi.fn(),
	toast: { error: vi.fn(), success: vi.fn() },
}));

vi.mock("@/lib/auth-client", () => ({
	useSession: () => ({
		data: { user: deps.user, session: { activeOrganizationId: deps.employee.organizationId } },
		isPending: false,
	}),
}));
vi.mock("@/lib/auth-helpers", () => ({
	getAuthContext: async () => ({ user: deps.user, employee: deps.employee }),
}));
vi.mock("@/lib/travel-expenses/report-read", () => ({
	loadAuthorizedTravelExpenseReport: deps.authorized,
}));
vi.mock("@/lib/travel-expenses/finance-access", () => ({
	financeActorReads: vi.fn(),
	loadFinanceActor: vi.fn(),
}));
vi.mock("@/env", async (original) => {
	const { env } = await original<typeof import("@/env")>();
	return { env: { ...env, TRAVEL_EXPENSE_MAX_UPLOAD_SIZE_BYTES: 1024 } };
});
vi.mock("next/navigation", () => ({
	useRouter: () => ({ refresh: deps.refresh, replace: deps.replace }),
	notFound: () => {
		throw Error("Not found");
	},
}));
vi.mock("next-intl", () => ({ useLocale: () => "en-US" }));
vi.mock("@/navigation", () => ({
	useRouter: () => ({ refresh: deps.refresh, replace: deps.replace }),
	Link: ({ href, children, ...props }: { href: string; children: ReactNode }) => (
		<a href={href} {...props}>
			{children}
		</a>
	),
}));
vi.mock("@/tolgee/server", () => ({
	getTranslate: async () => (_key: string, text: string) => text,
}));
vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, text: string, values?: Record<string, unknown>) =>
			text.replace(/\{(\w+)\}/g, (match, key) => String(values?.[key] ?? match)),
	}),
}));
vi.mock("sonner", () => ({ toast: deps.toast }));
vi.mock("@/app/[locale]/(app)/travel-expenses/report-actions", () => ({
	getMyTravelExpenseReport: deps.read,
	saveReceiptItemDraftAction: deps.save,
}));
vi.mock("@/app/[locale]/(app)/travel-expenses/legacy-draft-actions", () => ({
	getLegacyTravelExpenseConversion: async () => ({ success: true, data: null }),
}));
vi.mock("@/app/[locale]/(app)/travel-expenses/report-project-actions", () => ({
	getReportProjectChoicesAction: async () => ({
		success: true,
		data: { timeZone: "Europe/Berlin", choices: [], selected: null },
	}),
}));
vi.mock("@/app/[locale]/(app)/travel-expenses/adjustment-actions", () => ({
	getTravelExpenseReportAdjustments: async () => ({
		success: false,
		error: "Expense report not found",
	}),
}));
vi.mock("@/app/[locale]/(app)/travel-expenses/report-review-actions", () => ({}));
vi.mock("@/hooks/use-travel-expense-file-upload", () => ({
	useTravelExpenseFileUpload: () => ({
		addFile: vi.fn(),
		reset: vi.fn(),
		isUploading: false,
		isProcessing: false,
		progress: 0,
	}),
}));

function receipt(description = SAVED, version = 3) {
	return {
		id: ITEM_ID,
		type: "receipt",
		version,
		expenseDate: "2026-09-14",
		updatedAt: "2026-10-05T10:00:00.000Z",
		category: "transport",
		description,
		amount: "89.90",
		currency: "EUR",
		paidBy: "employee",
		accountingReference: null,
		receiptException: { reason: null, version: 0 },
		receipts: [],
	};
}

function report(item = receipt()) {
	return {
		id: REPORT_ID,
		kind: "standalone",
		status: "draft",
		submissionCount: 0,
		employeeId: deps.employee.id,
		reimbursementCurrency: "EUR",
		createdAt: "2026-10-05T09:00:00.000Z",
		updatedAt: "2026-10-05T10:00:00.000Z",
		items: [item],
	};
}

function context(): OrganizationDisplayContext {
	return {
		userId: deps.user.id,
		organizationId: deps.employee.organizationId,
		employee: {
			employeeId: deps.employee.id,
			organizationId: deps.employee.organizationId,
			role: "employee",
		},
		organizationSettings: null,
		updatedAt: Date.now(),
	};
}

async function freshArrival() {
	const shell = ReportPage({
		params: Promise.resolve({ reportId: REPORT_ID }),
		searchParams: Promise.resolve({}),
	});
	// Evaluate the actual async server child and deliver its unchanged React
	// element to jsdom, including the real server-generated key.
	const server = shell.props.children;
	return (await server.type(server.props)) as ReactElement;
}

function RefreshButton() {
	const { refresh, isRefreshing } = useViewRefreshAction();
	return (
		<button type="button" onClick={refresh} disabled={isRefreshing}>
			Refresh report data
		</button>
	);
}

let client: QueryClient | undefined;
let finish: (value: unknown) => void;

function mount(initial: ReactElement) {
	const bootstrap = context();
	client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
	function Harness() {
		const [page, setPage] = useState({ current: initial, completed: 1 });
		deps.refresh.mockImplementation(() => {
			void freshArrival().then((current) => {
				setPage((previous) => ({ current, completed: previous.completed + 1 }));
			});
		});
		return (
			<OrganizationContextProvider initialContext={bootstrap}>
				<ViewRefreshProvider>
					<RefreshButton />
					<output aria-label="Completed server arrivals">{page.completed}</output>
					{page.current}
				</ViewRefreshProvider>
			</OrganizationContextProvider>
		);
	}
	render(
		<QueryClientProvider client={client}>
			<Harness />
		</QueryClientProvider>,
	);
}

const description = () =>
	screen.findByRole<HTMLTextAreaElement>("textbox", { name: "Description" });

beforeEach(() => {
	vi.resetAllMocks();
	vi.stubGlobal(
		"ResizeObserver",
		class {
			observe() {}
			unobserve() {}
			disconnect() {}
		},
	);
	vi.stubGlobal(
		"fetch",
		vi.fn(async (url: string) => {
			if (url !== "/api/auth/context") throw Error("Unexpected transport");
			return Response.json({
				user: deps.user,
				session: { activeOrganizationId: deps.employee.organizationId },
				employee: context().employee,
				organizationSettings: null,
			});
		}),
	);
	deps.authorized.mockResolvedValue({ status: "found", access: "owner", report: report() });
	deps.read.mockResolvedValue({ success: true, data: report() });
});

afterEach(() => {
	cleanup();
	client?.clear();
	vi.unstubAllGlobals();
});

describe("R168 report arrival preserves the entered draft", () => {
	it.each(["in-flight autosave", "failed autosave"] as const)(
		"retains %s across a client-data refetch (same completed server arrival)",
		async (state) => await compare(state, false),
	);
	it.each(["in-flight autosave", "failed autosave"] as const)(
		"retains %s after ViewRefresh delivers new same-scope server content",
		async (state) => await compare(state, true),
	);
});

async function compare(state: "in-flight autosave" | "failed autosave", serverRefresh: boolean) {
	const failed = state === "failed autosave";
	if (failed) deps.save.mockRejectedValueOnce(Error("Synthetic save transport failed"));
	else
		deps.save.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					finish = resolve;
				}),
		);
	const originalArrival = await freshArrival();
	mount(originalArrival);
	expect((await description()).value).toBe(SAVED);
	fireEvent.change(await description(), { target: { value: ENTERED } });
	await waitFor(() => expect(deps.save).toHaveBeenCalledTimes(1), { timeout: 2200 });
	const status = failed ? "Your changes could not be saved" : "Saving…";
	await screen.findByText(status);
	expect((await description()).value).toBe(ENTERED);
	expect(deps.save.mock.calls[0][0]).toMatchObject({
		reportId: REPORT_ID,
		itemId: ITEM_ID,
		expectedVersion: 3,
		values: { description: ENTERED },
	});
	const beforeRead = deps.read.mock.calls.length;
	if (serverRefresh) {
		fireEvent.click(screen.getByRole("button", { name: "Refresh report data" }));
		await waitFor(() => {
			expect(deps.refresh).toHaveBeenCalledTimes(1);
			expect(deps.authorized).toHaveBeenCalledTimes(2);
			expect(deps.read.mock.calls.length).toBeGreaterThan(beforeRead);
			expect(screen.getByLabelText("Completed server arrivals").textContent).toBe("2");
		});
	} else {
		await act(async () => {
			await client?.refetchQueries({ type: "active" });
		});
		expect(deps.authorized).toHaveBeenCalledTimes(1);
		expect(deps.read.mock.calls.length).toBeGreaterThan(beforeRead);
	}
	const result = {
		description: (await description()).value,
		keptSaveState: Boolean(screen.queryByText(status)),
		retryOffered: Boolean(screen.queryByRole("button", { name: "Try again" })),
		saveDispatches: deps.save.mock.calls.length,
	};
	if (!failed) {
		deps.read.mockResolvedValue({ success: true, data: report(receipt(ENTERED, 4)) });
		await act(async () =>
			finish({ success: true, data: { status: "saved", item: receipt(ENTERED, 4) } }),
		);
	}
	expect(result).toEqual({
		description: ENTERED,
		keptSaveState: true,
		retryOffered: failed,
		saveDispatches: 1,
	});
	if (failed) {
		deps.read.mockResolvedValue({ success: true, data: report(receipt(ENTERED, 4)) });
		deps.save.mockResolvedValueOnce({
			success: true,
			data: { status: "saved", item: receipt(ENTERED, 4) },
		});
		fireEvent.click(screen.getByRole("button", { name: "Try again" }));
		await waitFor(() => expect(deps.save).toHaveBeenCalledTimes(2));
		expect(deps.save.mock.calls[1][0]).toEqual(deps.save.mock.calls[0][0]);
		await screen.findByText("All changes saved");
	}
}
