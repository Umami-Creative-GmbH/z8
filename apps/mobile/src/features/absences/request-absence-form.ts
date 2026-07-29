import { DateTime } from "luxon";
import type {
	CreateMobileAbsenceRequestInput,
	MobileAbsenceDayPeriod,
} from "./use-absences-query";

export interface RequestAbsenceFormValues {
	categoryId: string;
	startDate: string;
	startPeriod: MobileAbsenceDayPeriod;
	endDate: string;
	endPeriod: MobileAbsenceDayPeriod;
	notes: string;
}

export type RequestAbsenceFormErrors = Partial<
	Record<keyof RequestAbsenceFormValues, string>
>;

type DateFieldName = "startDate" | "endDate";

export function isoDateToPickerDate(value: string) {
	const parsed = DateTime.fromISO(value);
	const date = parsed.isValid ? parsed : DateTime.now();

	return new Date(date.year, date.month - 1, date.day);
}

export function pickerDateToIsoDate(value: Date) {
	const year = value.getFullYear();
	const month = String(value.getMonth() + 1).padStart(2, "0");
	const day = String(value.getDate()).padStart(2, "0");

	return `${year}-${month}-${day}`;
}

export function formatDatePickerButtonLabel(
	fieldName: DateFieldName,
	value: string,
) {
	const label = fieldName === "startDate" ? "start date" : "end date";
	const selectedDate = value.trim() || "no date selected";

	return `Pick ${label}: ${selectedDate}`;
}

export function createRequestAbsenceFormValues(): RequestAbsenceFormValues {
	return {
		categoryId: "",
		startDate: "",
		startPeriod: "full_day",
		endDate: "",
		endPeriod: "full_day",
		notes: "",
	};
}

export function createRequestAbsenceFormValidator() {
	return (values: RequestAbsenceFormValues): RequestAbsenceFormErrors => {
		const errors: RequestAbsenceFormErrors = {};

		if (!values.categoryId.trim()) {
			errors.categoryId = "Select an absence type";
		}

		if (!values.startDate.trim()) {
			errors.startDate = "Enter a start date";
		}

		if (!values.endDate.trim()) {
			errors.endDate = "Enter an end date";
		}

		if (values.startDate && !isRealIsoDate(values.startDate)) {
			errors.startDate = "Enter a valid calendar date";
		}

		if (values.endDate && !isRealIsoDate(values.endDate)) {
			errors.endDate = "Enter a valid calendar date";
		}

		if (
			values.startDate &&
			values.endDate &&
			!errors.startDate &&
			!errors.endDate &&
			values.startDate > values.endDate
		) {
			errors.endDate = "End date must be on or after the start date";
		}

		if (
			values.startDate &&
			values.endDate &&
			!errors.startDate &&
			!errors.endDate &&
			values.startDate === values.endDate &&
			values.startPeriod === "pm" &&
			values.endPeriod === "am"
		) {
			errors.endPeriod =
				"Cannot end in the morning if starting in the afternoon on the same day";
		}

		return errors;
	};
}

function isRealIsoDate(value: string) {
	return DateTime.fromISO(value, { zone: "utc" }).toISODate() === value;
}

export function createRequestAbsencePayload(
	values: RequestAbsenceFormValues,
): CreateMobileAbsenceRequestInput {
	return {
		categoryId: values.categoryId,
		startDate: values.startDate,
		startPeriod: values.startPeriod,
		endDate: values.endDate,
		endPeriod: values.endPeriod,
		...(values.notes.trim() ? { notes: values.notes.trim() } : {}),
	};
}
