import { Temporal } from "temporal-polyfill";
import { describe, expect, it } from "vitest";
import { parseSickLeaveOverviewParams } from "./sick-leave-overview";

const today = Temporal.PlainDate.from("2026-10-10");

describe("parseSickLeaveOverviewParams", () => {
	it("defaults to the last 3 months up to the organization's today, all sick leave, first page", () => {
		expect(parseSickLeaveOverviewParams({}, today)).toEqual({
			from: "2026-07-10",
			to: "2026-10-10",
			employeeId: null,
			teamId: null,
			sickDetail: null,
			notes: "all",
			status: null,
			page: 1,
			pageSize: 25,
		});
	});

	it("takes the filters from the URL", () => {
		expect(
			parseSickLeaveOverviewParams(
				{
					from: "2026-01-01",
					to: "2026-03-31",
					employeeId: "e9850000-0000-4000-8000-000000000004",
					teamId: "e9851000-0000-4000-8000-000000000001",
					sickDetail: "with_certificate",
					notes: "missing",
					status: "approved",
					page: "3",
					pageSize: "50",
				},
				today,
			),
		).toEqual({
			from: "2026-01-01",
			to: "2026-03-31",
			employeeId: "e9850000-0000-4000-8000-000000000004",
			teamId: "e9851000-0000-4000-8000-000000000001",
			sickDetail: "with_certificate",
			notes: "missing",
			status: "approved",
			page: 3,
			pageSize: 50,
		});
	});

	it("ignores values it does not know", () => {
		expect(
			parseSickLeaveOverviewParams(
				{
					from: "2026-02-30",
					to: "yesterday",
					employeeId: "not-a-uuid",
					teamId: ["e9851000-0000-4000-8000-000000000001"],
					sickDetail: "flu",
					notes: "maybe",
					status: "rejected",
					page: "-2",
					pageSize: "1000",
				},
				today,
			),
		).toEqual(parseSickLeaveOverviewParams({}, today));
	});

	it("swaps a range given backwards", () => {
		const filters = parseSickLeaveOverviewParams({ from: "2026-09-30", to: "2026-09-01" }, today);
		expect([filters.from, filters.to]).toEqual(["2026-09-01", "2026-09-30"]);
	});

	it("keeps an open end of the range at its default", () => {
		const filters = parseSickLeaveOverviewParams({ from: "2026-01-15" }, today);
		expect([filters.from, filters.to]).toEqual(["2026-01-15", "2026-10-10"]);
	});
});
