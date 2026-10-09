import { describe, expect, it } from "vitest";
import { parseOnBehalfClockOutRequest } from "./on-behalf-clock-out-request";

const workPeriodId = "a0000000-0000-4000-8000-000000000001";

describe("parseOnBehalfClockOutRequest", () => {
	it("keeps an explicit billable choice (#900)", () => {
		expect(
			parseOnBehalfClockOutRequest({ workPeriodId, projectId: "p-1", billable: true }),
		).toEqual({ workPeriodId, projectId: "p-1", billable: true });
	});

	it("leaves billability out when the request does not choose it", () => {
		expect(parseOnBehalfClockOutRequest({ workPeriodId })).toEqual({ workPeriodId });
	});

	it("refuses a billable choice that is not a boolean", () => {
		expect(parseOnBehalfClockOutRequest({ workPeriodId, billable: "true" })).toBeNull();
	});
});
