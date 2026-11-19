// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import Page from "./page";

const boundary = vi.hoisted(() => ({ auth: vi.fn(), finance: vi.fn() }));
vi.mock("@/lib/auth-helpers", () => ({ getAuthContext: boundary.auth }));
vi.mock("@/lib/travel-expenses/finance-access", () => ({ loadFinanceActor: boundary.finance }));
vi.mock("@/tolgee/server", () => ({
	getTranslate: async () => (_key: string, fallback: string) => fallback,
}));
vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
}));
vi.mock("@/navigation", () => ({
	Link: ({ children, ...props }: React.ComponentProps<"a">) => <a {...props}>{children}</a>,
}));
// RSC transport boundary: retain the real destination components and page admission.
vi.mock("@/components/travel-expenses/travel-expense-management", () => ({
	TravelExpenseManagement: ({ banners }: { banners: React.ReactNode }) => <>{banners}</>,
}));
vi.mock("@/components/errors/no-employee-error", () => ({
	NoEmployeeError: () => <p>Employee required</p>,
}));
afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

async function content() {
	const child = Page().props.children;
	const element = await child.type(child.props);
	// Resolve server entry leaves before handing their serialized children to the client.
	const entries = element.props.banners?.props.children ?? [];
	return (
		<>
			{
				await Promise.all(
					entries
						.filter(Boolean)
						.map((entry: React.ReactElement) => (entry.type as () => Promise<React.ReactNode>)()),
				)
			}
		</>
	);
}

it.each([
	["employee", false, false, false],
	["employee", true, false, true],
	["manager", false, true, false],
	["admin", true, true, true],
] as const)(
	"keeps %s approval and finance destinations independent (%s)",
	async (role, canRead, inbox, finance) => {
		boundary.auth.mockResolvedValue({
			user: { id: "user" },
			employee: { id: "owner", organizationId: "org", role },
		});
		boundary.finance.mockResolvedValue({ canRead });
		render(await content());
		expect(Boolean(screen.queryByRole("link", { name: "Open inbox" }))).toBe(inbox);
		expect(Boolean(screen.queryByRole("link", { name: "Open finance queue" }))).toBe(finance);
		if (inbox)
			expect(screen.getByRole("link", { name: "Open inbox" }).getAttribute("href")).toBe(
				"/approvals/inbox?types=travel_expense_report,travel_expense_claim",
			);
		if (finance)
			expect(screen.getByRole("link", { name: "Open finance queue" }).getAttribute("href")).toBe(
				"/travel-expenses/finance",
			);
	},
);

it("keeps a task heading while admission loads and when no employee is admitted", async () => {
	const fallback = Page().props.fallback;
	render(await fallback.type(fallback.props));
	expect(screen.getAllByRole("heading", { level: 1, name: "Travel Expenses" })).toHaveLength(1);
	cleanup();
	boundary.auth.mockResolvedValue(null);
	boundary.finance.mockResolvedValue(null);
	const child = Page().props.children;
	render(await child.type(child.props));
	expect(screen.getAllByRole("heading", { level: 1, name: "Travel Expenses" })).toHaveLength(1);
	expect(screen.queryByRole("link", { name: "Open finance queue" })).toBeNull();
});
