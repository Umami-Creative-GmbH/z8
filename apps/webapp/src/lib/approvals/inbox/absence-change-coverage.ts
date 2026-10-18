import type {
	AbsenceChangeKind,
	AbsenceChangeOriginal,
	AbsenceChangeProposal,
} from "@/lib/absences/change-request-types";
import { parseInstant, parsePlainDate } from "@/lib/datetime/temporal-core";
import {
	type AbsenceCoverageInput,
	type AbsenceCoverageResult,
	evaluateAbsenceCoverage,
} from "./absence-coverage";
export interface AbsenceChangeCoverageInput
	extends Omit<AbsenceCoverageInput, "coverage" | "subjectPresentOn"> {
	absenceId: string;
	kind: AbsenceChangeKind;
	original: AbsenceChangeOriginal;
	proposed: AbsenceChangeProposal | null;
}
/** Supported logical full-day changes, evaluated with the subject restored on removed dates. */
export function evaluateAbsenceChangeCoverage(
	input: AbsenceChangeCoverageInput,
): AbsenceCoverageResult {
	const unknown = (): AbsenceCoverageResult => ({
		complete: false,
		shortfalls: [],
		limitations: ["unsupported_change_coverage"],
	});
	if (
		(input.kind === "change") !== (input.proposed !== null) ||
		input.proposed?.displacedVacations.length
	)
		return unknown();
	try {
		for (const range of [
			input.original,
			...(input.proposed ? [input.proposed] : []),
		]) {
			if (
				range.startPeriod !== "full_day" ||
				range.endPeriod !== "full_day" ||
				parsePlainDate(range.startDate).until(parsePlainDate(range.endDate))
					.sign < 0
			)
				return unknown();
			if (
				range.canonical &&
				(!parseInstant(range.canonical.startAt).equals(
					parseInstant(`${range.startDate}T00:00:00Z`),
				) ||
					!parseInstant(range.canonical.endAt).equals(
						parseInstant(`${range.endDate}T23:59:59.999Z`),
					))
			)
				return unknown();
		}
	} catch {
		return unknown();
	}
	const inRange = (
		date: string,
		range: { startDate: string; endDate: string },
	) => date >= range.startDate && date <= range.endDate;
	const ranges = [input.original, ...(input.proposed ? [input.proposed] : [])];
	const affected = (date: string) =>
		ranges.some((range) => inRange(date, range));
	const startDate = ranges.map((range) => range.startDate).sort()[0];
	const endDate = ranges
		.map((range) => range.endDate)
		.sort()
		.at(-1);
	if (!startDate || !endDate)
		return {
			complete: false,
			shortfalls: [],
			limitations: ["unsupported_change_coverage"],
		};
	const shifts = input.shifts.filter(
		(row) =>
			row.employeeId !== input.employeeId ||
			affected(row.date) ||
			(row.endTime <= row.startTime &&
				affected(parsePlainDate(row.date).add({ days: 1 }).toString())),
	);
	const subjectPresentOn = [
		...new Set(
			shifts
				.filter(
					(row) =>
						row.employeeId === input.employeeId &&
						(!input.proposed || !inRange(row.date, input.proposed)),
				)
				.map((row) => row.date),
		),
	];
	return evaluateAbsenceCoverage({
		...input,
		coverage: { kind: "full_day", startDate, endDate },
		shifts,
		subjectPresentOn,
		absences: input.absences.filter((row) => row.id !== input.absenceId),
	});
}
