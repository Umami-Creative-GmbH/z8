/* @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TimezoneSettings } from "./timezone-settings";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback?: string, params?: Record<string, string>) =>
			(fallback ?? _key).replace("{timezone}", params?.timezone ?? ""),
	}),
}));

vi.mock("sonner", () => ({
	toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("./timezone-picker", () => ({
	TimezonePicker: ({ value }: { value: string }) => <div>Timezone picker: {value}</div>,
}));

describe("TimezoneSettings", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-05-30T12:34:00.000Z"));
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("does not include the changing current time in server-rendered markup", () => {
		const html = renderToString(
			<TimezoneSettings currentTimezone="Europe/Berlin" onUpdate={vi.fn()} />,
		);

		expect(html).toContain("Current time in Europe/Berlin:");
		expect(html).not.toContain("May 30, 2026");
		expect(html).not.toContain("2:34 PM");
	});

	it("shows the current time after the component mounts", () => {
		render(<TimezoneSettings currentTimezone="Europe/Berlin" onUpdate={vi.fn()} />);

		expect(screen.getByText(/May 30, 2026, 2:34 PM/)).toBeTruthy();
	});
});
