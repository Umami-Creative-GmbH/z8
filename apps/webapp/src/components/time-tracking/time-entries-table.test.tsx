/* @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { TimeEntriesTable } from "./time-entries-table";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, defaultValue?: string) => defaultValue ?? _key,
	}),
}));

vi.mock("next/dynamic", () => ({
	default: (loader: () => Promise<unknown>) => {
		void loader;
		return function DynamicMock() {
			return <button type="button">Add manual entry</button>;
		};
	},
}));

vi.mock("@/navigation", () => ({
	Link: ({ href, children, ...props }: { href: string; children: ReactNode }) => (
		<a href={href} {...props}>
			{children}
		</a>
	),
	useRouter: () => ({
		refresh: vi.fn(),
	}),
}));

vi.mock("@/components/data-table-server", () => ({
	DataTable: () => <div data-testid="data-table" />,
}));

vi.mock("@/components/time-tracking/time-entries-table-columns", () => ({
	getTimeEntriesColumns: () => [],
}));

vi.mock("@/app/[locale]/(app)/time-tracking/actions/mutations", () => ({
	approveWorkPeriod: vi.fn(),
}));

describe("TimeEntriesTable", () => {
	it("links to the calendar from the table header", () => {
		render(
			<TimeEntriesTable
				workPeriods={[]}
				hasManager={false}
				canApproveTimeEntries={false}
				employeeTimezone="Europe/Berlin"
				timeFormat="24h"
				employeeId="employee-1"
			/>,
		);

		expect(screen.getByRole("link", { name: "View Calendar" }).getAttribute("href")).toBe(
			"/calendar",
		);
	});
});
