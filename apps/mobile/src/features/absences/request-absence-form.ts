import type {
  CreateMobileAbsenceRequestInput,
  MobileAbsenceDayPeriod,
} from "./use-absences-query";

import { DateTime } from "luxon";

export interface RequestAbsenceFormValues {
  categoryId: string;
  startDate: string;
  startPeriod: MobileAbsenceDayPeriod;
  endDate: string;
  endPeriod: MobileAbsenceDayPeriod;
  notes: string;
}

export type RequestAbsenceFormErrors = Partial<Record<keyof RequestAbsenceFormValues, string>>;

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
      errors.endPeriod = "Cannot end in the morning if starting in the afternoon on the same day";
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
