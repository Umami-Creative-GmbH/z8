import { describe, expect, it, vi } from "vitest";
import { findAnalyticsEmployeeByUserId } from "./current-employee-scope";

describe("findAnalyticsEmployeeByUserId", () => {
	it("does not fall back to another organization when no active organization is set", async () => {
		const findFirst = vi.fn();

		const employee = await findAnalyticsEmployeeByUserId(
			{ query: { employee: { findFirst } } },
			"user-1",
			null,
		);

		expect(employee).toBeNull();
		expect(findFirst).not.toHaveBeenCalled();
	});
});
