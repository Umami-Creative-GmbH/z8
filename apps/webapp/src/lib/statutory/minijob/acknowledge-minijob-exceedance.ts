/**
 * Documents an occasional unforeseeable Minijob exceedance (§ 8 Abs. 1b SGB IV, #1989). The
 * month is evaluated again here, so the acknowledgement always carries the server's own input
 * fingerprint; a month above twice its cap, or a third exceedance month within 12 months, cannot
 * be acknowledged. Callers authorize org admins first.
 */
import { type Instant, parsePlainDate, plainDateAt } from "@/lib/datetime/temporal-core";
import { ValidationError } from "@/lib/effect/errors";
import type { DatabaseClient } from "@/lib/effect/services/database.service";
import { loadOrganizationTimezone } from "@/lib/timezone/load-organization-timezone";
import {
	recordStatutoryAcknowledgement,
	type StatutoryAcknowledgementRecord,
	statutoryAcknowledgementSubjectOf,
} from "../acknowledgements";
import { loadEmployeeInOrganization } from "../employee-scope";
import { loadOrganizationStatutoryPreferences } from "../preferences";
import { evaluateMinijobEarnings } from "./evaluate-minijob";
import { addMonths, MINIJOB_MONTHLY_FINDING } from "./minijob-months";

export type MinijobExceedanceRefusal =
	| "minijob_invalid_month"
	| "minijob_not_exceeded"
	| "minijob_exceedance_not_acknowledgeable";

const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

export async function acknowledgeMinijobExceedance(
	db: Pick<DatabaseClient, "select" | "insert">,
	input: {
		readonly organizationId: string;
		readonly actorUserId: string;
		readonly employeeId: string;
		/** `YYYY-MM`. */
		readonly month: string;
		readonly reason: string;
		readonly legalNote?: string | null;
		readonly now: Instant;
	},
): Promise<StatutoryAcknowledgementRecord> {
	if (!MONTH_PATTERN.test(input.month)) {
		throw new ValidationError({
			message: "Choose a calendar month",
			field: "month",
			refusal: "minijob_invalid_month" satisfies MinijobExceedanceRefusal,
		});
	}
	await loadEmployeeInOrganization(db, input);
	const timezone = await loadOrganizationTimezone(db, input.organizationId);
	const preferences = await loadOrganizationStatutoryPreferences(db, input.organizationId);
	const { findings } = await evaluateMinijobEarnings(db, {
		organizationId: input.organizationId,
		timezone,
		employeeIds: [input.employeeId],
		months: { from: input.month, until: addMonths(input.month, 1) },
		preferences,
		now: input.now,
	});
	const finding = findings.find(
		(f) => f.kind === MINIJOB_MONTHLY_FINDING && f.subjectKey === input.month,
	);
	const subject = finding ? statutoryAcknowledgementSubjectOf(finding) : null;
	if (!finding || !subject) {
		throw new ValidationError({
			message: "The month's Minijob earnings are within the limit",
			field: "month",
			refusal: "minijob_not_exceeded" satisfies MinijobExceedanceRefusal,
		});
	}
	if (finding.adminDetail?.facts?.acknowledgeable !== true) {
		throw new ValidationError({
			message:
				"This month cannot count as an unforeseeable exceedance: it is above twice the limit or the third exceedance within 12 months",
			field: "month",
			refusal: "minijob_exceedance_not_acknowledgeable" satisfies MinijobExceedanceRefusal,
		});
	}
	return recordStatutoryAcknowledgement(db, {
		...subject,
		organizationId: input.organizationId,
		actorUserId: input.actorUserId,
		inputFingerprint: finding.inputFingerprint,
		reason: input.reason,
		legalNote: input.legalNote,
		metadata: {
			amountsCents: finding.adminDetail?.amountsCents ?? {},
			evaluatedOn: plainDateAt(input.now, timezone).toString(),
		},
	});
}

/** The organization-local current month, `YYYY-MM`. */
export function currentMonthAt(now: Instant, timezone: string): string {
	return plainDateAt(now, timezone).toString().slice(0, 7);
}

/** Validates a `YYYY-MM` month string. */
export function isMinijobMonth(value: string): boolean {
	if (!MONTH_PATTERN.test(value)) return false;
	parsePlainDate(`${value}-01`);
	return true;
}
