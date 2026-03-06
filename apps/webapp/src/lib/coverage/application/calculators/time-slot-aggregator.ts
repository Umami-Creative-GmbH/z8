/**
 * Time slot aggregator for merging overlapping coverage rules.
 * Uses MAX aggregation - when multiple rules overlap, the highest minimum staff count wins.
 */

import type { CoverageRuleEntity } from "../../domain/entities/coverage-rule";
import {
	type TimeRangeData,
	timeRangesOverlap,
	timeToMinutes,
	minutesToTime,
} from "../../domain/value-objects/time-range";

/**
 * A time slot with its required staff count and contributing rules.
 */
export interface AggregatedTimeSlot {
	timeRange: TimeRangeData;
	requiredStaff: number;
	contributingRules: Array<{
		ruleId: string;
		minimumStaff: number;
	}>;
}

/**
 * Internal representation of a time boundary event.
 */
interface TimeEvent {
	time: number; // minutes since midnight
	type: "start" | "end";
	ruleId: string;
	minimumStaff: number;
}

/**
 * Aggregate overlapping time ranges from rules using MAX for the minimum staff count.
 *
 * Algorithm:
 * 1. Convert all rule time ranges to start/end events
 * 2. Sort events by time
 * 3. Sweep through events, tracking active rules
 * 4. When active rules change, emit a new slot with MAX(minimumStaff)
 *
 * Example:
 *   Rule A: 08:00-12:00, min=2
 *   Rule B: 10:00-14:00, min=3
 *   Result: [
 *     { time: 08:00-10:00, required: 2 },
 *     { time: 10:00-12:00, required: 3 }, // MAX(2,3)
 *     { time: 12:00-14:00, required: 3 }
 *   ]
 */
export function aggregateTimeSlots(rules: CoverageRuleEntity[]): AggregatedTimeSlot[] {
	if (rules.length === 0) {
		return [];
	}

	// Create time events for all rules
	const events: TimeEvent[] = [];
	for (const rule of rules) {
		events.push({
			time: timeToMinutes(rule.startTime),
			type: "start",
			ruleId: rule.id,
			minimumStaff: rule.minimumStaffCount,
		});
		events.push({
			time: timeToMinutes(rule.endTime),
			type: "end",
			ruleId: rule.id,
			minimumStaff: rule.minimumStaffCount,
		});
	}

	// Sort events by time, with ends before starts at the same time
	events.sort((a, b) => {
		if (a.time !== b.time) {
			return a.time - b.time;
		}
		// At same time: process ends before starts
		// This ensures adjacent ranges don't overlap
		if (a.type === "end" && b.type === "start") return -1;
		if (a.type === "start" && b.type === "end") return 1;
		return 0;
	});

	// Sweep through events
	const activeRules = new Map<string, number>(); // ruleId -> minimumStaff
	const slots: AggregatedTimeSlot[] = [];
	let previousTime: number | null = null;

	for (const event of events) {
		// If we have active rules and time has advanced, emit a slot
		if (activeRules.size > 0 && previousTime !== null && event.time > previousTime) {
			const maxStaff = Math.max(...activeRules.values());
			const contributingRules = Array.from(activeRules.entries()).map(([ruleId, minStaff]) => ({
				ruleId,
				minimumStaff: minStaff,
			}));

			slots.push({
				timeRange: {
					startTime: minutesToTime(previousTime),
					endTime: minutesToTime(event.time),
				},
				requiredStaff: maxStaff,
				contributingRules,
			});
		}

		// Update active rules
		if (event.type === "start") {
			activeRules.set(event.ruleId, event.minimumStaff);
		} else {
			activeRules.delete(event.ruleId);
		}

		previousTime = event.time;
	}

	return slots;
}

/**
 * Get all time boundaries from a set of rules.
 * Useful for aligning shift coverage calculations with rule boundaries.
 */
export function getTimeBoundaries(rules: CoverageRuleEntity[]): number[] {
	const boundaries = new Set<number>();

	for (const rule of rules) {
		boundaries.add(timeToMinutes(rule.startTime));
		boundaries.add(timeToMinutes(rule.endTime));
	}

	return Array.from(boundaries).sort((a, b) => a - b);
}

/**
 * Check if any rules are defined for the given time range.
 */
export function hasRulesInTimeRange(
	rules: CoverageRuleEntity[],
	timeRange: TimeRangeData,
): boolean {
	return rules.some((rule) =>
		timeRangesOverlap(
			{ startTime: rule.startTime, endTime: rule.endTime },
			timeRange,
		),
	);
}
