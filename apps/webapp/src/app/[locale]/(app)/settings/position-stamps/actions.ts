"use server";

import { revalidatePath } from "next/cache";
import { getAuthContext } from "@/lib/auth-helpers";
import { instantToCanonicalString, systemClock } from "@/lib/datetime/temporal-core";
import { offsetMinutesToTimeZoneId } from "@/lib/datetime/temporal-format";
import { listPositionStampAccessLog } from "@/lib/time-tracking/position-capture/access-log";
import { runPositionCaptureAction } from "@/lib/time-tracking/position-capture/action-runner";
import {
	type PositionCaptureActionResult,
	PositionCaptureRefusal,
	requireUuid,
} from "@/lib/time-tracking/position-capture/errors";
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

const PAGE_PATH = "/settings/position-stamps";

export async function getOwnPositionCaptureAction(): Promise<
	PositionCaptureActionResult<OwnPositionCaptureData>
> {
	return runPositionCaptureAction("positionCapture.own", async (db) => {
		const subject = await requireOwnEmployee();
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
	});
}

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

/** Who was shown the signed-in employee's position stamps, newest first. */
export async function getOwnPositionStampAccessLogAction(): Promise<
	PositionCaptureActionResult<OwnPositionStampAccessEntry[]>
> {
	return runPositionCaptureAction("positionCapture.ownAccessLog", async (db) => {
		const subject = await requireOwnEmployee();
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
	});
}

/** Gives the signed-in employee's position consent to the notice version they were shown. */
export async function agreeToPositionNoticeAction(input: {
	noticeId: string;
}): Promise<PositionCaptureActionResult<{ grantedAt: string }>> {
	return runPositionCaptureAction("positionCapture.agree", async (db) => {
		const subject = await requireOwnEmployee();
		const noticeId = parseNoticeId(input?.noticeId);
		const { grantedAt } = await db.transaction((tx) =>
			agreeToPositionNotice(tx, { ...subject, noticeId, now: systemClock.nowInstant() }),
		);
		revalidatePath(PAGE_PATH);
		return { grantedAt: instantToCanonicalString(grantedAt) };
	});
}

/** "Not now" for the notice version they were shown; asked again only for a new version. */
export async function declinePositionNoticeAction(input: {
	noticeId: string;
}): Promise<PositionCaptureActionResult<{ declined: true }>> {
	return runPositionCaptureAction("positionCapture.decline", async (db) => {
		const subject = await requireOwnEmployee();
		const noticeId = parseNoticeId(input?.noticeId);
		await db.transaction((tx) =>
			declinePositionNotice(tx, { ...subject, noticeId, now: systemClock.nowInstant() }),
		);
		revalidatePath(PAGE_PATH);
		return { declined: true };
	});
}

/** Withdraws the signed-in employee's position consent. */
export async function withdrawPositionConsentAction(): Promise<
	PositionCaptureActionResult<{ withdrawn: number }>
> {
	return runPositionCaptureAction("positionCapture.withdraw", async (db) => {
		const subject = await requireOwnEmployee();
		const { withdrawnConsentIds } = await db.transaction((tx) =>
			withdrawPositionConsent(tx, { ...subject, now: systemClock.nowInstant() }),
		);
		revalidatePath(PAGE_PATH);
		return { withdrawn: withdrawnConsentIds.length };
	});
}

/** The signed-in user's own employee profile in the active organization; never anyone else's. */
async function requireOwnEmployee(): Promise<{ organizationId: string; employeeId: string }> {
	const authContext = await getAuthContext();
	const organizationId = authContext?.session.activeOrganizationId ?? null;
	const ownEmployee = authContext?.employee;
	if (!ownEmployee || !organizationId || ownEmployee.organizationId !== organizationId) {
		throw new PositionCaptureRefusal(
			"employee_profile_required",
			"An employee profile in this organization is required.",
		);
	}
	return { organizationId, employeeId: ownEmployee.id };
}

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
