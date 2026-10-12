import { describe, expect, it, vi } from "vitest";

vi.mock("@/db", () => ({ db: {} }));

const { defaultAbsenceCategories } = await import("./default-absence-categories");

describe("built-in absence categories of a new organization", () => {
	it("include time off in lieu, drawing on the work balance and requiring approval", () => {
		expect(
			defaultAbsenceCategories.find((category) => category.type === "time_off_in_lieu"),
		).toEqual(
			expect.objectContaining({
				name: "Time off in lieu",
				description: "Time off taken against the work balance",
				drawsOnWorkBalance: true,
				requiresApproval: true,
				countsAgainstVacation: false,
				requiresWorkTime: false,
			}),
		);
	});

	it("draw on the work balance only for time off in lieu", () => {
		expect(
			defaultAbsenceCategories
				.filter((category) => category.drawsOnWorkBalance)
				.map((category) => category.type),
		).toEqual(["time_off_in_lieu"]);
	});
});
