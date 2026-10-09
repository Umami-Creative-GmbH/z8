import "server-only";

import { and, eq, or } from "drizzle-orm";
import {
	employee,
	positionCaptureAssignment,
	positionCaptureSetting,
	positionConsent,
	positionNotice,
	positionNoticeDecline,
} from "@/db/schema";
import { compareInstants, type Instant, instantFromDate } from "@/lib/datetime/temporal-core";
import {
	captureAssignedTo,
	hasDecidedNotice,
	type PositionCaptureAssignmentRule,
	type PositionConsentDecision,
	positionConsentDecision,
} from "./policy";
import {
	DEFAULT_POSITION_CAPTURE_SETTINGS,
	type PositionCaptureClient,
	type PositionNoticeVersion,
	readCurrentPositionNotice,
} from "./store";

/** What position capture means for one employee of one organization, right now. */
export type PositionCaptureResolution = {
	organizationId: string;
	employeeId: string;
	/** The master switch is on and the most specific assignment switches capture on for them. */
	captureOn: boolean;
	/** The organization's current retention, which sets a new stamp's purge date. */
	retentionDays: number;
	/** The current position notice, if one was ever published. */
	notice: PositionNoticeVersion | null;
	consent: PositionConsentDecision;
	/** Capture is on and the employee's consent to the current notice is active. */
	mayCapture: boolean;
	/** Capture is on, a notice exists and the employee has not answered it yet (#826 dialog). */
	asksForConsent: boolean;
	/** The employee holds unwithdrawn consent (active or lapsed) they can withdraw. */
	canWithdraw: boolean;
};

/**
 * Resolves position capture for an employee from current data, filtered by
 * `organizationId`. An employee outside the organization resolves to capture off.
 *
 * Inside a clock command's work transaction pass `{ lock: "share" }`: the
 * settings row and the employee's consent rows are then read `FOR SHARE` (row
 * locks, the last rank of the acquisition protocol), so a concurrent settings
 * save, assignment change or withdrawal waits for the command to commit.
 */
export async function resolvePositionCapture(
	db: PositionCaptureClient,
	subject: { organizationId: string; employeeId: string },
	options: { lock?: "share" } = {},
): Promise<PositionCaptureResolution> {
	const { organizationId, employeeId } = subject;
	const settingsQuery = db
		.select({
			enabled: positionCaptureSetting.enabled,
			retentionDays: positionCaptureSetting.retentionDays,
		})
		.from(positionCaptureSetting)
		.where(eq(positionCaptureSetting.organizationId, organizationId))
		.$dynamic();
	const [settingsRow] = await (options.lock ? settingsQuery.for("share") : settingsQuery);
	const settings = settingsRow ?? DEFAULT_POSITION_CAPTURE_SETTINGS;

	const [subjectRow] = await db
		.select({ teamId: employee.teamId })
		.from(employee)
		.where(and(eq(employee.organizationId, organizationId), eq(employee.id, employeeId)))
		.limit(1);

	const notice = await readCurrentPositionNotice(db, organizationId);
	const consentQuery = db
		.select({
			id: positionConsent.id,
			noticeId: positionConsent.noticeId,
			noticeVersion: positionNotice.version,
			grantedAt: positionConsent.grantedAt,
			withdrawnAt: positionConsent.withdrawnAt,
		})
		.from(positionConsent)
		.innerJoin(
			positionNotice,
			and(
				eq(positionNotice.id, positionConsent.noticeId),
				eq(positionNotice.organizationId, positionConsent.organizationId),
			),
		)
		.where(
			and(
				eq(positionConsent.organizationId, organizationId),
				eq(positionConsent.employeeId, employeeId),
			),
		)
		.$dynamic();
	const consentRows = await (options.lock
		? consentQuery.for("share", { of: positionConsent })
		: consentQuery);
	const consents = consentRows.map((row) => ({
		...row,
		grantedAt: instantFromDate(row.grantedAt),
		withdrawnAt: row.withdrawnAt ? instantFromDate(row.withdrawnAt) : null,
	}));
	const declines = notice
		? (
				await db
					.select({
						noticeId: positionNoticeDecline.noticeId,
						declinedAt: positionNoticeDecline.declinedAt,
					})
					.from(positionNoticeDecline)
					.where(
						and(
							eq(positionNoticeDecline.organizationId, organizationId),
							eq(positionNoticeDecline.employeeId, employeeId),
							eq(positionNoticeDecline.noticeId, notice.id),
						),
					)
			).map((row) => ({ ...row, declinedAt: instantFromDate(row.declinedAt) }))
		: [];

	let assigned = false;
	if (settings.enabled && subjectRow) {
		const teamId = subjectRow.teamId;
		const assignmentRows = await db
			.select({
				assignmentType: positionCaptureAssignment.assignmentType,
				teamId: positionCaptureAssignment.teamId,
				employeeId: positionCaptureAssignment.employeeId,
				captureEnabled: positionCaptureAssignment.captureEnabled,
			})
			.from(positionCaptureAssignment)
			.where(
				and(
					eq(positionCaptureAssignment.organizationId, organizationId),
					or(
						eq(positionCaptureAssignment.assignmentType, "organization"),
						eq(positionCaptureAssignment.employeeId, employeeId),
						teamId ? eq(positionCaptureAssignment.teamId, teamId) : undefined,
					),
				),
			);
		assigned = captureAssignedTo({ employeeId, teamId }, assignmentRows.map(toAssignmentRule));
	}

	const consent = subjectRow
		? positionConsentDecision({ notice, consents, declines })
		: ({ kind: "undecided" } as const);
	const captureOn = settings.enabled && assigned;
	return {
		organizationId,
		employeeId,
		captureOn,
		retentionDays: settings.retentionDays,
		notice,
		consent,
		mayCapture: captureOn && consent.kind === "active",
		asksForConsent:
			captureOn && notice !== null && !hasDecidedNotice({ notice, consents, declines }),
		canWithdraw: consents.some((row) => row.withdrawnAt === null),
	};
}

/**
 * The server check for a position stamp carried by a clock command (#826): keep
 * it only if capture is on, consent to the current notice is active, and that
 * consent was given before the event happened.
 */
export function acceptsPositionStamp(
	resolution: PositionCaptureResolution,
	occurredAt: Instant,
): boolean {
	return (
		resolution.mayCapture &&
		resolution.consent.kind === "active" &&
		compareInstants(resolution.consent.grantedAt, occurredAt) < 0
	);
}

function toAssignmentRule(row: {
	assignmentType: "organization" | "team" | "employee";
	teamId: string | null;
	employeeId: string | null;
	captureEnabled: boolean;
}): PositionCaptureAssignmentRule {
	if (row.assignmentType === "team" && row.teamId) {
		return { assignmentType: "team", teamId: row.teamId, captureEnabled: row.captureEnabled };
	}
	if (row.assignmentType === "employee" && row.employeeId) {
		return {
			assignmentType: "employee",
			employeeId: row.employeeId,
			captureEnabled: row.captureEnabled,
		};
	}
	return { assignmentType: "organization", captureEnabled: row.captureEnabled };
}
