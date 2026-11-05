import "server-only";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import {
	getCurrentSession,
	getUserTimezone,
} from "@/app/[locale]/(app)/time-tracking/actions/auth";
import type { CorrectionRequest } from "@/app/[locale]/(app)/time-tracking/actions/types";
import { db } from "@/db";
import { member } from "@/db/auth-schema";
import {
	approvalRequest,
	approvalWorkflow,
	employee,
	workPeriod,
} from "@/db/schema";
import { instantFromDate, parseInstant } from "@/lib/datetime/temporal-core";
import { getInstantLocalMinuteFields } from "@/lib/datetime/temporal-format";
import { createLogger } from "@/lib/logger";
import { normalizeWorkLocationType } from "@/lib/time-tracking/work-location";
import { loadAuthorizedApprovalDetail } from "../inbox/authorized-detail";
import { resolveOnBehalfCorrectionAuthority } from "./time-correction-on-behalf";
import { parseTimeCorrectionReviewMetadata } from "./time-correction-review-metadata";

const logger = createLogger("TimeCorrectionRevision");

/** Read-only preparation. Rejection and replacement stay explicit, independently
 * retryable decisions owned by their existing authorization and write boundaries. */
export async function prepareTimeCorrectionRevision(approvalId: string) {
	try {
		if (!z.uuid().safeParse(approvalId).success)
			return { success: false as const, error: "Invalid approval reference" };
		const session = await getCurrentSession();
		const organizationId = session?.session.activeOrganizationId;
		if (!session?.user || !organizationId)
			return { success: false as const, error: "Unauthorized" };
		const authorized = await loadAuthorizedApprovalDetail({
			userId: session.user.id,
			organizationId,
			approvalId,
		});
		if (
			authorized.status !== "found" ||
			!authorized.detail.actions.canReject ||
			authorized.detail.item.type !== "time_entry"
		) {
			return {
				success: false as const,
				error: "Correction cannot be revised by this reviewer",
			};
		}
		const comparison = authorized.detail.sections.find(
			(section) => section.type === "time_comparison",
		);
		if (
			comparison?.action !== "edit" ||
			!comparison.requested.start ||
			!comparison.requested.end
		) {
			return {
				success: false as const,
				error: "Only completed time corrections can be revised",
			};
		}
		const actor = await db.query.employee.findFirst({
			where: and(
				eq(employee.userId, session.user.id),
				eq(employee.organizationId, organizationId),
				eq(employee.isActive, true),
			),
		});
		const membership = await db.query.member.findFirst({
			where: and(
				eq(member.userId, session.user.id),
				eq(member.organizationId, organizationId),
			),
		});
		const period = await db.query.workPeriod.findFirst({
			where: and(
				eq(workPeriod.id, authorized.detail.item.entityId),
				eq(workPeriod.organizationId, organizationId),
			),
			with: { employee: true },
		});
		if (
			!actor ||
			!period?.employee.isActive ||
			period.employee.organizationId !== organizationId ||
			!period.endTime ||
			period.deletedAt ||
			period.isActive ||
			!(await resolveOnBehalfCorrectionAuthority({
				db,
				organizationId,
				actorEmployeeId: actor.id,
				actorMemberRole: membership?.role,
				ownerEmployeeId: period.employeeId,
			}))
		) {
			return {
				success: false as const,
				error:
					"Only an eligible manager or organization administrator can revise this correction",
			};
		}
		const legacy = await db.query.approvalRequest.findFirst({
			where: and(
				eq(approvalRequest.id, approvalId),
				eq(approvalRequest.organizationId, organizationId),
			),
		});
		const workflow =
			!legacy && period.approvalWorkflowId
				? await db.query.approvalWorkflow.findFirst({
						where: and(
							eq(approvalWorkflow.id, period.approvalWorkflowId),
							eq(approvalWorkflow.organizationId, organizationId),
							eq(approvalWorkflow.sourceId, period.id),
							eq(approvalWorkflow.requesterEmployeeId, period.employeeId),
							eq(approvalWorkflow.status, "pending"),
						),
					})
				: null;
		if (
			legacy &&
			(legacy.status !== "pending" ||
				legacy.entityId !== period.id ||
				legacy.requestedBy !== period.employeeId)
		)
			return {
				success: false as const,
				error: "Correction changed. Refresh and try again.",
			};
		const metadata = parseTimeCorrectionReviewMetadata(
			legacy?.metadata ?? workflow?.contextSnapshot,
		);
		if (metadata.kind !== "valid_current" && metadata.kind !== "valid_legacy")
			return {
				success: false as const,
				error: "Correction evidence is unavailable. Refresh and try again.",
			};
		const timezone = await getUserTimezone(period.employee.userId);
		const start = getInstantLocalMinuteFields(
			parseInstant(comparison.requested.start.at),
			timezone,
		);
		const end = getInstantLocalMinuteFields(
			parseInstant(comparison.requested.end.at),
			timezone,
		);
		const originalStart = getInstantLocalMinuteFields(
			instantFromDate(period.startTime),
			timezone,
		);
		const originalEnd = getInstantLocalMinuteFields(
			instantFromDate(period.endTime),
			timezone,
		);
		const request: Omit<CorrectionRequest, "submissionId"> = {
			workPeriodId: period.id,
			newClockInDate: start.date,
			newClockInTime: start.time,
			newClockOutDate: end.date,
			newClockOutTime: end.time,
			reason: legacy?.reason ?? "",
			workLocationType:
				metadata.kind === "valid_current"
					? metadata.requested.workLocationType
					: normalizeWorkLocationType(period.workLocationType),
			workCategoryId:
				metadata.kind === "valid_current"
					? metadata.requested.workCategoryId
					: period.workCategoryId,
			...(metadata.kind === "valid_current" &&
			metadata.requested.vehicleUse !== undefined
				? { vehicleUse: metadata.requested.vehicleUse }
				: {}),
		};
		return {
			success: true as const,
			data: {
				request,
				timezone,
				originalStart,
				originalEnd,
				requestedRange: {
					startAt: comparison.requested.start.at,
					endAt: comparison.requested.end.at,
				},
				metadataChanged:
					metadata.kind === "valid_current" &&
					(metadata.requested.workLocationType !==
						normalizeWorkLocationType(period.workLocationType) ||
						metadata.requested.workCategoryId !== period.workCategoryId ||
						metadata.requested.vehicleUse !== undefined),
			},
		};
	} catch (error) {
		logger.error({ error }, "Could not prepare revised correction");
		return {
			success: false as const,
			error: "Could not prepare revised correction. Refresh and try again.",
		};
	}
}
