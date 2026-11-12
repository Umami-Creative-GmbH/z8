"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { instantToCanonicalString, systemClock } from "@/lib/datetime/temporal-core";
import { offsetMinutesToTimeZoneId } from "@/lib/datetime/temporal-format";
import { queryOrRefuse } from "@/lib/effect/refusal-query";
import type { DatabaseClient } from "@/lib/effect/services/database.service";
import {
	noInput,
	type OrganizationActionContext,
	organizationAction,
} from "@/lib/organization-action/organization-action";
import { listPositionStampAccessLog } from "@/lib/time-tracking/position-capture/access-log";
import { PositionCaptureRefusal, requireUuid } from "@/lib/time-tracking/position-capture/errors";
import type { PositionConsentDecision } from "@/lib/time-tracking/position-capture/policy";
import { resolvePositionCapture } from "@/lib/time-tracking/position-capture/resolver";
import {
	agreeToPositionNotice,
	declinePositionNotice,
	withdrawPositionConsent,
} from "@/lib/time-tracking/position-capture/store";

/** Serializable consent decision: instants as ISO strings. */
export type OwnPositionConsentData =
	| { kind: "active"; noticeVersion: number; grantedAt: string }
	| { kind: "lapsed"; noticeVersion: number; grantedAt: string }
	| { kind: "declined"; noticeVersion: number; declinedAt: string }
	| { kind: "withdrawn"; noticeVersion: number; withdrawnAt: string }
	| { kind: "undecided" };

export type OwnPositionCaptureData = {
	captureOn: boolean;
	retentionDays: number;
	notice: {
		id: string;
		version: number;
		purposeStatement: string;
		retentionDays: number;
		templateRevision: number;
		createdAt: string;
	} | null;
	consent: OwnPositionConsentData;
	canWithdraw: boolean;
	asksForConsent: boolean;
};

/** One entry of the employee's own position stamp access log, serializable. */
export type OwnPositionStampAccessEntry = {
	id: string;
	kind: "work_period_detail" | "data_export";
	/** Null when the viewer's account no longer exists. */
	viewerName: string | null;
	accessedAt: string;
	/** Each work period's clock-in date at its own recorded offset; null if it no longer exists. */
	workPeriods: Array<{ id: string; date: string | null }>;
};

const PAGE_PATH = "/settings/position-stamps";

/** The notice the employee was shown; a malformed ID is refused as `invalid_notice` by the store rules. */
const noticeInput = z.strictObject({ noticeId: z.unknown() });

type OwnSubject = { organizationId: string; employeeId: string };

/**
 * Runs position capture work for the signed-in user's own employee profile in
 * the active organization, never anyone else's. A `PositionCaptureRefusal`
 * comes back as its code; without an employee profile here (an owner or admin
 * without one) the code is `employee_profile_required`.
 */
function forOwnEmployee<T>(
	name: string,
	{ actor, organizationId }: OrganizationActionContext<unknown>,
	run: (db: DatabaseClient, subject: OwnSubject) => Promise<T>,
) {
	return queryOrRefuse(name, PositionCaptureRefusal, (db) => {
		if (!actor.employee) {
			throw new PositionCaptureRefusal(
				"employee_profile_required",
				"An employee profile in this organization is required.",
			);
		}
		return run(db, { organizationId, employeeId: actor.employee.id });
	});
}

export const getOwnPositionCaptureAction = organizationAction(
	{ name: "positionCapture.own", requires: "member", schema: noInput },
	(context) =>
		forOwnEmployee(
			"positionCapture.own",
			context,
			async (db, subject): Promise<OwnPositionCaptureData> => {
				const resolution = await resolvePositionCapture(db, subject);
				return {
					captureOn: resolution.captureOn,
					retentionDays: resolution.retentionDays,
					notice: resolution.notice
						? {
								...resolution.notice,
								createdAt: instantToCanonicalString(resolution.notice.createdAt),
							}
						: null,
					consent: toConsentData(resolution.consent),
					canWithdraw: resolution.canWithdraw,
					asksForConsent: resolution.asksForConsent,
				};
			},
		),
);

