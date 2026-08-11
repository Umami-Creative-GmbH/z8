/* @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import type React from "react";
import { Suspense } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { tMock, useSearchParamsMock } = vi.hoisted(() => ({
	tMock: vi.fn((_key: string, fallback: string) => fallback),
	useSearchParamsMock: vi.fn(() => new URLSearchParams()),
}));

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: tMock }),
}));

vi.mock("next/navigation", () => ({
	useSearchParams: useSearchParamsMock,
}));

vi.mock("@/navigation", () => ({
	useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("@/components/ui/select", () => ({
	Select: ({ children }: { children: React.ReactNode }) => (
		<div>{children}</div>
	),
	SelectContent: ({ children }: { children: React.ReactNode }) => (
		<div>{children}</div>
	),
	SelectItem: ({ children }: { children: React.ReactNode }) => (
		<div>{children}</div>
	),
	SelectTrigger: ({
		children,
		id,
		"aria-label": ariaLabel,
	}: {
		children: React.ReactNode;
		id?: string;
		"aria-label"?: string;
	}) => (
		<button id={id} aria-label={ariaLabel} type="button">
			{children}
		</button>
	),
	SelectValue: () => null,
}));

import { PlatformAnalyticsControls } from "./analytics-controls";

describe("PlatformAnalyticsControls", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		useSearchParamsMock.mockReturnValue(new URLSearchParams());
	});

	it("loads filter labels and options through Tolgee translations", () => {
		render(<PlatformAnalyticsControls range="30d" bucket="day" />);

		expect(screen.getByText("Range")).toBeTruthy();
		expect(screen.getByText("Bucket")).toBeTruthy();
		expect(screen.getByLabelText("Range")).toBeTruthy();
		expect(screen.getByLabelText("Bucket")).toBeTruthy();
		expect(tMock).toHaveBeenCalledWith(
			"admin:admin.analytics.controls.range.label",
			"Range",
		);
		expect(tMock).toHaveBeenCalledWith(
			"admin:admin.analytics.controls.range.30d",
			"Last 30 days",
		);
		expect(tMock).toHaveBeenCalledWith(
			"admin:admin.analytics.controls.bucket.day",
			"Daily",
		);
	});

	it("lets the parent boundary show a meaningful fallback when URL state suspends", () => {
		const pending = new Promise<never>(() => {});
		useSearchParamsMock.mockImplementation(() => {
			throw pending;
		});

		render(
			<Suspense fallback={<div>Loading analytics filters</div>}>
				<PlatformAnalyticsControls range="30d" bucket="day" />
			</Suspense>,
		);

		expect(screen.getByText("Loading analytics filters")).toBeTruthy();
	});
});
