/* @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { UserPreferencesProvider, useTimeFormat } from "./user-preferences-provider";

function TimeFormatProbe() {
	return <div data-testid="time-format">{useTimeFormat()}</div>;
}

describe("UserPreferencesProvider", () => {
	it("provides the default time format", () => {
		render(
			<UserPreferencesProvider>
				<TimeFormatProbe />
			</UserPreferencesProvider>,
		);

		expect(screen.getByTestId("time-format").textContent).toBe("24h");
	});

	it("provides a normalized time format", () => {
		render(
			<UserPreferencesProvider timeFormat="12h">
				<TimeFormatProbe />
			</UserPreferencesProvider>,
		);

		expect(screen.getByTestId("time-format").textContent).toBe("12h");
	});
});
