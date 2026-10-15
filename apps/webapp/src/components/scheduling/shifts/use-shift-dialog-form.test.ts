/* @vitest-environment jsdom */

import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
	useShiftDialogForm,
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

describe("shift edit session", () => {
	it("keeps draft times and notes when templates refresh, and resets on a new opening", () => {
		const template = {
			id: "template-1",
			organizationId: "org-1",
			name: "Opening",
			startTime: "08:00",
			endTime: "16:00",
			color: null,
			subareaId: null,
			isActive: true,
			createdAt: new Date("2026-10-15T00:00:00Z"),
			updatedAt: new Date("2026-10-15T00:00:00Z"),
			createdBy: "user-1",
		};
		const { result, rerender } = renderHook(
			({ open, templates }) =>
				useShiftDialogForm({
					open,
					shift: null,
					templates,
					defaultDate: "2026-10-15",
					organizationTimezone: "Europe/Berlin",
					onSubmit: () => {},
				}),
			{ initialProps: { open: true, templates: [template] } },
		);
		act(() => result.current.form.setFieldValue("templateId", template.id));
		expect(result.current.form.state.values.startTime).toBe("08:00");
		act(() => {
			result.current.form.setFieldValue("startTime", "10:30");
			result.current.form.setFieldValue("notes", "Unsaved note");
		});
		rerender({ open: true, templates: [{ ...template, startTime: "07:00" }] });
		expect(result.current.form.state.values.startTime).toBe("10:30");
		expect(result.current.form.state.values.notes).toBe("Unsaved note");
		rerender({ open: false, templates: [template] });
		rerender({ open: true, templates: [template] });
		expect(result.current.form.state.values.startTime).toBe("09:00");
		expect(result.current.form.state.values.notes).toBe("");
	});
});
