/**
 * Documents an occasional unforeseeable Minijob exceedance (§ 8 Abs. 1b SGB IV, #1989). The
 * month is evaluated again here, so the acknowledgement always carries the server's own input
 * fingerprint, and only when it and the month's total are the ones the admin was shown (the total
 * within one material step); a month above twice its cap, or a
 * third exceedance month within 12 months, cannot be acknowledged. Callers authorize org admins
 * first.
 */
import { type Instant, plainDateAt } from "@/lib/datetime/temporal-core";
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
import { addMonths, MINIJOB_MONTHLY_FINDING, minijobTotalCoveredBy } from "./minijob-months";

export type MinijobExceedanceRefusal =
	| "minijob_invalid_month"
	| "minijob_not_exceeded"
	| "minijob_exceedance_not_acknowledgeable"
	/** The month's figures changed since the admin saw them. */
	| "minijob_exceedance_changed";

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
		/** The month's fingerprint as the admin was shown it: nobody documents unseen figures. */
		readonly expectedFingerprint: string;
		/** The month's total in EUR cents as the admin was shown it (org admins only). */
		readonly expectedTotalCents: number;
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
	const { findings, employees } = await evaluateMinijobEarnings(db, {
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
	// Work added to a lapsed or short shift raises the total without changing the fingerprint, so
	// the total the admin was shown is a precondition too, by the step rule that keeps an
	// acknowledgement current.
	const month = employees.get(input.employeeId)?.find((m) => m.month === input.month);
	if (
		finding.inputFingerprint !== input.expectedFingerprint ||
		!month ||
		!minijobTotalCoveredBy(month, input.expectedTotalCents)
	) {
		throw new ValidationError({
			message: "The month's earnings changed since they were shown. Review them again",
			field: "month",
			refusal: "minijob_exceedance_changed" satisfies MinijobExceedanceRefusal,
		});
	}
	// The admin documented the total they were shown. If it has fallen since (a started shift has
	// lapsed), keep the shown total: work added back up to it is what they already acknowledged.
	const amountsCents = finding.adminDetail?.amountsCents ?? {};
	const documentedTotal = Math.max(input.expectedTotalCents, amountsCents.total ?? 0);
	return recordStatutoryAcknowledgement(db, {
		...subject,
		organizationId: input.organizationId,
		actorUserId: input.actorUserId,
		inputFingerprint: finding.inputFingerprint,
		reason: input.reason,
		legalNote: input.legalNote,
		metadata: {
			// The total is what the acknowledgement documents: a later rise beyond it makes it stale.
			amountsCents: { ...amountsCents, total: documentedTotal },
			evaluatedOn: plainDateAt(input.now, timezone).toString(),
		},
		// Documenting a risen total of an unchanged fingerprint records a new acknowledgement.
		revision: `total:${documentedTotal}`,
	});
}
