/* @vitest-environment jsdom */

import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { render } from "@/test/render-with-translations";
import { VacationBalanceCard } from "./vacation-balance-card";

describe("VacationBalanceCard", () => {
	it("uses a single-column default layout for narrow mobile screens", () => {
		const { container } = render(
			<VacationBalanceCard
				now="2026-07-14T10:00:00Z"
				timezone="Europe/Berlin"
				balance={{
					year: 2026,
					totalDays: 30,
					usedDays: 5,
					pendingDays: 2,
					remainingDays: 23,
					overdrawnDays: 0,
					carryoverDays: 0,
				}}
			/>,
		);

		const grid = container.querySelector(".\\@container\\/card");
		expect(grid?.className).toContain("grid-cols-1");
		expect(grid?.className).toContain("sm:grid-cols-2");
	});

	it("formats carryover expiry in the organization timezone", () => {
		render(
			<VacationBalanceCard
				now="2026-03-01T10:00:00Z"
				timezone="Europe/Berlin"
				balance={{
					year: 2026,
					totalDays: 35,
					usedDays: 5,
					pendingDays: 0,
					remainingDays: 30,
					overdrawnDays: 0,
					carryoverDays: 5,
					carryoverExpiryDate: new Date("2026-03-31T21:59:59.999Z"),
				}}
			/>,
		);

		expect(screen.getByText(/Mar 31, 2026/u)).toBeTruthy();
	});

	it("explains a prorated allowance to the employee, without showing overdrawn vacation (#1111)", () => {
		render(
			<VacationBalanceCard
				now="2026-11-02T10:00:00Z"
				timezone="Europe/Berlin"
				balance={{
					year: 2026,
					totalDays: 8,
					usedDays: 10,
					pendingDays: 0,
					remainingDays: 0,
					overdrawnDays: 2,
					allowance: {
						fullAllowance: 30,
						allowance: 8,
						reason: {
							kind: "prorated",
							cappedAtFullAllowance: false,
							employments: [
								{
									kind: "start",
									startDate: "2026-10-01",
									lastWorkingDay: null,
									employmentMonths: 3,
									days: 8,
									floorApplied: false,
								},
							],
						},
					},
				}}
			/>,
		);

		expect(
			screen.getByText("8 of 30 days, prorated: started Oct 1, 2026, 3 full employment months"),
		).toBeTruthy();
		expect(screen.queryByText(/overdrawn/u)).toBeNull();
	});
});
