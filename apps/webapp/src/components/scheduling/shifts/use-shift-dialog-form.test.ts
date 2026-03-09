import { describe, expect, it } from "vitest";
import { getTemplateAutofillValues } from "@/components/scheduling/shifts/use-shift-dialog-form";

describe("getTemplateAutofillValues", () => {
	it("applies template defaults without overriding an existing subarea", () => {
		expect(
			getTemplateAutofillValues(
				{
					id: "template-1",
					organizationId: "org-1",
					name: "Opening",
					startTime: "08:00",
					endTime: "16:00",
					color: "#123456",
					subareaId: "subarea-from-template",
					isActive: true,
					createdAt: new Date("2026-03-09T00:00:00.000Z"),
					createdBy: "user-1",
					updatedAt: new Date("2026-03-09T00:00:00.000Z"),
				},
				"existing-subarea",
			),
		).toEqual({
			startTime: "08:00",
			endTime: "16:00",
			color: "#123456",
		});
	});
});
