import {
	getDayOfWeek,
	type CoverageRuleEntity,
} from "@/lib/coverage/domain/entities/coverage-rule";
import type {
	CoverageSnapshotEntity,
	CoverageSlotStatus,
	CoverageTimeSlotSnapshot,
} from "@/lib/coverage/domain/entities/coverage-snapshot";

export interface ShiftForCoverage {
	id: string;
	employeeId: string | null;
	startTime: string;
	endTime: string;
}

export interface CoverageCalculationInput {
	date: Date;
	subareaId: string;
	subareaName: string;
	locationName?: string;
	rules: CoverageRuleEntity[];
	shifts: ShiftForCoverage[];
}

export interface CoverageCalculationResult {
	date: Date;
	subareaId: string;
	subareaName: string;
	locationName?: string;
	snapshot: CoverageSnapshotEntity;
}

export interface CoverageGapResult {
	date: Date;
	subareaId: string;
	subareaName: string;
	locationName?: string;
	timeRange: {
		startTime: string;
		endTime: string;
	};
	required: number;
	actual: number;
	shortfall: number;
	ruleIds: string[];
}

function timeToMinutes(time: string): number {
	const [hours, minutes] = time.split(":").map(Number);
	return hours * 60 + minutes;
}

function getSlotStatus(required: number, actual: number): CoverageSlotStatus {
	if (actual < required) return "under";
	if (actual > required) return "over";
	return "met";
}

function overlaps(
	rangeAStart: number,
	rangeAEnd: number,
	rangeBStart: number,
	rangeBEnd: number,
): boolean {
	return rangeAStart < rangeBEnd && rangeAEnd > rangeBStart;
}

function calculateActualForRule(
	rule: CoverageRuleEntity,
	shifts: ShiftForCoverage[],
): number {
	const ruleStart = timeToMinutes(rule.startTime);
	const ruleEnd = timeToMinutes(rule.endTime);
	const employeeIds = new Set<string>();

	for (const shift of shifts) {
		if (!shift.employeeId) continue;

		const shiftStart = timeToMinutes(shift.startTime);
		const shiftEnd = timeToMinutes(shift.endTime);

		if (overlaps(ruleStart, ruleEnd, shiftStart, shiftEnd)) {
			employeeIds.add(shift.employeeId);
		}
	}

	return employeeIds.size;
}

export function calculateCoverage(
	input: CoverageCalculationInput,
): CoverageCalculationResult {
	const dayOfWeek = getDayOfWeek(input.date);
	const activeRules = input.rules
		.filter((rule) => rule.subareaId === input.subareaId)
		.filter((rule) => rule.dayOfWeek === dayOfWeek)
		.sort((a, b) => {
			const byStart = timeToMinutes(a.startTime) - timeToMinutes(b.startTime);
			if (byStart !== 0) return byStart;
			return a.priority - b.priority;
		});

	const timeSlots: CoverageTimeSlotSnapshot[] = activeRules.map((rule) => {
		const actual = calculateActualForRule(rule, input.shifts);
		const required = rule.minimumStaffCount;
		const shortfall = Math.max(0, required - actual);

		return {
			startTime: rule.startTime,
			endTime: rule.endTime,
			required,
			actual,
			shortfall,
			status: getSlotStatus(required, actual),
			ruleIds: [rule.id],
		};
	});

	const totalRequired = timeSlots.reduce((sum, slot) => sum + slot.required, 0);
	const totalActual = timeSlots.reduce((sum, slot) => sum + slot.actual, 0);
	const totalShortfall = timeSlots.reduce((sum, slot) => sum + slot.shortfall, 0);
	const gapCount = timeSlots.reduce(
		(sum, slot) => sum + (slot.shortfall > 0 ? slot.shortfall : 0),
		0,
	);

	const status: CoverageSlotStatus =
		timeSlots.some((slot) => slot.status === "under")
			? "under"
			: timeSlots.some((slot) => slot.status === "over")
				? "over"
				: "met";

	const utilizationPercent =
		totalRequired === 0
			? 100
			: Math.max(0, Math.round((totalActual / totalRequired) * 100));

	return {
		date: input.date,
		subareaId: input.subareaId,
		subareaName: input.subareaName,
		locationName: input.locationName,
		snapshot: {
			date: input.date,
			subareaId: input.subareaId,
			subareaName: input.subareaName,
			locationName: input.locationName,
			timeSlots,
			totalRequired,
			totalActual,
			totalShortfall,
			status,
			utilizationPercent,
			gapCount,
		},
	};
}

export function extractGaps(
	results: CoverageCalculationResult[],
): CoverageGapResult[] {
	const gaps: CoverageGapResult[] = [];

	for (const result of results) {
		for (const slot of result.snapshot.timeSlots) {
			if (slot.shortfall <= 0) continue;

			gaps.push({
				date: result.date,
				subareaId: result.subareaId,
				subareaName: result.subareaName,
				locationName: result.locationName,
				timeRange: {
					startTime: slot.startTime,
					endTime: slot.endTime,
				},
				required: slot.required,
				actual: slot.actual,
				shortfall: slot.shortfall,
				ruleIds: slot.ruleIds,
			});
		}
	}

	return gaps.sort((a, b) => {
		const byDate = a.date.getTime() - b.date.getTime();
		if (byDate !== 0) return byDate;
		return b.shortfall - a.shortfall;
	});
}
