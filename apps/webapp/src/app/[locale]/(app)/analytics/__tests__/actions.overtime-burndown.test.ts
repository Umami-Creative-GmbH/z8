import { describe, expect, it } from "vitest";

import { getOvertimeBurnDownData } from "../actions";
import type {
	DateRange,
	OvertimeBurnDownData,
	OvertimeBurnDownParams,
} from "@/lib/analytics/types";
import type { ServerActionResult } from "@/lib/effect/result";

describe("analytics overtime burn-down action", () => {
	it("exports getOvertimeBurnDownData as a function", () => {
		expect(typeof getOvertimeBurnDownData).toBe("function");
	});

	it("matches the expected action signature", () => {
		type ExpectedActionSignature = (
			dateRange: DateRange,
			filters?: OvertimeBurnDownParams["filters"],
		) => Promise<ServerActionResult<OvertimeBurnDownData>>;

		const action: ExpectedActionSignature = getOvertimeBurnDownData;

		expect(typeof action).toBe("function");
	});
});
