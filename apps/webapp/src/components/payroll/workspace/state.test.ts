import { describe, expect, it, vi } from "vitest";
import { parsePlainDate } from "@/lib/datetime/temporal-core";
import type { PayrollWorkspaceSummary } from "@/lib/payroll-workspace/types";
import {
	buildPeriodRequest,
	formatDisplayedPeriod,
	formatPeriodLabel,
	startOfPayrollPeriod,
} from "./state";
import { payrollPeriodActions } from "./use-payroll-summary";

describe("payroll workspace period state (Temporal + locale)", () => {
	it("computes ISO Monday week starts across month and year boundaries", () => {
		// 2026-01-01 is a Thursday -> ISO week starts Monday 2025-12-29
		expect(startOfPayrollPeriod(parsePlainDate("2026-01-01"), "week").toString()).toBe(
			"2025-12-29",
		);
		// 2026-03-29 is a Sunday (DST spring-forward day in Europe/Berlin) -> week starts Monday 2026-03-23
		expect(startOfPayrollPeriod(parsePlainDate("2026-03-29"), "week").toString()).toBe(
			"2026-03-23",
		);
	});

	it("builds month and week period requests with German (de) and English (en) labels", () => {
		const marchEn = buildPeriodRequest(parsePlainDate("2026-03-15"), "month", "en");
		const marchDe = buildPeriodRequest(parsePlainDate("2026-03-15"), "month", "de");

		expect(marchEn).toEqual({
			startDate: "2026-03-01",
			endDate: "2026-03-31",
			label: "March 2026",
		});
		expect(marchDe).toEqual({
			startDate: "2026-03-01",
			endDate: "2026-03-31",
			label: "März 2026",
		});

		const weekEn = buildPeriodRequest(parsePlainDate("2026-03-29"), "week", "en");
		const weekDe = buildPeriodRequest(parsePlainDate("2026-03-29"), "week", "de");
		expect(weekEn.startDate).toBe("2026-03-23");
		expect(weekEn.endDate).toBe("2026-03-29");
		expect(weekEn.label).toContain("Mar");
		expect(weekDe.label).toContain("März");
	});

	it("formats custom and displayed periods in de and en", () => {
		expect(
			formatPeriodLabel(parsePlainDate("2026-10-01"), parsePlainDate("2026-10-31"), "custom"),
		).toBe("2026-10-01 - 2026-10-31");
		expect(formatDisplayedPeriod("2026-10-01", "2026-10-31", "month", "en")).toBe("October 2026");
		expect(formatDisplayedPeriod("2026-10-01", "2026-10-31", "month", "de")).toBe("Oktober 2026");
	});

	it("preserves active German locale across payroll period navigation actions", () => {
		const refreshSummary = vi.fn();
		const dispatch = vi.fn();
		const summary = {
			period: {
				start: "2026-02-01",
				end: "2026-02-28",
				label: "Februar 2026",
			},
		} as unknown as PayrollWorkspaceSummary;

		const actions = payrollPeriodActions({
			dateMode: "month",
			dispatch,
			endDate: "2026-03-31",
			filteredEmployeeIds: undefined,
			locale: "de",
			refreshSummary,
			startDate: "2026-03-01",
			summary,
		});

		actions.navigatePeriod("next");
		expect(refreshSummary).toHaveBeenLastCalledWith({
			startDate: "2026-03-01",
			endDate: "2026-03-31",
			label: "März 2026",
		});

		actions.applyDateMode("month");
		const modeReq = refreshSummary.mock.calls.at(-1)?.[0];
		expect(modeReq.label).toBe(
			formatPeriodLabel(
				parsePlainDate(modeReq.startDate),
				parsePlainDate(modeReq.endDate),
				"month",
				"de",
			),
		);

		actions.returnToCurrentPeriod();
		const currentReq = refreshSummary.mock.calls.at(-1)?.[0];
		expect(currentReq.label).toBe(
			formatPeriodLabel(
				parsePlainDate(currentReq.startDate),
				parsePlainDate(currentReq.endDate),
				"month",
				"de",
			),
		);

		// Clearing a custom date input still delegates cleanly to refreshSummary without throwing
		const blankCustom = payrollPeriodActions({
			dateMode: "custom",
			dispatch,
			endDate: "",
			filteredEmployeeIds: undefined,
			locale: "de",
			refreshSummary,
			startDate: "",
			summary,
		});
		expect(() => blankCustom.applyCustomRange()).not.toThrow();
		expect(refreshSummary).toHaveBeenLastCalledWith({
			startDate: "",
			endDate: "",
			label: " - ",
		});
	});
});