/** Who was shown the signed-in employee's position stamps, newest first. */
export const getOwnPositionStampAccessLogAction = organizationAction(
	{ name: "positionCapture.ownAccessLog", requires: "member", schema: noInput },
	(context) =>
		forOwnEmployee(
			"positionCapture.ownAccessLog",
			context,
			async (db, subject): Promise<OwnPositionStampAccessEntry[]> => {
				const entries = await listPositionStampAccessLog(db, {
					organizationId: subject.organizationId,
					subjectEmployeeId: subject.employeeId,
				});
				return entries.map((entry) => ({
					id: entry.id,
					kind: entry.kind,
					viewerName: entry.viewer?.name ?? null,
					accessedAt: instantToCanonicalString(entry.accessedAt),
					workPeriods: entry.workPeriods.map((period) => ({
						id: period.id,
						date:
							period.startedAt && period.utcOffsetMinutes !== null
								? period.startedAt
										.toZonedDateTimeISO(offsetMinutesToTimeZoneId(period.utcOffsetMinutes))
										.toPlainDate()
										.toString()
								: null,
					})),
				}));
			},
		),
);

/** Gives the signed-in employee's position consent to the notice version they were shown. */
export const agreeToPositionNoticeAction = organizationAction(
	{ name: "positionCapture.agree", requires: "member", schema: noticeInput },
	(context) =>
		forOwnEmployee("positionCapture.agree", context, async (db, subject) => {
			const noticeId = parseNoticeId(context.input.noticeId);
			const { grantedAt } = await db.transaction((tx) =>
				agreeToPositionNotice(tx, { ...subject, noticeId, now: systemClock.nowInstant() }),
			);
			revalidatePath(PAGE_PATH);
			return { grantedAt: instantToCanonicalString(grantedAt) };
		}),
);

/** "Not now" for the notice version they were shown; asked again only for a new version. */
export const declinePositionNoticeAction = organizationAction(
	{ name: "positionCapture.decline", requires: "member", schema: noticeInput },
	(context) =>
		forOwnEmployee("positionCapture.decline", context, async (db, subject) => {
			const noticeId = parseNoticeId(context.input.noticeId);
			await db.transaction((tx) =>
				declinePositionNotice(tx, { ...subject, noticeId, now: systemClock.nowInstant() }),
			);
			revalidatePath(PAGE_PATH);
			return { declined: true as const };
		}),
);

/** Withdraws the signed-in employee's position consent. */
export const withdrawPositionConsentAction = organizationAction(
	{ name: "positionCapture.withdraw", requires: "member", schema: noInput },
	(context) =>
		forOwnEmployee("positionCapture.withdraw", context, async (db, subject) => {
			const { withdrawnConsentIds } = await db.transaction((tx) =>
				withdrawPositionConsent(tx, { ...subject, now: systemClock.nowInstant() }),
			);
			revalidatePath(PAGE_PATH);
			return { withdrawn: withdrawnConsentIds.length };
		}),
);

function parseNoticeId(value: unknown): string {
	return requireUuid(value, { code: "invalid_notice", message: "Invalid position notice." });
}

function toConsentData(consent: PositionConsentDecision): OwnPositionConsentData {
	switch (consent.kind) {
		case "active":
			return {
				kind: "active",
				noticeVersion: consent.noticeVersion,
				grantedAt: instantToCanonicalString(consent.grantedAt),
			};
		case "lapsed":
			return {
				kind: "lapsed",
				noticeVersion: consent.noticeVersion,
				grantedAt: instantToCanonicalString(consent.grantedAt),
			};
		case "declined":
			return {
				kind: "declined",
				noticeVersion: consent.noticeVersion,
				declinedAt: instantToCanonicalString(consent.declinedAt),
			};
		case "withdrawn":
			return {
				kind: "withdrawn",
				noticeVersion: consent.noticeVersion,
				withdrawnAt: instantToCanonicalString(consent.withdrawnAt),
			};
		case "undecided":
			return { kind: "undecided" };
	}
}
