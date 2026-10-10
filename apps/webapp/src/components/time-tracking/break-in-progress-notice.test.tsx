/* @vitest-environment jsdom */

import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BreakInProgressNotice } from "@/components/time-tracking/break-in-progress-notice";
import { render } from "@/test/render-with-translations";

describe("BreakInProgressNotice", () => {
	it("shows since when the employee is on break, in the zone the break started in", async () => {
		render(
			<BreakInProgressNotice
				since={new Date("2026-07-22T09:45:00Z")}
				zone="Europe/Berlin"
				timeFormat="24h"
			/>,
		);

		expect(await screen.findByText("On break since 11:45")).toBeTruthy();
	});

	it("never falls back to the viewer's zone when a break has none recorded (#761)", async () => {
		render(<BreakInProgressNotice since="2026-07-22T09:45:00.000Z" zone={null} timeFormat="24h" />);

		expect(await screen.findByText("On break since 09:45")).toBeTruthy();
	});

	it("follows the 12-hour preference", async () => {
		render(
			<BreakInProgressNotice
				since={new Date("2026-07-22T09:45:00Z")}
				zone="America/New_York"
				timeFormat="12h"
			/>,
		);

		expect(await screen.findByText(/On break since 5:45\sAM/)).toBeTruthy();
	});
});
