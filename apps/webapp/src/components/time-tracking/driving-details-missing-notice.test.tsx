// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { DrivingDetailsMissingNotice } from "./driving-details-missing-notice";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
}));
vi.mock("next-intl", () => ({ useLocale: () => "en" }));
vi.mock("@/navigation", () => ({
	Link: ({ href, children }: { href: string; children: ReactNode }) => (
		<a href={href}>{children}</a>
	),
}));

const work = {
	workPeriodId: "work-1",
	employeeId: "employee-1",
	startedAt: "2026-10-01T06:00:00Z",
	endedAt: "2026-10-01T14:30:00Z",
	startOffsetMinutes: 120,
	endOffsetMinutes: 120,
	workDay: "2026-10-01",
	vehicleUse: {
		vehicle: { kind: "own" as const },
		startKm: 12_000,
		endKm: null,
		distanceKm: null,
	},
};

describe("the driving details missing notice (#1127)", () => {
	it("lists each flagged work period at its recorded local time, what it lacks, and where to complete it", () => {
		render(
			<DrivingDetailsMissingNotice
				work={[work]}
				employeeId="employee-1"
				timeFormat="24h"
				truncated={false}
			/>,
		);

		expect(screen.getByRole("region", { name: "Driving details missing" })).toBeTruthy();
		expect(screen.getByText(/08:00 – 16:30/)).toBeTruthy();
		expect(screen.getByText("No end reading")).toBeTruthy();
		expect(screen.getByRole("link", { name: /Open in calendar/ }).getAttribute("href")).toBe(
			"/calendar/employee-1?date=2026-10-01",
		);
	});

	it("renders nothing without flagged work", () => {
		const { container } = render(
			<DrivingDetailsMissingNotice
				work={[]}
				employeeId="employee-1"
				timeFormat="24h"
				truncated={false}
			/>,
		);
		expect(container.innerHTML).toBe("");
	});
});
