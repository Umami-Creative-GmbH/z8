/* @vitest-environment jsdom */

import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { VacationBalanceCard } from "./vacation-balance-card";

vi.mock("@tolgee/react", () => ({
	useTolgee: () => ({ getLanguage: () => "en" }),
	useTranslate: () => ({
		t: (_key: string, fallback?: string, params?: Record<string, unknown>) => {
			if (!fallback) return _key;
			return fallback.replace(/\{(\w+)\}/g, (_, key) => String(params?.[key] ?? `{${key}}`));
		},
	}),
}));

describe("VacationBalanceCard", () => {
	it("uses a single-column default layout for narrow mobile screens", () => {
		const { container } = render(
			<VacationBalanceCard
				balance={{
					year: 2026,
					totalDays: 30,
					usedDays: 5,
					pendingDays: 2,
					remainingDays: 23,
					carryoverDays: 0,
				}}
			/>,
		);

		const grid = container.querySelector(".\\@container\\/card");
		expect(grid?.className).toContain("grid-cols-1");
		expect(grid?.className).toContain("sm:grid-cols-2");
	});
});
