// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { FinanceTestOrganization } from "@/test/finance-organization-fixture";
import Page from "./page";

const boundary = vi.hoisted(() => ({ read: true, settle: false, export: false }));
vi.mock("@/lib/travel-expenses/finance-access", () => ({
	loadFinanceActor: async () => ({
		canRead: boundary.read,
		canSettle: boundary.settle,
		canExport: boundary.export,
	}),
}));
vi.mock("@/lib/auth-client", () => ({
	useSession: () => ({
		data: { user: { id: "finance" }, session: { activeOrganizationId: "org" } },
		isPending: false,
	}),
}));
vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
}));
vi.mock("next-intl", () => ({ useLocale: () => "en-US" }));
vi.mock("next/navigation", () => ({
	notFound: () => {
		throw new Error("Not found");
	},
	useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/navigation", () => ({
	useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
	Link: ({ children, ...props }: { children: ReactNode; href: string }) => (
		<a {...props}>{children}</a>
	),
}));
vi.mock("@/app/[locale]/(app)/travel-expenses/finance-actions", () => ({
	getTravelExpenseFinanceQueue: async () => ({
		success: true,
		data: { accounts: [], canSettle: boundary.settle, page: 1, hasMore: false },
	}),
	getTravelExpenseFinanceQueueFilterOptions: async () => ({
		success: true,
		data: { employees: [], teams: [], currencies: [] },
	}),
	getExpenseOfficerCoverageGap: async () => ({ success: true, data: null }),
	getPayrollRunsToConfirmAction: async () => ({ success: true, data: [] }),
}));
vi.mock("@/app/[locale]/(app)/travel-expenses/finance-export-actions", () => ({
	getTravelExpenseExports: async () => ({
		success: true,
		data: { exportable: [], batches: [], maxRevisions: 100, canSettle: boundary.settle },
	}),
}));
afterEach(cleanup);

async function content(params: Record<string, string> = {}) {
	const root = Page({ searchParams: Promise.resolve(params) });
	const child = root.props.children[1].props.children;
	return child.type(child.props);
}
it.each([
	["read-only", true, false, false],
	["export-only", true, false, true],
	["settle-only", true, true, false],
	["both", true, true, true],
] as const)(
	"assembles the admitted %s workspace with independent export authority",
	async (_role, read, settle, canExport) => {
		boundary.read = read;
		boundary.settle = settle;
		boundary.export = canExport;
		render(
			<QueryClientProvider
				client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
			>
				<FinanceTestOrganization>{await content()}</FinanceTestOrganization>
			</QueryClientProvider>,
		);
		expect(await screen.findByRole("heading", { name: "Approved expenses" })).toBeTruthy();
		expect(
			await screen.findByText("Nothing left to record: every approved expense is reimbursed."),
		).toBeTruthy();
		expect(Boolean(screen.queryByRole("heading", { name: "Exports" }))).toBe(canExport);
	},
);
it.each(["approver-only", "payroll-only", "without finance access"])(
	"refuses %s at the server route seam",
	async () => {
		boundary.read = false;
		boundary.settle = false;
		boundary.export = false;
		await expect(content()).rejects.toThrow("Not found");
	},
);
it("keeps the safe finance heading outside the suspended admission/read", () => {
	const root = Page({ searchParams: new Promise(() => {}) });
	render(root.props.children[0]);
	expect(screen.getByRole("heading", { level: 1, name: "Expense finance" })).toBeTruthy();
	expect(screen.getByRole("link", { name: "Back to travel expenses" })).toBeTruthy();
});
