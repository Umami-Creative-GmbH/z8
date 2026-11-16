/* @vitest-environment jsdom */

import { onlineManager, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import type { LegacyClaimHistoryRow } from "@/lib/travel-expenses/expense-history";

const boundary = vi.hoisted(() => ({
	pending: false,
	user: "reader-a",
	organization: "org-a",
	convert: vi.fn(),
	push: vi.fn(),
	history: vi.fn(),
}));
vi.mock("@/lib/auth-client", () => ({
	useSession: () => ({
		isPending: boundary.pending,
		data: {
			user: { id: boundary.user },
			session: { activeOrganizationId: boundary.organization },
		},
	}),
	// Displayed hook arrivals need not synchronously notify an atom subscription.
	authClient: {
		$store: {
			atoms: {
				session: {
					get: () => ({
						data: { user: { id: "reader-a" }, session: { activeOrganizationId: "org-a" } },
					}),
					subscribe: () => () => {},
				},
			},
		},
	},
}));
vi.mock("@/tolgee/client", () => ({}));
vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
}));
vi.mock("next-intl", () => ({ useLocale: () => "en-US" }));
vi.mock("@/navigation", () => ({
	useRouter: () => ({ push: boundary.push }),
	Link: ({ children, ...props }: { children: ReactNode; href: string }) => (
		<a {...props}>{children}</a>
	),
}));
vi.mock("@/app/[locale]/(app)/travel-expenses/legacy-draft-actions", () => ({
	convertLegacyTravelExpenseDraftAction: boundary.convert,
	getLegacyTravelExpenseConversion: vi.fn(),
}));
vi.mock("@/app/[locale]/(app)/travel-expenses/history-actions", () => ({
	getMyTravelExpenseHistory: boundary.history,
}));
vi.mock("@/app/[locale]/(app)/travel-expenses/report-actions", () => ({
	createStandaloneReceiptReportAction: vi.fn(),
	createTripReportAction: vi.fn(),
	deleteDraftTravelExpenseReportAction: vi.fn(),
}));
vi.mock("@/app/[locale]/(app)/travel-expenses/mileage-actions", () => ({
	createStandaloneMileageReportAction: vi.fn(),
}));

import { LegacyClaimActions } from "./legacy-draft-conversion";
import { TravelExpenseManagement } from "./travel-expense-management";

const claim: LegacyClaimHistoryRow = {
	source: "legacy_claim",
	id: "legacy",
	href: "/travel-expenses/legacy",
	stage: "needs_action",
	activityAt: "2026-04-01T10:00:00Z",
	balance: null,
	reimbursement: null,
	dates: { start: null, end: null },
	claimType: "receipt",
	status: "draft",
	amount: { amount: "120.50", currency: "EUR" },
	destination: null,
	canContinue: true,
};
afterEach(() => {
	cleanup();
	onlineManager.setOnline(true);
	vi.clearAllMocks();
	boundary.pending = false;
	boundary.user = "reader-a";
	boundary.organization = "org-a";
});

it.each(["history", "retained list"])(
	"retires a held %s conversion when displayed session becomes pending",
	async (consumer) => {
		boundary.history.mockResolvedValue({ success: true, data: [claim] });
		let complete!: (value: unknown) => void;
		boundary.convert.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					complete = resolve;
				}),
		);
		const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
		const tree = () => (
			<QueryClientProvider client={client}>
				{consumer === "history" ? (
					<TravelExpenseManagement organizationId="org-a" employeeId="employee-a" />
				) : (
					<LegacyClaimActions claim={claim} />
				)}
			</QueryClientProvider>
		);
		const view = render(tree());
		fireEvent.click(await screen.findByRole("button", { name: "Continue as report" }));
		await vi.waitFor(() => expect(boundary.convert).toHaveBeenCalledTimes(1));
		boundary.pending = true;
		view.rerender(tree());
		await act(async () =>
			complete({ success: true, data: { kind: "converted", reportId: "retired-conversion" } }),
		);
		expect(boundary.push).not.toHaveBeenCalled();
		client.clear();
	},
);

it("does not show a retired conversion refusal in a later displayed account", async () => {
	let complete!: (value: unknown) => void;
	boundary.convert.mockImplementationOnce(
		() =>
			new Promise((resolve) => {
				complete = resolve;
			}),
	);
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	const tree = () => (
		<QueryClientProvider client={client}>
			<LegacyClaimActions claim={claim} />
		</QueryClientProvider>
	);
	const view = render(tree());
	fireEvent.click(await screen.findByRole("button", { name: "Continue as report" }));
	await vi.waitFor(() => expect(boundary.convert).toHaveBeenCalledTimes(1));
	boundary.user = "reader-b";
	view.rerender(tree());
	await act(async () =>
		complete({
			success: true,
			data: {
				kind: "receipt_unavailable",
				attachments: [
					{ attachmentId: "private", fileName: "earlier-reader-private.png", reason: "unreadable" },
				],
			},
		}),
	);
	await vi.waitFor(() =>
		expect(screen.getByRole("button", { name: "Continue as report" })).toHaveProperty(
			"disabled",
			false,
		),
	);
	expect(screen.queryByRole("alert")).toBeNull();
	client.clear();
});

it("does not start a queued continuation after displayed session proof is interrupted", async () => {
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	const tree = () => (
		<QueryClientProvider client={client}>
			<LegacyClaimActions claim={claim} />
		</QueryClientProvider>
	);
	const view = render(tree());
	onlineManager.setOnline(false);
	fireEvent.click(await screen.findByRole("button", { name: "Continue as report" }));
	boundary.pending = true;
	view.rerender(tree());
	onlineManager.setOnline(true);
	await act(() => client.resumePausedMutations());
	expect(boundary.convert).not.toHaveBeenCalled();
	client.clear();
});

it("never reactivates a held continuation after account A returns from account B", async () => {
	let complete!: (value: unknown) => void;
	boundary.convert.mockImplementationOnce(
		() =>
			new Promise((resolve) => {
				complete = resolve;
			}),
	);
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	const tree = () => (
		<QueryClientProvider client={client}>
			<LegacyClaimActions claim={claim} />
		</QueryClientProvider>
	);
	const view = render(tree());
	fireEvent.click(await screen.findByRole("button", { name: "Continue as report" }));
	await vi.waitFor(() => expect(boundary.convert).toHaveBeenCalledTimes(1));
	boundary.user = "reader-b";
	view.rerender(tree());
	boundary.user = "reader-a";
	view.rerender(tree());
	await act(async () =>
		complete({ success: true, data: { kind: "converted", reportId: "retired-return" } }),
	);
	await vi.waitFor(() =>
		expect(screen.getByRole("button", { name: "Continue as report" })).toHaveProperty(
			"disabled",
			false,
		),
	);
	expect(boundary.push).not.toHaveBeenCalled();
	client.clear();
});
