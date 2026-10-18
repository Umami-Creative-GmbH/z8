import "server-only";
import { and, eq, gte, inArray, lt } from "drizzle-orm";
import { db } from "@/db";
import { coverageRule, shift } from "@/db/schema";
import { createLogger } from "@/lib/logger";
import { shiftCalendarDate, shiftDateRangeBounds } from "@/lib/scheduling/shift-date";
import {
	type AffectedShiftEvidence,
	type CoverageEvaluation,
	type CoverageEvidenceGap,
	type CoverageRuleEvidence,
	type CoverageShiftEvidence,
	coverageShiftDateWindow,
	evaluateAbsenceCoverage,
	findAffectedShifts,
} from "./coverage-evidence";
import type { AbsenceDurationInput } from "./duration";

const logger = createLogger("AbsenceCoverageEvidence");

export interface AbsenceCoverageEvidence {
	affectedShifts: AffectedShiftEvidence[];
	coverage: CoverageEvaluation;
}

interface ShiftRow {
	id: string;
	employeeId: string | null;
	subareaId: string;
	date: Date;
	startTime: string;
	endTime: string;
	subarea?: { name: string } | null;
}

/**
 * Loads the published-schedule coverage evidence of one previewed absence for the requester
 * (#1341). Scope comes from the caller's authenticated context; every read is limited to the
 * organization. Never throws: failed reads become incomplete evidence, so the rest of the preview
 * survives.
 */
export async function loadAbsenceCoverageEvidence(input: {
	organizationId: string;
	employeeId: string;
	timezone: string;
	request: AbsenceDurationInput;
}): Promise<AbsenceCoverageEvidence> {
	const { organizationId, employeeId, timezone, request } = input;

	let bounds: { start: Date; endExclusive: Date };
	let requesterShifts: CoverageShiftEvidence[];
	try {
		const window = coverageShiftDateWindow(request);
		bounds = shiftDateRangeBounds(window.firstDate, window.lastDate.add({ days: 1 }), timezone);
		const rows = await db.query.shift.findMany({
			where: and(
				eq(shift.organizationId, organizationId),
				eq(shift.employeeId, employeeId),
				eq(shift.status, "published"),
				gte(shift.date, bounds.start),
				lt(shift.date, bounds.endExclusive),
			),
			with: { subarea: { columns: { name: true } } },
		});
		requesterShifts = toShiftEvidence(rows, timezone);
	} catch (error) {
		logger.error(
			{ error, organizationId, employeeId },
			"Failed to read the requester's published shifts for coverage evidence",
		);
		return { affectedShifts: [], coverage: incomplete(["read_failed"]) };
	}

	const { affected, unsupported } = findAffectedShifts({ timezone, request, requesterShifts });
	const knownGaps: CoverageEvidenceGap[] = unsupported ? ["unsupported"] : [];
	if (affected.length === 0) {
		return {
			affectedShifts: [],
			coverage: unsupported ? incomplete(knownGaps) : { status: "complete", gaps: [], risks: [] },
		};
	}

	const subareaIds = [...new Set(affected.map((affectedShift) => affectedShift.subareaId))];
	let rules: CoverageRuleEvidence[];
	let publishedShifts: CoverageShiftEvidence[];
	try {
		const [ruleRows, shiftRows] = await Promise.all([
			db.query.coverageRule.findMany({
				where: and(
					eq(coverageRule.organizationId, organizationId),
					inArray(coverageRule.subareaId, subareaIds),
				),
				with: { subarea: { columns: { name: true } } },
			}),
			db.query.shift.findMany({
				where: and(
					eq(shift.organizationId, organizationId),
					eq(shift.status, "published"),
					inArray(shift.subareaId, subareaIds),
					gte(shift.date, bounds.start),
					lt(shift.date, bounds.endExclusive),
				),
			}),
		]);
		rules = ruleRows.map((rule) => ({
			subareaId: rule.subareaId,
			subareaName: rule.subarea?.name ?? null,
			dayOfWeek: rule.dayOfWeek,
			startTime: rule.startTime,
			endTime: rule.endTime,
			minimumStaffCount: rule.minimumStaffCount,
		}));
		publishedShifts = toShiftEvidence(shiftRows, timezone);
	} catch (error) {
		logger.error(
			{ error, organizationId, employeeId, subareaIds },
			"Failed to read coverage rules or published shifts for coverage evidence",
		);
		return { affectedShifts: affected, coverage: incomplete([...knownGaps, "read_failed"]) };
	}

	return evaluateAbsenceCoverage({
		timezone,
		request,
		requesterEmployeeId: employeeId,
		requesterShifts,
		publishedShifts,
		rules,
	});
}

function incomplete(gaps: CoverageEvidenceGap[]): CoverageEvaluation {
	return { status: "incomplete", gaps: [...new Set(gaps)].sort(), risks: [] };
}

/** Reads each `shift.date` as its calendar date in the organization's zone. */
function toShiftEvidence(rows: readonly ShiftRow[], timezone: string): CoverageShiftEvidence[] {
	return rows.map((row) => ({
		id: row.id,
		employeeId: row.employeeId,
		subareaId: row.subareaId,
		subareaName: row.subarea?.name ?? null,
		date: shiftCalendarDate(row.date, timezone).toString(),
		startTime: row.startTime,
		endTime: row.endTime,
	}));
}
