import {
  createRequestAbsenceFormValidator,
  type RequestAbsenceFormValues,
} from "./request-absence-form";

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
