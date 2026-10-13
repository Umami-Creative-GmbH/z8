/* @vitest-environment jsdom */

import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
	buildVehicleUseReview,
	type VehicleUseReviewSource,
} from "@/lib/works-council/vehicle-use-review";
import { createTestTolgee, render } from "@/test/render-with-translations";
import { VehicleUseReviewSection } from "./vehicle-use-review-section";

const source: VehicleUseReviewSource = {
	settings: { enabled: true },
	assignments: [
		{
			id: "a-org",
			assignmentType: "organization",
			teamId: null,
			employeeId: null,
			mode: "asked",
		},
		{
			id: "a-team",
			assignmentType: "team",
			teamId: "t",
			teamName: "Field service",
			employeeId: null,
			mode: "expected",
		},
		{
			id: "a-ben",
			assignmentType: "employee",
			teamId: null,
			employeeId: "e-ben",
			mode: "off",
		},
	],
	employees: [
		{ employeeId: "e-anna", teamId: "t" },
		{ employeeId: "e-carl", teamId: "t" },
		{ employeeId: "e-dora", teamId: null },
		{ employeeId: "e-ben", teamId: null },
	],
	employeeNames: { "e-ben": "Ben Office" },
	vehicles: { active: 4, archived: 1 },
};

async function renderSection(
	identityVisibility: "aggregated" | "pseudonymized" | "named",
	minimumAggregationThreshold = 1,
) {
	const review = buildVehicleUseReview(source, {
		identityVisibility,
		minimumAggregationThreshold,
	});
	return render(<VehicleUseReviewSection review={review} t={createTestTolgee().t} />);
}

describe("VehicleUseReviewSection", () => {
	it("shows the switch, assignments with their mode, covered employees and vehicle count read-only", async () => {
		await renderSection("named");

		const section = screen.getByRole("region", { name: "Vehicle use" });
		expect(within(section).getByText("Vehicle use").tagName).toBe("H2");
		expect(within(section).getByText("Switch").nextElementSibling?.textContent).toBe("On");
		expect(within(section).getByText("Whole organization").nextElementSibling?.textContent).toBe(
			"Asked",
		);
		const team = within(section).getByText("Field service").closest("li");
		expect(team?.textContent).toContain("Expected");
		const ben = within(section).getByText("Ben Office").closest("li");
		expect(ben?.textContent).toContain("Off");
		expect(within(screen.getByLabelText("Asked of")).getByText("1")).toBeTruthy();
		expect(within(screen.getByLabelText("Expected of")).getByText("2")).toBeTruthy();
		expect(within(screen.getByLabelText("Active vehicles")).getByText("4")).toBeTruthy();
		expect(within(screen.getByLabelText("Archived vehicles")).getByText("1")).toBeTruthy();
		// Nothing editable.
		expect(within(section).queryByRole("button")).toBeNull();
		expect(within(section).queryByRole("textbox")).toBeNull();
		expect(within(section).queryByRole("checkbox")).toBeNull();
		expect(within(section).queryByRole("switch")).toBeNull();
	});

	it("only counts employee assignments when identities are aggregated", async () => {
		const { container } = await renderSection("aggregated");

		expect(container.textContent).not.toMatch(/Ben/);
		expect(screen.getByText("0 asked, 0 expected, 1 off individually")).toBeTruthy();
	});

	it("uses pseudonyms when identities are pseudonymized", async () => {
		const { container } = await renderSection("pseudonymized");

		expect(container.textContent).not.toMatch(/Ben/);
		expect(screen.getByText("Employee A")).toBeTruthy();
	});

	it("withholds the split below the minimum aggregation threshold", async () => {
		await renderSection("aggregated", 5);

		expect(within(screen.getByLabelText("Asked of")).getByText("Insufficient data")).toBeTruthy();
		expect(
			within(screen.getByLabelText("Expected of")).getByText("Insufficient data"),
		).toBeTruthy();
	});
});
