import { describe, expect, it } from "vitest";
import {
	DEFAULT_FINANCE_QUEUE_VIEW,
	financeQueueSearch,
	parseFinanceQueueView,
} from "./finance-queue-params";

const employeeId = "e7530000-0000-4000-8000-000000000001";
const teamId = "e7531000-0000-4000-8000-000000000001";

describe("finance queue search params (#753)", () => {
	it("opens on the first page of open expenses without filters", () => {
		expect(parseFinanceQueueView(new URLSearchParams())).toEqual(DEFAULT_FINANCE_QUEUE_VIEW);
		expect(DEFAULT_FINANCE_QUEUE_VIEW).toEqual({
			status: "open",
			employeeId: null,
			teamId: null,
			currency: null,
			notExported: false,
			page: 1,
		});
	});

	it("round-trips every filter and the page", () => {
		const view = {
			status: "reimbursed",
			employeeId,
			teamId,
			currency: "CHF",
			notExported: true,
			page: 3,
		} as const;
		const search = financeQueueSearch(view);
		expect(search).toBe(
			`status=reimbursed&employee=${employeeId}&team=${teamId}&currency=CHF&notExported=1&page=3`,
		);
		expect(parseFinanceQueueView(new URLSearchParams(search))).toEqual(view);
	});

	it("leaves defaults out of the URL", () => {
		expect(financeQueueSearch(DEFAULT_FINANCE_QUEUE_VIEW)).toBe("");
	});

	it("ignores values it does not understand", () => {
		expect(
			parseFinanceQueueView(
				new URLSearchParams(
					"status=settled&employee=nope&team=1&currency=eur&notExported=yes&page=-2",
				),
			),
		).toEqual(DEFAULT_FINANCE_QUEUE_VIEW);
		expect(parseFinanceQueueView(new URLSearchParams("page=2.5")).page).toBe(1);
	});
});
