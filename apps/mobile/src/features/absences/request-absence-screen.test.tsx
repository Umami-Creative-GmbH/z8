import React from "react";

import {
  createRequestAbsenceFormValidator,
  type RequestAbsenceFormValues,
} from "./request-absence-form";
import {
	createRequestAbsencePayloadWithPickerDate,
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
		const pickerDate = isoDateToPickerDate("2026-05-10");

		expect(pickerDate.toISOString()).toBe("2026-05-10T00:00:00.000Z");
		expect(pickerDateToIsoDate(pickerDate)).toBe("2026-05-10");
	});

	it("preserves positive-timezone local midnight picker dates", () => {
		process.env.TZ = "Europe/Berlin";

		expect(pickerDateToIsoDate(new Date(2026, 4, 10))).toBe("2026-05-10");
	});

	it("submits picker-selected dates as ISO date strings", () => {
		process.env.TZ = "Europe/Berlin";

		expect(
			createRequestAbsencePayloadWithPickerDate(
				createValues({ endDate: "2026-05-11" }),
				"startDate",
				new Date(2026, 4, 10),
			),
		).toMatchObject({
			startDate: "2026-05-10",
			endDate: "2026-05-11",
		});
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
