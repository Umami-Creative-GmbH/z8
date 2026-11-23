/**
 * Statutory sector exceptions for JArbSchG findings (#1993), org admins only: the open night,
 * Saturday, Sunday and holiday findings of employees under 18 around today, and the action that
 * acknowledges one. The admin acknowledges what they were shown: the action re-evaluates the
 * finding and refuses when its fingerprint no longer matches. #1994 folds this list into the
 * unified Reviews inbox.
 */
import { and, eq, isNotNull } from "drizzle-orm";
import { user } from "@/db/auth-schema";
import { employee } from "@/db/schema";
import { type Instant, parsePlainDate, plainDateAt } from "@/lib/datetime/temporal-core";
import { ValidationError } from "@/lib/effect/errors";
import type { DatabaseClient } from "@/lib/effect/services/database.service";
import { birthdayCalendarDate } from "@/lib/organization/employee-birthday";
import {
	attachAcknowledgementStates,
	recordStatutoryAcknowledgement,
	type StatutoryAcknowledgementRecord,
	statutoryAcknowledgementSubjectOf,
} from "../acknowledgements";
import type { StatutoryFinding, StatutoryQuantity } from "../finding";
import { loadOrganizationStatutoryPreferences } from "../preferences";
import { isMinorOn } from "./age";
import { jarbschgScheduleContributor } from "./jarbschg-contributor";
import { type JarbschgRule, jarbschgSectorExceptionRules } from "./jarbschg-rules";

type Reader = Pick<DatabaseClient, "select" | "query">;

/** Days before today still listed: recently worked shifts can be documented. */
export const SECTOR_EXCEPTION_LOOKBACK_DAYS = 7;
/** Days after today listed: the planning horizon. */
export const SECTOR_EXCEPTION_LOOKAHEAD_DAYS = 56;

export const jarbschgSectorExceptionKinds = [
	"jarbschg_night_work",
	"jarbschg_saturday_work",
	"jarbschg_sunday_work",
	"jarbschg_holiday_work",
] as const satisfies readonly JarbschgRule[];
export type JarbschgSectorExceptionKind = (typeof jarbschgSectorExceptionKinds)[number];

/** An open (unacknowledged or stale) sector-exception finding, for org admins. */
export interface OpenYouthSectorException {
	readonly findingId: string;
	readonly employeeId: string;
	readonly employeeName: string;
	readonly findingKind: JarbschgSectorExceptionKind;
	readonly subjectKey: string;
	/** Local day the finding is dated to, `YYYY-MM-DD`. */
	readonly periodStart: string;
	readonly legalReference: string;
	readonly used: StatutoryQuantity | null;
	readonly acknowledgementStatus: "none" | "stale";
	/** What the admin acknowledges; passed back as the expected precondition. */
	readonly inputFingerprint: string;
}

export type YouthSectorExceptionRefusal =
	| "statutory_finding_not_found"
	| "statutory_finding_changed";

const isSectorExceptionKind = (kind: string): kind is JarbschgSectorExceptionKind =>
	jarbschgSectorExceptionRules.has(kind as JarbschgRule);

function nameOf(row: {
	firstName: string | null;
	lastName: string | null;
	userName: string | null;
	employeeNumber: string | null;
	employeeId: string;
}): string {
	const full = [row.firstName, row.lastName].filter(Boolean).join(" ").trim();
	return full || row.userName || row.employeeNumber || row.employeeId;
}

async function evaluateSectorFindings(
	db: Reader,
	input: {
		readonly organizationId: string;
		readonly timezone: string;
		readonly now: Instant;
		readonly employeeIds: readonly string[];
		readonly window: { readonly start: string; readonly endExclusive: string };
	},
): Promise<StatutoryFinding[]> {
	if (input.employeeIds.length === 0) return [];
	const findings = await jarbschgScheduleContributor.evaluate({
		db,
		organizationId: input.organizationId,
		timezone: input.timezone,
		window: input.window,
		employeeIds: input.employeeIds,
		proposedShifts: [],
		replacesShiftId: null,
		preferences: await loadOrganizationStatutoryPreferences(db, input.organizationId),
		now: input.now,
	});
	return attachAcknowledgementStates(
		db,
		input.organizationId,
		findings.filter((finding) => finding.acknowledgementKind === "jarbschg_sector_exception"),
	);
}

