import {
	type AbsenceDurationInput,
	normalizeAbsenceDurationInput,
	validateAbsenceDurationInput,
} from "@/lib/absences/duration";
import type { StagedSickNoteFile } from "@/components/absences/sick-notes/sick-note-files-field";
import type { AbsenceDurationKind, DayPeriod, SickDetail } from "@/lib/absences/types";
import type { RecordAbsenceForEmployeeInput } from "./manager-absence-types";

type RecordAbsenceFormValues = {
	categoryId: string;
	startDate: string;
	startPeriod: DayPeriod;
	endDate: string;
	endPeriod: DayPeriod;
	durationKind: AbsenceDurationKind;
	startTime: string;
	endTime: string;
	notes: string;
	sickDetail: SickDetail | "";
	/** Sick notes to attach once the sick leave is recorded (#984). */
	sickNotes: StagedSickNoteFile[];
};

const defaultValues: RecordAbsenceFormValues = {
	categoryId: "",
	startDate: "",
	startPeriod: "full_day",
	endDate: "",
	endPeriod: "full_day",
	durationKind: "full_day",
	startTime: "",
	endTime: "",
	notes: "",
	sickDetail: "",
	sickNotes: [],
};

function validateRecordAbsenceFormDateRange(input: AbsenceDurationInput): string | null {
	return validateAbsenceDurationInput(input);
}

function getDefaultRecordAbsenceFormValues(): RecordAbsenceFormValues {
	return { ...defaultValues, sickNotes: [] };
}

function buildRecordAbsenceForEmployeeInput(
	employeeId: string,
	value: RecordAbsenceFormValues,
): RecordAbsenceForEmployeeInput {
	const normalized = normalizeAbsenceDurationInput(value);

	return {
		employeeId,
		categoryId: normalized.categoryId,
		startDate: normalized.startDate,
		startPeriod: normalized.startPeriod,
		endDate: normalized.endDate,
		endPeriod: normalized.endPeriod,
		durationKind: normalized.durationKind,
		startTime: normalized.startTime,
		endTime: normalized.endTime,
		notes: normalized.notes?.trim() || undefined,
		sickDetail: value.sickDetail || undefined,
	};
}

export type { RecordAbsenceFormValues };
export {
	buildRecordAbsenceForEmployeeInput,
	getDefaultRecordAbsenceFormValues,
	validateRecordAbsenceFormDateRange,
};
