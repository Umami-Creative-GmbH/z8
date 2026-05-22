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

const baseSummary: DailyWorkHoursSummary = {
	requiredMinutes: 480,
	actualMinutes: 573,
	deltaMinutes: 93,
	status: "over",
	policyId: "policy-1",
	policyName: "Standard",
};

describe("requirement header helpers", () => {
	it("builds compact header content for an over-requirement day", () => {
		const content = buildRequirementHeaderContent(
			baseSummary,
			"Friday, May 22",
			(_key, fallback) => fallback,
		);

		expect(content.requiredHours).toBe("8:00h");
		expect(content.deltaHours).toBe("+1:33h");
		expect(content.status).toBe("over");
		expect(content.accessibleLabel).toBe(
			"Friday, May 22: 8:00h required, 9:33h recorded, +1:33h delta, over requirement",
		);
	});

	it("omits the visible delta when the requirement is exactly met", () => {
		const content = buildRequirementHeaderContent(
			{ ...baseSummary, actualMinutes: 480, deltaMinutes: 0, status: "met" },
			"Friday, May 22",
			(_key, fallback) => fallback,
		);

		expect(content.deltaHours).toBeNull();
		expect(content.status).toBe("met");
	});

	it("labels missing recorded time", () => {
		const label = getRequirementStatusLabel(
			{ ...baseSummary, actualMinutes: 0, deltaMinutes: -480, status: "missing" },
			(_key, fallback) => fallback,
		);

		expect(label).toBe("missing recorded time");
	});
});
