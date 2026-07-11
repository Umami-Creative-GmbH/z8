import { describe, expect, it } from "vitest";
import {
	getDefaultShiftDialogValues,
	getTemplateAutofillValues,
} from "@/components/scheduling/shifts/use-shift-dialog-form";

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

describe("getDefaultShiftDialogValues", () => {
	it("uses the organization date rather than the browser timezone", () => {
		expect(
			getDefaultShiftDialogValues(null, "Pacific/Kiritimati", "2026-07-08T12:00:00Z").date,
		).toBe("2026-07-09");
	});
});
