/* @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import type React from "react";
import { describe, expect, it, vi } from "vitest";

const tMock = vi.fn((_key: string, fallback: string) => fallback);

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: tMock }),
}));

vi.mock("next/navigation", () => ({
	useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/navigation", () => ({
	useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("@/components/ui/select", () => ({
	Select: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
	SelectContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
	SelectItem: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
	SelectTrigger: ({
		children,
		"aria-label": ariaLabel,
	}: {
		children: React.ReactNode;
		"aria-label"?: string;
	}) => (
		<button aria-label={ariaLabel} type="button">
			{children}
		</button>
	),
	SelectValue: () => null,
}));

import { PlatformAnalyticsControls } from "./analytics-controls";

describe("PlatformAnalyticsControls", () => {
	it("loads filter labels and options through Tolgee translations", () => {
		render(<PlatformAnalyticsControls range="30d" bucket="day" />);

		expect(screen.getByText("Range")).toBeTruthy();
		expect(screen.getByText("Bucket")).toBeTruthy();
		expect(tMock).toHaveBeenCalledWith("admin:admin.analytics.controls.range.label", "Range");
		expect(tMock).toHaveBeenCalledWith("admin:admin.analytics.controls.range.30d", "Last 30 days");
		expect(tMock).toHaveBeenCalledWith("admin:admin.analytics.controls.bucket.day", "Daily");
	});
});
