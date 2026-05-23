import React from "react";

import {
  createRequestAbsencePayload,
  createRequestAbsenceFormValidator,
  type RequestAbsenceFormValues,
} from "./request-absence-form";
import {
	formatDatePickerButtonLabel,
	isoDateToPickerDate,
	pickerDateToIsoDate,
} from "./request-absence-screen";

vi.mock("react-native", () => ({
	Pressable: ({ accessibilityLabel, accessibilityRole, accessibilityState, children, disabled, onPress, ...props }: any) =>
		React.createElement(
			"button",
			{
				...props,
				...(accessibilityLabel ? { "aria-label": accessibilityLabel } : {}),
				...(accessibilityRole ? { role: accessibilityRole } : {}),
				...(accessibilityState?.selected !== undefined
					? { "data-selected": accessibilityState.selected }
					: {}),
				disabled,
				onClick: disabled ? undefined : onPress,
			},
			children,
		),
	ScrollView: ({ children, ...props }: any) => React.createElement("div", props, children),
	StyleSheet: {
		create: <T,>(styles: T) => styles,
	},
	Text: ({ children, ...props }: any) => React.createElement("span", props, children),
	TextInput: ({ value, onChangeText, ...props }: any) =>
		React.createElement("input", { ...props, onChange: (event: any) => onChangeText?.(event.target.value), value }),
	View: ({ children, ...props }: any) => React.createElement("div", props, children),
}));

function createValues(overrides: Partial<RequestAbsenceFormValues> = {}): RequestAbsenceFormValues {
  return {
    categoryId: "category-1",
    startDate: "2026-05-10",
    startPeriod: "full_day",
    endDate: "2026-05-10",
    endPeriod: "full_day",
    notes: "",
    ...overrides,
  };
}

describe("request absence form", () => {
	const originalTimeZone = process.env.TZ;

	afterEach(() => {
		process.env.TZ = originalTimeZone;
	});

	it("converts ISO dates to native picker dates and back", () => {
		process.env.TZ = "America/Los_Angeles";

		const pickerDate = isoDateToPickerDate("2026-05-10");

		expect(pickerDate.getFullYear()).toBe(2026);
		expect(pickerDate.getMonth()).toBe(4);
		expect(pickerDate.getDate()).toBe(10);
		expect(pickerDateToIsoDate(pickerDate)).toBe("2026-05-10");
	});

	it("preserves positive-timezone local midnight picker dates", () => {
		process.env.TZ = "Europe/Berlin";

		expect(pickerDateToIsoDate(new Date(2026, 4, 10))).toBe("2026-05-10");
	});

	it("submits picker-selected dates as ISO date strings", () => {
		process.env.TZ = "Europe/Berlin";

		expect(
			createRequestAbsencePayload({
				...createValues({ endDate: "2026-05-11" }),
				startDate: pickerDateToIsoDate(new Date(2026, 4, 10)),
			}),
		).toMatchObject({
			startDate: "2026-05-10",
			endDate: "2026-05-11",
		});
	});

	it("includes the selected date in date picker button labels", () => {
		expect(formatDatePickerButtonLabel("startDate", "2026-05-10")).toBe("Pick start date: 2026-05-10");
		expect(formatDatePickerButtonLabel("endDate", "2026-05-11")).toBe("Pick end date: 2026-05-11");
		expect(formatDatePickerButtonLabel("startDate", "")).toBe("Pick start date: no date selected");
	});

	it("rejects impossible real dates", () => {
		const validate = createRequestAbsenceFormValidator();

		expect(
			validate(
				createValues({
					startDate: "2026-02-31",
				}),
			),
		).toEqual({
			startDate: "Enter a valid calendar date",
		});
	});

  it("rejects same-day pm-to-am range", () => {
    const validate = createRequestAbsenceFormValidator();

    expect(
      validate(
        createValues({
          startPeriod: "pm",
          endPeriod: "am",
        }),
      ),
    ).toEqual({
      endPeriod: "Cannot end in the morning if starting in the afternoon on the same day",
    });
  });
});
