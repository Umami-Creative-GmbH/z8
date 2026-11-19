/* @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppLocaleProvider } from "@/components/providers/app-locale-provider";
import { UserPreferencesProvider } from "@/components/providers/user-preferences-provider";
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

function withPreferences(
	children: ReactNode,
	{ locale = "en", timeFormat = "24h" }: { locale?: string; timeFormat?: "12h" | "24h" } = {},
) {
	return (
		<AppLocaleProvider locale={locale}>
			<UserPreferencesProvider timeFormat={timeFormat}>{children}</UserPreferencesProvider>
		</AppLocaleProvider>
	);
}

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
			withPreferences(<TimezoneSettings currentTimezone="Europe/Berlin" onUpdate={vi.fn()} />),
		);

		expect(html).toContain("Current time in Europe/Berlin:");
		expect(html).not.toContain("May 30, 2026");
		expect(html).not.toContain("14:34");
	});

	it("shows the current time in the selected zone with the 24-hour preference after mount", () => {
		render(
			withPreferences(<TimezoneSettings currentTimezone="Europe/Berlin" onUpdate={vi.fn()} />),
		);

		expect(screen.getByText(/May 30, 2026, 14:34/)).toBeTruthy();
	});

	it("honors the 12-hour preference", () => {
		render(
			withPreferences(<TimezoneSettings currentTimezone="Europe/Berlin" onUpdate={vi.fn()} />, {
				timeFormat: "12h",
			}),
		);

		expect(screen.getByText(/May 30, 2026, 2:34\s?PM/)).toBeTruthy();
	});

	it("formats the current time in the app language", () => {
		render(
			withPreferences(<TimezoneSettings currentTimezone="America/New_York" onUpdate={vi.fn()} />, {
				locale: "de",
			}),
		);

		expect(screen.getByText(/30\. Mai 2026, 08:34/)).toBeTruthy();
	});
});
