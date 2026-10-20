import "server-only";
import { and, eq, gt, isNull } from "drizzle-orm";
import { member, user } from "@/db/auth-schema";
import { drivingLicenceCheck } from "@/db/schema/driving-licence-checks";
import { drivingLicencePolicy } from "@/db/schema/driving-licence-policy";
import { drivingLicenceTask } from "@/db/schema/driving-licence-tasks";
import { hasOrganizationRole } from "@/lib/auth/organization-role";
import { isReservedEmail } from "@/lib/auth/reserved-email";
import { dateFromInstant, type Instant } from "@/lib/datetime/temporal-core";
import { translatedContent } from "@/lib/notifications/notification-copy";
import { insertInAppNotification } from "@/lib/notifications/notification-service";
import { resolveDrivingLicenceAccess } from "./access";
import { currentDrivingEmployment } from "./checks";
import type { DrivingLicenceActor } from "./context";
import { listDrivingLicenceIntendedDriverIds } from "./intended-drivers";
import { drivingLicenceCheckPath } from "./paths";
import {
	collectDrivingLicenceReminderOccasions,
	type DrivingLicenceReminderOccasion,
	resolveDrivingLicenceReminderRecipients,
} from "./reminders";
import type { DrivingLicenceTransaction } from "./verifiers";

type TaskRow = typeof drivingLicenceTask.$inferSelect;
type TaskBase = {
	id: string;
	employeeId: string;
	employeeName: string;
	state: "pending" | "completed";
	completedAt: string | null;
};
export type DrivingLicenceTaskView =
	| (TaskBase & {
			kind: "personal_reminder";
			directEmployeeNotification: "unavailable";
			occasion: {
				kind: "initial" | "deadline" | "suspension";
				classCode: string | null;
				validThrough: string | null;
			};
	  })
	| (TaskBase & { kind: "reassignment" });

