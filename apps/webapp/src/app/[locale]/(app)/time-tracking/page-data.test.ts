import { type ReactElement, Suspense } from "react";
import { describe, expect, it, vi } from "vitest";
import TimeTrackingPage from "./page";
import type { TimeTrackingPageSearchParams } from "./page-data";
import {
	ClockLoading,
	HistoryLoading,
	SummaryLoading,
	TimelineLoading,
} from "./region-fallbacks";
import { TimeTrackingPageContent } from "./regions";

vi.mock("./regions", () => ({ TimeTrackingPageContent: () => null }));
vi.mock("@/navigation", () => ({ useRouter: vi.fn() }));

describe("time tracking page identity boundary", () => {
	it("keeps pending date parameters below the outer identity boundary", () => {
		const params = Promise.withResolvers<TimeTrackingPageSearchParams>();
		const page = TimeTrackingPage({ searchParams: params.promise });
		expect(page.type).toBe(Suspense);
		expect(page.props.children.type).toBe(TimeTrackingPageContent);
		expect(page.props.children.props.searchParams).toBe(params.promise);
		const fallback = page.props.fallback.type() as ReactElement<{
			children: ReactElement[];
			className: string;
		}>;
		expect(fallback.props.className).toBe(
			"@container/main flex flex-1 flex-col gap-6 py-4 md:py-6",
		);
		expect(fallback.props.children.map((region) => region.type)).toEqual([
			ClockLoading,
			TimelineLoading,
			SummaryLoading,
			HistoryLoading,
		]);
	});
});
