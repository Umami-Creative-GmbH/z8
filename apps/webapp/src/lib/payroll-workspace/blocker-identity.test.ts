import { describe, expect, expectTypeOf, it } from "vitest";
import {
	type PayrollBlockerIdentity,
	payrollBlockerIdentity,
} from "./blocker-identity";

describe("payrollBlockerIdentity", () => {
	it("combines blocker type and source ID into a collision-safe typed key", () => {
		const identity = payrollBlockerIdentity({
			id: "11111111-1111-4111-8111-111111111111",
			type: "pending_absence",
		});

		expect(identity).toBe(
			"pending_absence:11111111-1111-4111-8111-111111111111",
		);
		expectTypeOf(identity).toEqualTypeOf<PayrollBlockerIdentity>();
	});
});
