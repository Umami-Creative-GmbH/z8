import { describe, expect, it } from "vitest";

import {
	travelExpenseAttachment,
	travelExpenseClaim,
	travelExpenseDecisionLog,
	travelExpensePolicy,
} from "../travel-expense";

describe("travel-expense schema", () => {
	it("exports all travel expense tables", () => {
		expect(travelExpenseClaim).toBeDefined();
		expect(travelExpenseAttachment).toBeDefined();
		expect(travelExpensePolicy).toBeDefined();
		expect(travelExpenseDecisionLog).toBeDefined();
	});
});
