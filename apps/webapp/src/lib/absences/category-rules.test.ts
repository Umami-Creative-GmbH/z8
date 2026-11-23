import { describe, expect, it, vi } from "vitest";
import { buildAbsenceCategoryPayload } from "@/components/settings/absence-category/absence-category-form-utils";
import { getColorByStatus } from "@/lib/calendar/absence-service";
import { engagementCategoryRefusal } from "./category-rules";

vi.mock("server-only", () => ({}));

describe("absence categories by engagement kind (#1996)", () => {
	it("lets an External Contractor record only unavailability", () => {
		expect(engagementCategoryRefusal("contractor", "contractor_unavailability")).toBeNull();
		for (const type of ["vacation", "sick", "time_off_in_lieu", "personal", "custom"]) {
			expect(engagementCategoryRefusal("contractor", type)).toBe(
				"contractor_records_unavailability_only",
			);
		}
	});

	it("never lets an employee record contractor unavailability", () => {
		expect(engagementCategoryRefusal("employee", "contractor_unavailability")).toBe(
			"unavailability_is_for_contractors",
		);
		expect(engagementCategoryRefusal("employee", "vacation")).toBeNull();
		expect(engagementCategoryRefusal("employee", "sick")).toBeNull();
	});

	it("saves an unavailability category that deducts nothing, whatever the form says", () => {
		const payload = buildAbsenceCategoryPayload({
			name: " Unavailable ",
			type: "contractor_unavailability",
			description: "",
			nameTranslations: {},
			descriptionTranslations: {},
			requiresWorkTime: true,
			requiresApproval: false,
			countsAgainstVacation: true,
			drawsOnWorkBalance: true,
			deputyRequired: false,
			color: "",
			isActive: true,
		});
		expect(payload).toMatchObject({
			name: "Unavailable",
			requiresWorkTime: false,
			countsAgainstVacation: false,
			drawsOnWorkBalance: false,
		});
	});

	it("marks unavailability on the calendar in slate, unlike vacation in its category colour", () => {
		expect(getColorByStatus("approved", "#10b981", "contractor_unavailability")).toBe("#94a3b8");
		expect(getColorByStatus("pending", null, "contractor_unavailability")).toBe("#94a3b8");
		expect(getColorByStatus("approved", "#10b981", "vacation")).toBe("#10b981");
		expect(getColorByStatus("rejected", "#10b981", "contractor_unavailability")).toBe("#ef4444");
	});
});
