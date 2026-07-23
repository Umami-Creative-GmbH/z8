/* @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { TimeEntriesTable } from "./time-entries-table";

const mocks = vi.hoisted(() => ({ approveWorkPeriod: vi.fn() }));

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
	Link: ({
		href,
		children,
		...props
	}: {
		href: string;
		children: ReactNode;
	}) => (
		<a href={href} {...props}>
			{children}
		</a>
	),
	useRouter: () => ({
		refresh: vi.fn(),
	}),
}));

vi.mock("next-intl", () => ({
	useLocale: () => "en-US",
}));

vi.mock("@/components/data-table-server", () => ({
	DataTable: ({
		columns,
		data,
	}: {
		columns: Array<{ cell?: (row: unknown) => ReactNode }>;
		data: unknown[];
	}) => (
		<div data-testid="data-table">
			{data[0] ? columns[0]?.cell?.(data[0]) : null}
		</div>
	),
}));

vi.mock("@/components/time-tracking/time-entries-table-columns", () => ({
	getTimeEntriesColumns: (options: {
		renderAdminAction?: (row: unknown) => ReactNode;
	}) => [{ cell: options.renderAdminAction }],
}));

vi.mock("@/app/[locale]/(app)/time-tracking/actions/mutations", () => ({
	approveWorkPeriod: mocks.approveWorkPeriod,
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

		expect(
			screen.getByRole("link", { name: "View Calendar" }).getAttribute("href"),
		).toBe("/calendar");
	});

	it("submits the exact stable approval target from the row", async () => {
		mocks.approveWorkPeriod.mockResolvedValue({
			success: true,
			data: { workPeriodId: "period-1" },
		});
		render(
			<TimeEntriesTable
				workPeriods={[
					{
						id: "period-1",
						approvalRequestId: "assignment-1",
						startTime: new Date("2026-07-23T08:00:00Z"),
						endTime: new Date("2026-07-23T16:00:00Z"),
						durationMinutes: 480,
						approvalStatus: "pending",
						clockIn: {
							id: "in-1",
							isSuperseded: false,
							notes: null,
							utcOffsetMinutes: 120,
						},
						clockOut: {
							id: "out-1",
							isSuperseded: false,
							notes: null,
							utcOffsetMinutes: 120,
						},
					},
				]}
				hasManager
				canApproveTimeEntries
				employeeTimezone="Europe/Berlin"
				timeFormat="24h"
				employeeId="employee-1"
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "Time entry actions" }));
		fireEvent.click(await screen.findByText("Approve entry"));

		await waitFor(() =>
			expect(mocks.approveWorkPeriod).toHaveBeenCalledWith({
				workPeriodId: "period-1",
				approvalRequestId: "assignment-1",
			}),
		);
	});
});
