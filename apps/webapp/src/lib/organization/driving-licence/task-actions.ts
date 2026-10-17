"use server";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { drivingLicenceTask } from "@/db/schema/driving-licence-tasks";
import { dateFromInstant, systemClock } from "@/lib/datetime/temporal-core";
import { lockDrivingLicenceOrganization } from "./checks";
import { requireDrivingLicenceActor } from "./context";
import { listDrivingLicenceTasks } from "./tasks";
export async function getDrivingLicenceTasksAction() {
	try {
		const actor = await requireDrivingLicenceActor();
		const data = await db.transaction(async (tx) => {
			await lockDrivingLicenceOrganization(tx, actor.organizationId);
			return listDrivingLicenceTasks(tx, actor, systemClock.nowInstant());
		});
		return { success: true as const, data };
	} catch {
		return {
			success: false as const,
			error:
				"Could not access driving licence tasks. Check your current organization access.",
		};
	}
}
export async function completeDrivingLicencePersonalReminderAction(input: {
	taskId: string;
}) {
	try {
		const actor = await requireDrivingLicenceActor();
		const taskId = z.uuid().parse(input?.taskId);
		await db.transaction(async (tx) => {
			await lockDrivingLicenceOrganization(tx, actor.organizationId);
			const now = systemClock.nowInstant();
			const tasks = await listDrivingLicenceTasks(tx, actor, now);
			const task = tasks.find(
				(t) => t.id === taskId && t.kind === "personal_reminder",
			);
			if (!task) throw new Error("Current verifier responsibility required");
			await tx
				.update(drivingLicenceTask)
				.set({
					state: "completed",
					completedAt: dateFromInstant(now),
					completedBy: actor.userId,
				})
				.where(
					and(
						eq(drivingLicenceTask.organizationId, actor.organizationId),
						eq(drivingLicenceTask.id, taskId),
						eq(drivingLicenceTask.state, "pending"),
					),
				);
		});
		revalidatePath("/driving-licence");
		return { success: true as const };
	} catch {
		return {
			success: false as const,
			error:
				"Could not complete this task. Check your current verifier responsibility.",
		};
	}
}