/** Open sector-exception findings of the organization's employees under 18, oldest day first. */
export async function listOpenYouthSectorExceptions(
	db: Reader,
	input: { readonly organizationId: string; readonly timezone: string; readonly now: Instant },
): Promise<OpenYouthSectorException[]> {
	const today = plainDateAt(input.now, input.timezone);
	const windowStart = today.subtract({ days: SECTOR_EXCEPTION_LOOKBACK_DAYS });
	const windowEnd = today.add({ days: SECTOR_EXCEPTION_LOOKAHEAD_DAYS });
	const people = await db
		.select({
			employeeId: employee.id,
			birthday: employee.birthday,
			firstName: user.firstName,
			lastName: user.lastName,
			userName: user.name,
			employeeNumber: employee.employeeNumber,
		})
		.from(employee)
		.leftJoin(user, eq(user.id, employee.userId))
		.where(
			and(
				eq(employee.organizationId, input.organizationId),
				eq(employee.isActive, true),
				isNotNull(employee.birthday),
			),
		);
	// Under 18 on the window's first day is under 18 somewhere in it.
	const minors = people.filter(
		(person) =>
			person.birthday !== null && isMinorOn(birthdayCalendarDate(person.birthday), windowStart),
	);
	const names = new Map(minors.map((person) => [person.employeeId, nameOf(person)]));
	const findings = await evaluateSectorFindings(db, {
		...input,
		employeeIds: minors.map((person) => person.employeeId),
		window: { start: windowStart.toString(), endExclusive: windowEnd.toString() },
	});

	const open: OpenYouthSectorException[] = [];
	for (const finding of findings) {
		const status = finding.acknowledgement?.status ?? "none";
		if (status === "current" || !isSectorExceptionKind(finding.kind)) continue;
		open.push({
			findingId: finding.id,
			employeeId: finding.employeeId,
			employeeName: names.get(finding.employeeId) ?? finding.employeeId,
			findingKind: finding.kind,
			subjectKey: finding.subjectKey,
			periodStart: finding.periodStart,
			legalReference: finding.legalReference,
			used: finding.summary.used ?? null,
			acknowledgementStatus: status,
			inputFingerprint: finding.inputFingerprint,
		});
	}
	return open.sort(
		(left, right) =>
			left.periodStart.localeCompare(right.periodStart) ||
			left.employeeName.localeCompare(right.employeeName) ||
			left.findingId.localeCompare(right.findingId),
	);
}

/**
 * Acknowledges one sector-exception finding as an org admin. The finding is evaluated again on
 * its day; the acknowledgement records that evaluation's subject and fingerprint, and only when
 * the fingerprint is the one the admin was shown (`expectedFingerprint`).
 */
export async function acknowledgeYouthSectorException(
	db: Pick<DatabaseClient, "select" | "query" | "insert">,
	input: {
		readonly organizationId: string;
		readonly actorUserId: string;
		readonly timezone: string;
		readonly now: Instant;
		readonly employeeId: string;
		readonly findingKind: JarbschgSectorExceptionKind;
		readonly subjectKey: string;
		readonly periodStart: string;
		readonly expectedFingerprint: string;
		readonly reason: string;
		readonly legalNote?: string | null;
	},
): Promise<StatutoryAcknowledgementRecord> {
	const day = parsePlainDate(input.periodStart);
	const findings = await evaluateSectorFindings(db, {
		organizationId: input.organizationId,
		timezone: input.timezone,
		now: input.now,
		employeeIds: [input.employeeId],
		window: { start: day.toString(), endExclusive: day.add({ days: 1 }).toString() },
	});
	const finding = findings.find(
		(candidate) =>
			candidate.employeeId === input.employeeId &&
			candidate.kind === input.findingKind &&
			candidate.subjectKey === input.subjectKey,
	);
	const subject = finding ? statutoryAcknowledgementSubjectOf(finding) : null;
	if (!finding || !subject) {
		throw new ValidationError({
			message: "This youth protection finding no longer exists",
			refusal: "statutory_finding_not_found" satisfies YouthSectorExceptionRefusal,
		});
	}
	if (finding.inputFingerprint !== input.expectedFingerprint) {
		throw new ValidationError({
			message: "The shift or its work changed since you reviewed it. Review it again.",
			refusal: "statutory_finding_changed" satisfies YouthSectorExceptionRefusal,
		});
	}
	return recordStatutoryAcknowledgement(db, {
		...subject,
		organizationId: input.organizationId,
		actorUserId: input.actorUserId,
		inputFingerprint: finding.inputFingerprint,
		reason: input.reason,
		legalNote: input.legalNote,
	});
}