async function notifyAssignment(
	tx: DrivingLicenceTransaction,
	row: TaskRow,
	employeeName: string,
	recipients: string[],
) {
	const assignment = row.kind === "reassignment";
	const content = translatedContent(
		assignment
			? {
					titleKey:
						"common:notifications.content.drivingLicenceAssignment.title",
					titleDefault: "Assign driving licence verifier responsibility",
					messageKey:
						"common:notifications.content.drivingLicenceAssignment.message",
					messageDefault:
						"Arrange an available verifier for {employeeName}. This task grants no inspection rights and does not extend any deadline.",
				}
			: {
					titleKey:
						"common:notifications.content.drivingLicencePersonalTask.title",
					titleDefault: "Remind employee in person",
					messageKey:
						"common:notifications.content.drivingLicencePersonalTask.message",
					messageDefault:
						"Remind {employeeName} to arrange an original driving licence check. Direct employee notification was unavailable. Task completion is not direct delivery or reading.",
				},
		{ employeeName },
	);
	for (const userId of recipients)
		await insertInAppNotification(
			{
				userId,
				organizationId: row.organizationId,
				type: "driving_licence_reminder",
				title: content.title,
				message: content.message,
				entityType: "driving_licence_task",
				entityId: row.id,
				// A personal reminder task goes to verifiers: straight to the check (#1429).
				actionUrl: assignment
					? "/settings/driving-licence"
					: drivingLicenceCheckPath(row.employeeId),
				idempotencyKey: `driving-task:${row.id}:${row.generation}:${userId}`,
				metadata: {
					i18n: content.i18n,
					taskId: row.id,
					employeeId: row.employeeId,
				},
			},
			tx,
		);
}
async function administratorRecipients(
	tx: DrivingLicenceTransaction,
	organizationId: string,
	now: Instant,
) {
	const memberships = await tx
		.select({ userId: member.userId, role: member.role, email: user.email })
		.from(member)
		.innerJoin(user, eq(user.id, member.userId))
		.where(
			and(
				eq(member.organizationId, organizationId),
				eq(member.status, "approved"),
			),
		);
	const result: string[] = [];
	for (const membership of memberships) {
		if (
			(!hasOrganizationRole(membership.role, "owner") &&
				!hasOrganizationRole(membership.role, "admin")) ||
			isReservedEmail(membership.email)
		)
			continue;
		if (
			await resolveDrivingLicenceAccess(tx, {
				organizationId,
				userId: membership.userId,
				now,
			})
		)
			result.push(membership.userId);
	}
	return result;
}
/** Caller holds the organization lock, shared by the registered worker and every task action. */
export async function reconcileDrivingLicenceTasks(
	tx: DrivingLicenceTransaction,
	organizationId: string,
	now: Instant,
	suppliedOccasions?: DrivingLicenceReminderOccasion[],
) {
	const [policy] = await tx
		.select()
		.from(drivingLicencePolicy)
		.where(eq(drivingLicencePolicy.organizationId, organizationId));
	const occasions =
		suppliedOccasions ??
		(await collectDrivingLicenceReminderOccasions(tx, organizationId, now));
	const participants = policy?.enabled
		? (await listDrivingLicenceIntendedDriverIds(tx, organizationId)).map((id) => ({
				employeeId: id,
			}))
		: [];
	const rows = await tx
		.select()
		.from(drivingLicenceTask)
		.where(eq(drivingLicenceTask.organizationId, organizationId));
	const current = new Set<string>();
	let admins: string[] | undefined;
	for (const participant of participants) {
		const employment = await currentDrivingEmployment(
			tx,
			organizationId,
			participant.employeeId,
			now,
		);
		if (!employment?.hasAccess) continue;
		const recipients = await resolveDrivingLicenceReminderRecipients(
			tx,
			organizationId,
			participant.employeeId,
			now,
		);
		if (!recipients.employee) continue;
		const employmentIdentity = `${employment.periodId}:${employment.lastDepartureAt?.toISOString() ?? "first"}`;
		const responsibilityKey = `responsibility:${participant.employeeId}:${employmentIdentity}`;
		const responsibility = rows.find(
			(r) => r.kind === "reassignment" && r.occasionKey === responsibilityKey,
		);
		if (!recipients.verifiers.length || responsibility) {
			current.add(`reassignment:${responsibilityKey}`);
			let task = responsibility;
			if (!task) {
				[task] = await tx
					.insert(drivingLicenceTask)
					.values({
						organizationId,
						employeeId: participant.employeeId,
						employmentPeriodId: employment.periodId,
						occasionKey: responsibilityKey,
						kind: "reassignment",
						createdAt: dateFromInstant(now),
					})
					.onConflictDoNothing()
					.returning();
			}
			if (task) {
				const condition = and(
					eq(drivingLicenceTask.organizationId, organizationId),
					eq(drivingLicenceTask.id, task.id),
				);
				if (recipients.verifiers.length && task.state !== "completed") {
					await tx
						.update(drivingLicenceTask)
						.set({
							state: "completed",
							completedAt: dateFromInstant(now),
							completedBy: null,
						})
						.where(condition);
				} else if (!recipients.verifiers.length) {
					if (task.state !== "pending") {
						[task] = await tx
							.update(drivingLicenceTask)
							.set({
								state: "pending",
								generation: task.generation + 1,
								completedAt: null,
								completedBy: null,
							})
							.where(condition)
							.returning();
					}
					admins ??= await administratorRecipients(tx, organizationId, now);
					await notifyAssignment(tx, task, recipients.employee.name, admins);
				}
			}
		}
		if (recipients.employee.personalRoute) continue;
		const employeeOccasions = occasions.filter(
			(o) => o.employeeId === participant.employeeId,
		);
		const [previousCheck] = await tx
			.select({ id: drivingLicenceCheck.id })
			.from(drivingLicenceCheck)
			.where(
				and(
					eq(drivingLicenceCheck.organizationId, organizationId),
					eq(drivingLicenceCheck.employeeId, participant.employeeId),
					employment.lastDepartureAt
						? gt(drivingLicenceCheck.controlledAt, employment.lastDepartureAt)
						: undefined,
					employment.periodId
						? eq(drivingLicenceCheck.employmentPeriodId, employment.periodId)
						: isNull(drivingLicenceCheck.employmentPeriodId),
				),
			)
			.limit(1);
		const keys = employeeOccasions.map((o) => o.key);
		if (!previousCheck)
			keys.push(`initial:${participant.employeeId}:${employmentIdentity}`);
		for (const key of keys) {
			current.add(`personal_reminder:${key}`);
			let task = rows.find(
				(r) => r.kind === "personal_reminder" && r.occasionKey === key,
			);
			if (!task) {
				[task] = await tx
					.insert(drivingLicenceTask)
					.values({
						organizationId,
						employeeId: participant.employeeId,
						employmentPeriodId: employment.periodId,
						occasionKey: key,
						kind: "personal_reminder",
						createdAt: dateFromInstant(now),
					})
					.onConflictDoNothing()
					.returning();
			}
			if (task?.state === "obsolete") {
				[task] = await tx
					.update(drivingLicenceTask)
					.set({
						state: task.completedAt ? "completed" : "pending",
						generation: task.generation + 1,
					})
					.where(
						and(
							eq(drivingLicenceTask.organizationId, organizationId),
							eq(drivingLicenceTask.id, task.id),
						),
					)
					.returning();
			}
			if (task && key.startsWith("initial:") && task.state === "pending")
				await notifyAssignment(
					tx,
					task,
					recipients.employee.name,
					recipients.verifiers.map((v) => v.userId),
				);
		}
	}
	for (const row of rows) {
		if (
			!current.has(`${row.kind}:${row.occasionKey}`) &&
			row.state !== "obsolete"
		)
			await tx
				.update(drivingLicenceTask)
				.set({ state: "obsolete" })
				.where(
					and(
						eq(drivingLicenceTask.organizationId, organizationId),
						eq(drivingLicenceTask.id, row.id),
					),
				);
	}
	return occasions;
}
export async function listDrivingLicenceTasks(
	tx: DrivingLicenceTransaction,
	actor: DrivingLicenceActor,
	now: Instant,
): Promise<DrivingLicenceTaskView[]> {
	const occasions = await reconcileDrivingLicenceTasks(
		tx,
		actor.organizationId,
		now,
	);
	const rows = await tx
		.select()
		.from(drivingLicenceTask)
		.where(eq(drivingLicenceTask.organizationId, actor.organizationId));
	const result: DrivingLicenceTaskView[] = [];
	for (const row of rows) {
		if (row.state === "obsolete") continue;
		const recipients = await resolveDrivingLicenceReminderRecipients(
			tx,
			actor.organizationId,
			row.employeeId,
			now,
		);
		if (!recipients.employee) continue;
		const base = {
			id: row.id,
			employeeId: row.employeeId,
			employeeName: recipients.employee.name,
			state: row.state,
			completedAt: row.completedAt?.toISOString() ?? null,
		};
		if (row.kind === "reassignment") {
			if (actor.isAdministrator) result.push({ ...base, kind: "reassignment" });
		} else if (
			!recipients.employee.personalRoute &&
			recipients.verifiers.some((v) => v.userId === actor.userId)
		) {
			const occasion = occasions.find(
				(o) => o.key === row.occasionKey && o.employeeId === row.employeeId,
			);
			result.push({
				...base,
				kind: "personal_reminder",
				directEmployeeNotification: "unavailable",
				occasion: {
					// Collected occasions are never end notices (#1425); those are no tasks.
					kind: occasion && occasion.kind !== "ended" ? occasion.kind : "initial",
					classCode: occasion?.classCode ?? null,
					validThrough: occasion?.validThrough ?? null,
				},
			});
		}
	}
	return result;
}
