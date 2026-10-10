// @vitest-environment jsdom

import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { Temporal } from "temporal-polyfill";
import { describe, expect, it, vi } from "vitest";
import {
	parseSickLeaveOverviewParams,
	type SickLeaveOverviewRow,
} from "@/lib/personnel-file/sick-leave-overview";
import { SickLeaveOverview } from "./sick-leave-overview";

const navigation = vi.hoisted(() => ({ push: vi.fn(), search: "" }));

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
}));
vi.mock("@/components/providers/app-locale-provider", () => ({ useAppLocale: () => "en-GB" }));
vi.mock("next/navigation", () => ({
	useSearchParams: () => new URLSearchParams(navigation.search),
}));
vi.mock("@/navigation", () => ({
	Link: ({
		href,
		children,
		className,
	}: {
		href: string;
		children: ReactNode;
		className?: string;
	}) => (
		<a href={href} className={className}>
			{children}
		</a>
	),
	useRouter: () => ({ push: navigation.push }),
}));

const today = Temporal.PlainDate.from("2026-10-10");
const defaults = parseSickLeaveOverviewParams({}, today);

function row(overrides: Partial<SickLeaveOverviewRow>): SickLeaveOverviewRow {
	return {
		absenceId: "a1",
		employeeId: "e9850000-0000-4000-8000-000000000004",
		employeeName: "Anna Example",
		employeeNumber: null,
		isFormer: false,
		startDate: "2026-09-01",
		startPeriod: "full_day",
		endDate: "2026-09-02",
		endPeriod: "full_day",
		status: "approved",
		sickDetail: "with_certificate",
		absenceDays: 2,
		sickNoteCount: 0,
		sickNotes: [],
		...overrides,
	};
}

function renderOverview(rows: SickLeaveOverviewRow[], page = { page: 1, pageCount: 1 }) {
	return render(
		<SickLeaveOverview
			filters={{ ...defaults, page: page.page }}
			defaultRange={{ from: defaults.from, to: defaults.to }}
			rows={rows}
			total={rows.length}
			page={page.page}
			pageCount={page.pageCount}
			employees={[]}
			teams={[]}
		/>,
	);
}

describe("SickLeaveOverview", () => {
	it("lists each absence with its employee's sick note file, its notes to open and former employees marked", () => {
		renderOverview([
			row({
				absenceId: "a1",
				sickNoteCount: 1,
				sickNotes: [{ id: "d1", title: "Certificate September" }],
			}),
			row({
				absenceId: "a2",
				employeeId: "e9850000-0000-4000-8000-000000000006",
				employeeName: "Lea Leaver",
				isFormer: true,
				sickDetail: "without_certificate",
			}),
		]);

		const [, anna, lea] = screen.getAllByRole("row");
		expect(within(anna).getByRole("link", { name: "Anna Example" }).getAttribute("href")).toBe(
			"/personnel-files/e9850000-0000-4000-8000-000000000004?category=sick_note",
		);
		expect(within(anna).getByRole("link", { name: "Open {title}" }).getAttribute("href")).toBe(
			"/api/personnel-files/documents/d1",
		);
		expect(within(anna).getByText("With certificate")).toBeTruthy();
		expect(within(lea).getByText("Former employee")).toBeTruthy();
		expect(within(lea).getByText("No note")).toBeTruthy();
		expect(within(lea).getByText("Without certificate")).toBeTruthy();
	});

	it("pages through the URL, keeping the filters", () => {
		navigation.search = "notes=missing";
		renderOverview([row({})], { page: 1, pageCount: 3 });

		fireEvent.click(screen.getByRole("button", { name: "Next page" }));

		expect(navigation.push).toHaveBeenCalledWith(
			"/personnel-files/sick-leave?notes=missing&page=2",
		);
	});
});
