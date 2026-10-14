import { and, eq } from "drizzle-orm";
import {
	absenceChangeRequest,
	approvalStageAssignment,
	approvalWorkflowStage,
	employee,
} from "@/db/schema";
import { kickApprovalDelivery } from "@/lib/approvals/delivery/kick";
import { createLogger } from "@/lib/logger";
import { createNotification } from "@/lib/notifications/notification-service";
import { addCalendarSyncJob } from "@/lib/queue";
import { absenceChangeNotificationContent } from "./change-request-notification-copy";
import type { AbsenceChangeDatabase, applyAbsenceChange } from "./change-request-store";
import { notifyAbsenceDeputies } from "./deputy-notifier";

const logger = createLogger("AbsenceChangePostCommit");
export type AppliedAbsenceChange = Awaited<ReturnType<typeof applyAbsenceChange>>;

/** Delivery failure never turns an already committed decision into a failed mutation. */
export async function publishAbsenceChange(
	database: AbsenceChangeDatabase,
	input: {
		organizationId: string;
		workflowId: string;
		requestId: string;
		applied?: AppliedAbsenceChange | null;
	},
) {
	kickApprovalDelivery(input);
	try {
		const [request] = await database
			.select()
			.from(absenceChangeRequest)
			.where(
				and(
					eq(absenceChangeRequest.id, input.requestId),
					eq(absenceChangeRequest.organizationId, input.organizationId),
				),
			);
		if (!request) return;
		const recipients =
			request.status === "pending"
				? await database
						.select({
							userId: employee.userId,
							assignmentId: approvalStageAssignment.id,
						})
						.from(approvalStageAssignment)
						.innerJoin(
							approvalWorkflowStage,
							and(
								eq(approvalWorkflowStage.id, approvalStageAssignment.stageId),
								eq(approvalWorkflowStage.organizationId, input.organizationId),
								eq(approvalWorkflowStage.status, "pending"),
							),
						)
						.innerJoin(
							employee,
							and(
								eq(employee.id, approvalStageAssignment.approverEmployeeId),
								eq(employee.organizationId, input.organizationId),
							),
						)
						.where(
							and(
								eq(approvalStageAssignment.organizationId, input.organizationId),
								eq(approvalStageAssignment.workflowId, input.workflowId),
								eq(approvalStageAssignment.status, "pending"),
							),
						)
				: [{ userId: request.submittedBy, assignmentId: request.status }];
		const content = absenceChangeNotificationContent(request);
		await Promise.all(
			recipients.map(({ userId, assignmentId }) =>
				createNotification({
					organizationId: input.organizationId,
					userId,
					type:
						request.status === "pending"
							? "approval_request_submitted"
							: request.status === "approved"
								? "approval_request_approved"
								: "approval_request_rejected",
					title: content.title,
					message: content.message,
					metadata: { i18n: content.i18n },
					entityType: "absence_change_request",
					entityId: request.id,
					actionUrl:
						request.status === "pending"
							? "/approvals/inbox?types=absence_change_request"
							: "/absences",
					idempotencyKey: `absence-change:${request.id}:${assignmentId}`,
				}),
			),
		);
	} catch (error) {
		logger.warn(
			{ errorName: error instanceof Error ? error.name : "Unknown" },
			"Could not publish absence change notifications",
		);
	}
	if (input.applied) {
		try {
			const [request] = await database
				.select({ employeeId: absenceChangeRequest.employeeId })
				.from(absenceChangeRequest)
				.where(
					and(
						eq(absenceChangeRequest.id, input.requestId),
						eq(absenceChangeRequest.organizationId, input.organizationId),
					),
				);
			if (!request) return;
			const effects = await Promise.allSettled([
				...input.applied.calendarUpdates.map((update) =>
					addCalendarSyncJob({
						...update,
						employeeId: request.employeeId,
						organizationId: input.organizationId,
					}),
				),
				notifyAbsenceDeputies(database, {
					organizationId: input.organizationId,
					events: input.applied.deputyEvents,
				}),
			]);
			if (effects.some((effect) => effect.status === "rejected"))
				logger.warn("Some absence calendar updates could not be delivered");
			// Sick-note deletion already queued durable object cleanup in the approval transaction.
		} catch (error) {
			logger.warn(
				{ errorName: error instanceof Error ? error.name : "Unknown" },
				"Could not publish committed absence calendar updates",
			);
		}
	}
}
