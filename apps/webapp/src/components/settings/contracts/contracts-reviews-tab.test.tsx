/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { TolgeeProvider } from "@tolgee/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestTolgee } from "@/test/render-with-translations";

// #1994: the unified Reviews & Conflicts inbox. Each domain section is stubbed to show what the
// tab hands it; the sections themselves have their own tests.

const state = vi.hoisted(() => ({ search: new URLSearchParams() }));

vi.mock("next/navigation", () => ({ useSearchParams: () => state.search }));
vi.mock("@/navigation", () => ({
	Link: ({ href, children }: { href: string; children: React.ReactNode }) => (
		<a href={href}>{children}</a>
	),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/app/[locale]/(app)/settings/contracts/actions", () => ({
	listContractsReviewQueueAction: vi.fn(async () => ({
		success: true,
		data: { migrationConflicts: [], departureReviews: [], migratedLegacyTermsCount: 0 },
	})),
	resolveContractMigrationConflictAction: vi.fn(),
}));
vi.mock("@/app/[locale]/(app)/settings/contracts/bulk-actions", () => ({
	previewBulkContractActionAction: vi.fn(),
	submitBulkContractActionAction: vi.fn(),
}));
vi.mock("@/app/[locale]/(app)/settings/employees/employee-offboarding.actions", () => ({
	resolveDepartureReviewAction: vi.fn(),
}));

function stub(name: string) {
	return (props: Record<string, unknown>) => (
		<section
			data-testid={name}
			data-resolved={String(props.includeResolved ?? props.includeAcknowledged)}
			// "unset": the tab did not say, and the section decides itself (it may show an empty card).
			data-empty={String(props.showWhenEmpty ?? "unset")}
			data-domain={String(props.domain ?? "")}
		/>
	);
}
vi.mock("./minijob-exceedance-reviews", () => ({ MinijobExceedanceReviews: stub("minijob") }));
vi.mock("./short-term-berufsmaessigkeit-reviews", () => ({
	ShortTermBerufsmaessigkeitReviews: stub("short_term"),
}));
vi.mock("./working-student-reviews-section", () => ({
	WorkingStudentReviewsSection: stub("working_student"),
}));
vi.mock("./on-call-reviews-section", () => ({ OnCallReviewsSection: stub("on_call") }));
vi.mock("./youth-sector-exceptions-section", () => ({
	YouthSectorExceptionsSection: stub("youth_apprentice"),
}));
vi.mock("./minor-contractor-reviews-section", () => ({
	MinorContractorReviewsSection: stub("minor_contractors"),
}));
vi.mock("./statutory-monitor-findings-section", () => ({
	StatutoryMonitorFindingsSection: stub("monitor"),
}));

const { ContractsReviewsTab } = await import("./contracts-reviews-tab");

const statutorySections = [
	"minijob",
	"short_term",
	"working_student",
	"on_call",
	"youth_apprentice",
] as const;

function renderTab(search = "") {
	state.search = new URLSearchParams(search);
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	return render(
		<TolgeeProvider tolgee={createTestTolgee("en", {})}>
			<QueryClientProvider client={client}>
				<ContractsReviewsTab organizationId="org-1" organizationTimezone="Europe/Berlin" />
			</QueryClientProvider>
		</TolgeeProvider>,
	);
}

const shown = () =>
	[...statutorySections, "monitor"].filter((name) => screen.queryByTestId(name) !== null);
const migrationShown = () =>
	screen.queryByText("Contract migration and departure reviews") !== null;

describe("ContractsReviewsTab (#1994)", () => {
	afterEach(cleanup);
	beforeEach(() => vi.clearAllMocks());

	it("shows every statutory domain, the monitor findings and migration & departure under All", async () => {
		renderTab();

		expect(shown()).toEqual([...statutorySections, "monitor"]);
		await waitFor(() => expect(migrationShown()).toBe(true));
		for (const name of statutorySections) {
			// Nothing to review in one domain is no reason to show an empty card under All.
			expect(screen.getByTestId(name).dataset.empty).toBe("false");
		}
	});

	it.each(statutorySections)("opens with only the %s domain when deep-linked to it", (domain) => {
		renderTab(`tab=reviews&domain=${domain}`);

		expect(shown()).toEqual([domain, "monitor"]);
		// Its own filter says so when it has nothing to review.
		expect(screen.getByTestId(domain).dataset.empty).toBe("true");
		expect(screen.getByTestId("monitor").dataset.domain).toBe(domain);
		expect(migrationShown()).toBe(false);
	});

	it("keeps the Migration & Departure group working on its own", async () => {
		renderTab("domain=migration_departure");

		expect(shown()).toEqual([]);
		await waitFor(() => expect(migrationShown()).toBe(true));
		expect(screen.getByRole("combobox", { name: "Filter review type" })).toBeTruthy();
	});

	it("falls back to All for an unknown domain", () => {
		renderTab("domain=payroll");

		expect(shown()).toEqual([...statutorySections, "monitor"]);
	});

	it("lists minor contractor engagements with Youth & Apprentice (#2022)", () => {
		renderTab("domain=youth_apprentice");
		expect(screen.getByTestId("minor_contractors").dataset.resolved).toBe("false");
		cleanup();

		renderTab("domain=on_call");
		expect(screen.queryByTestId("minor_contractors")).toBeNull();
		cleanup();

		renderTab();
		fireEvent.click(screen.getByRole("checkbox", { name: "Show resolved" }));
		expect(screen.getByTestId("minor_contractors").dataset.resolved).toBe("true");
	});

	it("hands Show resolved to every statutory section", () => {
		renderTab();
		for (const name of statutorySections) {
			expect(screen.getByTestId(name).dataset.resolved).toBe("false");
		}

		fireEvent.click(screen.getByRole("checkbox", { name: "Show resolved" }));

		for (const name of statutorySections) {
			expect(screen.getByTestId(name).dataset.resolved).toBe("true");
		}
	});
});
