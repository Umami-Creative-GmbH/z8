import { parsePlainDate } from "@/lib/datetime/temporal-core";
import type { AbsenceSubmittedCoverage } from "../evidence/absence-facts";

export interface CoverageShift {
	id: string;
	organizationId: string;
	employeeId: string | null;
	subareaId: string;
	date: string;
	startTime: string;
	endTime: string;
}
export interface CoverageRule {
	subareaName?: string;
	id: string;
	organizationId: string;
	subareaId: string;
	dayOfWeek: string;
	startTime: string;
	endTime: string;
	minimumStaffCount: number;
}
export interface CoverageAbsence {
	id: string;
	organizationId: string;
	employeeId: string;
	status: string;
	startDate: string;
	endDate: string;
	startPeriod: string;
	endPeriod: string;
	requiresWorkTime: boolean;
}
export interface AbsenceCoverageInput {
	organizationId: string;
	employeeId: string;
	coverage: AbsenceSubmittedCoverage;
	shifts: readonly CoverageShift[];
	rules: readonly CoverageRule[];
	absences: readonly CoverageAbsence[];
}
export interface CoverageShortfall {
	subareaName: string;
	date: string;
	subareaId: string;
	startTime: string;
	endTime: string;
	minimumStaffCount: number;
	staffCount: number;
}
export interface AbsenceCoverageResult {
	complete: boolean;
	shortfalls: CoverageShortfall[];
	limitations: string[];
}
const validTime = (value: string) =>
	/^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(value);
const sameDay = (row: { startTime: string; endTime: string }) =>
	validTime(row.startTime) &&
	validTime(row.endTime) &&
	row.startTime < row.endTime;
const WEEKDAYS = [
	"monday",
	"tuesday",
	"wednesday",
	"thursday",
	"friday",
	"saturday",
	"sunday",
];
/** A bounded assessment of published same-day shifts, never a reconstruction of requested clocks. */
export function evaluateAbsenceCoverage(
	input: AbsenceCoverageInput,
): AbsenceCoverageResult {
	const result: AbsenceCoverageResult = {
		complete: true,
		shortfalls: [],
		limitations: [],
	};
	const unknown = (reason: string) => {
		result.complete = false;
		if (!result.limitations.includes(reason)) result.limitations.push(reason);
	};
	if (input.coverage.kind !== "full_day") {
		unknown("unsupported_absence_coverage");
		return result;
	}
	const affected = input.shifts.filter(
		(row) =>
			row.organizationId === input.organizationId &&
			row.employeeId === input.employeeId &&
			row.date >= input.coverage.startDate &&
			row.date <= input.coverage.endDate,
	);
	if (!affected.length) unknown("published_shifts_not_verified");
	for (const own of affected) {
		if (!sameDay(own)) {
			unknown("unsupported_shift_interval");
			continue;
		}
		const previousDate = parsePlainDate(own.date)
			.subtract({ days: 1 })
			.toString();
		if (
			input.shifts.some(
				(row) =>
					row.organizationId === input.organizationId &&
					row.subareaId === own.subareaId &&
					(row.date === own.date || row.date === previousDate) &&
					!sameDay(row),
			)
		) {
			unknown("unsupported_shift_interval");
			continue;
		}
		const weekday = WEEKDAYS[parsePlainDate(own.date).dayOfWeek - 1];
		const previousWeekday =
			WEEKDAYS[parsePlainDate(previousDate).dayOfWeek - 1];
		if (
			input.rules.some(
				(rule) =>
					rule.organizationId === input.organizationId &&
					rule.subareaId === own.subareaId &&
					rule.dayOfWeek === previousWeekday &&
					!sameDay(rule),
			)
		) {
			unknown("unsupported_coverage_rule");
			continue;
		}
		const rules = input.rules.filter(
			(rule) =>
				rule.organizationId === input.organizationId &&
				rule.subareaId === own.subareaId &&
				rule.dayOfWeek === weekday,
		);
		if (
			rules.some(
				(rule) =>
					!sameDay(rule) ||
					!Number.isInteger(rule.minimumStaffCount) ||
					rule.minimumStaffCount < 1,
			)
		) {
			unknown("unsupported_coverage_rule");
			continue;
		}
		const peers = input.shifts.filter(
			(row) =>
				row.organizationId === input.organizationId &&
				row.employeeId &&
				row.employeeId !== input.employeeId &&
				row.date === own.date &&
				row.subareaId === own.subareaId,
		);
		const peerIds = new Set(peers.map((peer) => peer.employeeId));
		if (
			input.absences.some(
				(absence) =>
					absence.organizationId === input.organizationId &&
					peerIds.has(absence.employeeId) &&
					absence.startDate <= own.date &&
					absence.endDate >= own.date &&
					(absence.status === "pending" ||
						(absence.status === "approved" &&
							!absence.requiresWorkTime &&
							(absence.startPeriod !== "full_day" ||
								absence.endPeriod !== "full_day"))),
			)
		)
			unknown("colleague_absence_coverage_unverified");
		const points = [
			...new Set([
				own.startTime,
				own.endTime,
				...rules.flatMap((row) => [row.startTime, row.endTime]),
				...peers.flatMap((row) => [row.startTime, row.endTime]),
			]),
		]
			.filter((point) => point >= own.startTime && point <= own.endTime)
			.sort();
		for (let index = 0; index < points.length - 1; index++) {
			const startTime = points[index];
			const endTime = points[index + 1];
			if (!startTime || !endTime) continue;
			const activeRules = rules.filter(
				(rule) => rule.startTime <= startTime && rule.endTime >= endTime,
			);
			if (!activeRules.length) {
				unknown("coverage_rule_gap");
				continue;
			}
			const minimumStaffCount = Math.max(
				...activeRules.map((rule) => rule.minimumStaffCount),
			);
			const absent = new Set(
				input.absences
					.filter(
						(absence) =>
							absence.organizationId === input.organizationId &&
							absence.status === "approved" &&
							!absence.requiresWorkTime &&
							absence.startPeriod === "full_day" &&
							absence.endPeriod === "full_day" &&
							absence.startDate <= own.date &&
							absence.endDate >= own.date,
					)
					.map((absence) => absence.employeeId),
			);
			const staffCount = new Set(
				peers
					.filter(
						(peer) =>
							peer.employeeId !== null &&
							!absent.has(peer.employeeId) &&
							peer.startTime <= startTime &&
							peer.endTime >= endTime,
					)
					.map((peer) => peer.employeeId),
			).size;
			if (
				staffCount < minimumStaffCount &&
				!result.shortfalls.some(
					(row) =>
						row.date === own.date &&
						row.subareaId === own.subareaId &&
						row.startTime === startTime &&
						row.endTime === endTime,
				)
			)
				result.shortfalls.push({
					date: own.date,
					subareaId: own.subareaId,
					startTime,
					endTime,
					minimumStaffCount,
					subareaName:
						activeRules.find((rule) => rule.subareaName)?.subareaName ??
						own.subareaId,
					staffCount,
				});
		}
	}
	return result;
}
