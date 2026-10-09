import "server-only";

import { and, asc, eq, inArray } from "drizzle-orm";
import { db as defaultDb } from "@/db";
import { user } from "@/db/auth-schema";
import {
	employee,
	positionCaptureAssignment,
	positionConsent,
	positionNotice,
	positionNoticeDecline,
	team,
} from "@/db/schema";
import { instantFromDate } from "@/lib/datetime/temporal-core";
import { listPositionStampAccessLog } from "@/lib/time-tracking/position-capture/access-log";
import type { PositionConsentRecord } from "@/lib/time-tracking/position-capture/policy";
import {
	listPositionNotices,
	type PositionCaptureClient,
	readPositionCaptureSettings,
} from "@/lib/time-tracking/position-capture/store";
import {
	buildPositionCaptureReview,
	type PositionCaptureReview,
	type PositionCaptureReviewSource,
	type PositionCaptureReviewVisibility,
} from "./position-capture-review";

/** How many access-log entries the portal shows, newest first. */
export const WORKS_COUNCIL_POSITION_ACCESS_LOG_LIMIT = 200;

/**
 * Loads the works-council portal's position capture section (#834) for one
 * organization. Every query is filtered by `organizationId`. It never reads
 * `position_stamp`: the section shows configuration, consent and access
 * records only.
 */
export async function loadPositionCaptureReviewSource(
	db: PositionCaptureClient,
	organizationId: string,
): Promise<PositionCaptureReviewSource> {
	const [settings, notices, assignments, employees, consents, accessLog] = await Promise.all([
		readPositionCaptureSettings(db, organizationId),
		listPositionNotices(db, organizationId),
		db
			.select({
				id: positionCaptureAssignment.id,
				assignmentType: positionCaptureAssignment.assignmentType,
				teamId: positionCaptureAssignment.teamId,
				teamName: team.name,
				employeeId: positionCaptureAssignment.employeeId,
				captureEnabled: positionCaptureAssignment.captureEnabled,
			})
			.from(positionCaptureAssignment)
			.leftJoin(
				team,
				and(
					eq(team.id, positionCaptureAssignment.teamId),
					eq(team.organizationId, positionCaptureAssignment.organizationId),
				),
			)
			.where(eq(positionCaptureAssignment.organizationId, organizationId))
			.orderBy(asc(positionCaptureAssignment.priority), asc(positionCaptureAssignment.createdAt)),
		db
			.select({ employeeId: employee.id, teamId: employee.teamId })
			.from(employee)
			.where(and(eq(employee.organizationId, organizationId), eq(employee.isActive, true))),
		db
			.select({
				id: positionConsent.id,
				employeeId: positionConsent.employeeId,
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
			.where(eq(positionConsent.organizationId, organizationId)),
		listPositionStampAccessLog(db, {
			organizationId,
			limit: WORKS_COUNCIL_POSITION_ACCESS_LOG_LIMIT,
		}),
	]);

	const current = notices[0] ?? null;
	const declines = current
		? await db
				.select({
					employeeId: positionNoticeDecline.employeeId,
					noticeId: positionNoticeDecline.noticeId,
					declinedAt: positionNoticeDecline.declinedAt,
				})
				.from(positionNoticeDecline)
				.where(
					and(
						eq(positionNoticeDecline.organizationId, organizationId),
						eq(positionNoticeDecline.noticeId, current.id),
					),
				)
		: [];

	const referencedEmployeeIds = [
		...new Set([
			...assignments.flatMap((row) => (row.employeeId ? [row.employeeId] : [])),
			...accessLog.flatMap((entry) => entry.subjectEmployeeIds),
		]),
	];
	const names =
		referencedEmployeeIds.length === 0
			? []
			: await db
					.select({
						employeeId: employee.id,
						userName: user.name,
						employeeNumber: employee.employeeNumber,
					})
					.from(employee)
					.leftJoin(user, eq(user.id, employee.userId))
					.where(
						and(
							eq(employee.organizationId, organizationId),
							inArray(employee.id, referencedEmployeeIds),
						),
					);

	const consentsByEmployee = groupBy(consents, (row) => row.employeeId);
	const declinesByEmployee = groupBy(declines, (row) => row.employeeId);

	return {
		settings,
		notices,
		assignments,
		employees: employees.map((row) => ({
			employeeId: row.employeeId,
			teamId: row.teamId,
			consents: (consentsByEmployee.get(row.employeeId) ?? []).map(
				(consent): PositionConsentRecord => ({
					id: consent.id,
					noticeId: consent.noticeId,
					noticeVersion: consent.noticeVersion,
					grantedAt: instantFromDate(consent.grantedAt),
					withdrawnAt: consent.withdrawnAt ? instantFromDate(consent.withdrawnAt) : null,
				}),
			),
			declines: (declinesByEmployee.get(row.employeeId) ?? []).map((decline) => ({
				noticeId: decline.noticeId,
				declinedAt: instantFromDate(decline.declinedAt),
			})),
		})),
		employeeNames: Object.fromEntries(
			names.flatMap((row) => {
				const name = row.userName?.trim() || row.employeeNumber?.trim();
				return name ? [[row.employeeId, name] as const] : [];
			}),
		),
		accessLog: accessLog.map((entry) => ({
			id: entry.id,
			kind: entry.kind,
			accessedAt: entry.accessedAt,
			viewer: entry.viewer,
			subjectEmployeeIds: entry.subjectEmployeeIds,
			workPeriods: entry.workPeriods.map((period) => ({ id: period.id })),
		})),
	};
}

/** The section for the portal page and the review export. */
export async function loadWorksCouncilPositionCaptureReview(input: {
	organizationId: string;
	settings: PositionCaptureReviewVisibility;
	db?: PositionCaptureClient;
}): Promise<PositionCaptureReview> {
	const source = await loadPositionCaptureReviewSource(input.db ?? defaultDb, input.organizationId);
	return buildPositionCaptureReview(source, {
		identityVisibility: input.settings.identityVisibility,
		minimumAggregationThreshold: input.settings.minimumAggregationThreshold,
	});
}

function groupBy<T>(rows: readonly T[], keyOf: (row: T) => string): Map<string, T[]> {
	const groups = new Map<string, T[]>();
	for (const row of rows) {
		const key = keyOf(row);
		const list = groups.get(key);
		if (list) list.push(row);
		else groups.set(key, [row]);
	}
	return groups;
}
