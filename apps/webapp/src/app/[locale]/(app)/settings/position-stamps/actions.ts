"use server";

import { revalidatePath } from "next/cache";
import { getAuthContext } from "@/lib/auth-helpers";
import { instantToCanonicalString, systemClock } from "@/lib/datetime/temporal-core";
import { AuthenticationError, ValidationError } from "@/lib/effect/errors";
import type { ServerActionResult } from "@/lib/effect/result";
import { runPositionCaptureAction } from "@/lib/time-tracking/position-capture/action-runner";
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

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PAGE_PATH = "/settings/position-stamps";

export async function getOwnPositionCaptureAction(): Promise<
	ServerActionResult<OwnPositionCaptureData>
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

/** Gives the signed-in employee's position consent to the notice version they were shown. */
export async function agreeToPositionNoticeAction(input: {
	noticeId: string;
}): Promise<ServerActionResult<{ grantedAt: string }>> {
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
}): Promise<ServerActionResult<{ declined: true }>> {
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
	ServerActionResult<{ withdrawn: number }>
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
		throw new AuthenticationError({
			message: "An employee profile in this organization is required.",
		});
	}
	return { organizationId, employeeId: ownEmployee.id };
}

function parseNoticeId(value: unknown): string {
	if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
		throw new ValidationError({ message: "Invalid position notice.", field: "noticeId" });
	}
	return value;
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
