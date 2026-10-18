// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	type ManagedDocumentRequestView,
	parseDocumentRequestOverviewParams,
} from "@/lib/personnel-file/document-request-overview";
import { DocumentRequestsOverview } from "./document-requests-overview";

const navigation = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn(), search: "" }));

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string, params?: Record<string, string | number>) =>
			fallback.replace(/\{(\w+)\}/g, (match, name: string) => String(params?.[name] ?? match)),
	}),
}));
vi.mock("@/components/providers/app-locale-provider", () => ({ useAppLocale: () => "en-GB" }));
vi.mock("next/navigation", () => ({
	useSearchParams: () => new URLSearchParams(navigation.search),
}));
vi.mock("@/navigation", () => ({
	Link: ({ href, children }: { href: string; children: ReactNode }) => (
		<a href={href}>{children}</a>
	),
	useRouter: () => ({ push: navigation.push, refresh: navigation.refresh }),
}));
vi.mock("@/app/[locale]/(app)/personnel-files/document-request-actions", () => ({
	editDocumentRequestAction: vi.fn(),
	cancelDocumentRequestAction: vi.fn(),
}));

function request(overrides: Partial<ManagedDocumentRequestView>): ManagedDocumentRequestView {
	return {
		id: "r1",
		employeeId: "e1403000-0000-4000-8000-000000000004",
		employeeName: "Anna Example",
		employeeNumber: null,
		isFormer: false,
		category: "certificate",
		title: "First aid refresher",
		note: null,
		deadline: "2026-10-10",
		status: "open",
		overdue: true,
		version: 1,
		renewedDocument: null,
		createdByName: "Otto Officer",
		createdAt: "2026-10-01T08:00:00Z",
		history: [],
		submissions: [],
		...overrides,
	};
}

function renderOverview(
	rows: ManagedDocumentRequestView[],
	options: { search?: string; pageCount?: number } = {},
) {
	navigation.search = options.search ?? "";
	const filters = parseDocumentRequestOverviewParams(
		Object.fromEntries(new URLSearchParams(navigation.search)),
	);
	return render(
		<DocumentRequestsOverview
			filters={filters}
			rows={rows}
			total={rows.length}
			page={filters.page}
			pageCount={options.pageCount ?? 1}
			today="2026-10-18"
			timezone="Europe/Berlin"
		/>,
	);
}

beforeEach(() => {
	navigation.push.mockReset();
});

describe("DocumentRequestsOverview", () => {
	it("lists each request with its employee's file, overdue and former employees marked", () => {
		renderOverview([
			request({}),
			request({
				id: "r2",
				employeeId: "e1403000-0000-4000-8000-000000000006",
				employeeName: "Lea Leaver",
				isFormer: true,
				title: "Driving licence",
				status: "submitted",
				overdue: false,
			}),
		]);
		expect(screen.getByRole("link", { name: "Anna Example" }).getAttribute("href")).toBe(
			"/personnel-files/e1403000-0000-4000-8000-000000000004",
		);
		expect(screen.getByText("Overdue")).toBeTruthy();
		expect(screen.getByText("Former employee")).toBeTruthy();
		expect(screen.getByRole("button", { name: "Change First aid refresher" })).toBeTruthy();
		expect(screen.getByRole("button", { name: "Cancel Driving licence" })).toBeTruthy();
	});

	it("filters to overdue requests through the URL, keeping the status", () => {
		renderOverview([request({})], { search: "status=all&page=2" });
		fireEvent.click(screen.getByRole("button", { name: "Only overdue" }));
		expect(navigation.push).toHaveBeenCalledWith(
			"/personnel-files/document-requests?status=all&overdue=1",
		);
	});

	it("drops the overdue filter when it is switched off", () => {
		renderOverview([request({})], { search: "overdue=1" });
		const toggle = screen.getByRole("button", { name: "Only overdue" });
		expect(toggle.getAttribute("aria-pressed")).toBe("true");
		fireEvent.click(toggle);
		expect(navigation.push).toHaveBeenCalledWith("/personnel-files/document-requests");
	});

	it("says when nothing matches the filters", () => {
		renderOverview([], { search: "overdue=1" });
		expect(screen.getByText("No document requests match the filters.")).toBeTruthy();
	});
});
