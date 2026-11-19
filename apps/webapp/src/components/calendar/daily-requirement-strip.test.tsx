/** @vitest-environment jsdom */

import { describe, expect, it, vi } from "vitest";
import type { DailyWorkHoursSummary } from "@/lib/calendar/types";
import {
	buildRequirementHeaderContent,
	getRequirementStatusLabel,
} from "./daily-requirement-strip";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string, params?: Record<string, string>) => {
			if (!params) return fallback;
			return Object.entries(params).reduce(
				(text, [key, value]) => text.replaceAll(`{${key}}`, value),
				fallback,
			);
		},
	}),
}));

const standard = { requiredMinutes: 480, policyId: "policy-1", policyName: "Standard" };

const baseSummary: DailyWorkHoursSummary = {
	actualMinutes: 573,
	includesLiveWork: false,
	requirement: { ...standard, deltaMinutes: 93, status: "over" },
};

const fallbackOnly = (_key: string, fallback: string) => fallback;
// Interpolates {name} placeholders like Tolgee does for a missing translation.
const interpolating = (_key: string, fallback: string, params?: Record<string, string>) =>
	Object.entries(params ?? {}).reduce(
		(text, [key, value]) => text.replaceAll(`{${key}}`, value),
		fallback,
	);

describe("requirement header helpers", () => {
	it("builds compact header content for an over-requirement day", () => {
		const content = buildRequirementHeaderContent(baseSummary, "Friday, May 22", interpolating);

		expect(content.requiredHours).toBe("8h 00m");
		expect(content.deltaHours).toBe("+1h 33m");
		expect(content.status).toBe("over");
		expect(content.liveLabel).toBeNull();
		expect(content.accessibleLabel).toBe(
			"Friday, May 22: 8h 00m required, 9h 33m recorded, +1h 33m delta, over requirement",
		);
	});

	it("omits the visible delta when the requirement is exactly met", () => {
		const content = buildRequirementHeaderContent(
			{
				actualMinutes: 480,
				includesLiveWork: false,
				requirement: { ...standard, deltaMinutes: 0, status: "met" },
			},
			"Friday, May 22",
			fallbackOnly,
		);

		expect(content.deltaHours).toBeNull();
		expect(content.status).toBe("met");
	});

	it("shows only the recorded total on a day without required hours", () => {
		const content = buildRequirementHeaderContent(
			{ actualMinutes: 150, includesLiveWork: false, requirement: null },
			"Saturday, May 23",
			interpolating,
		);

		expect(content).toEqual({
			requiredHours: null,
			actualHours: "2h 30m",
			deltaHours: null,
			status: null,
			liveLabel: null,
			accessibleLabel: "Saturday, May 23: 2h 30m recorded",
		});
	});

	it("tells that a total still counts running work", () => {
		const content = buildRequirementHeaderContent(
			{ ...baseSummary, includesLiveWork: true },
			"Friday, May 22",
			interpolating,
		);

		expect(content.liveLabel).toBe("Includes running work");
		expect(content.accessibleLabel).toBe(
			"Friday, May 22: 8h 00m required, 9h 33m recorded, +1h 33m delta, over requirement. Includes running work",
		);
	});

	it("labels missing recorded time", () => {
		const label = getRequirementStatusLabel("missing", fallbackOnly);

		expect(label).toBe("missing recorded time");
	});
});
