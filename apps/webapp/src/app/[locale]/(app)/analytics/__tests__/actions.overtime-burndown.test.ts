import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/effect/runtime", () => ({
	AppLayer: {},
}));

vi.mock("@/lib/effect/services/auth.service", () => ({
	AuthService: Symbol.for("AuthService"),
}));

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
