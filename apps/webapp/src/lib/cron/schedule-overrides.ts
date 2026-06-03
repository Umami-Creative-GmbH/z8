import { eq } from "drizzle-orm";
import { db } from "@/db";
import { type CronScheduleOverride, cronScheduleOverride } from "@/db/schema";
import type { CronJobName } from "./registry";

export async function listCronScheduleOverrides(): Promise<CronScheduleOverride[]> {
	return db.select().from(cronScheduleOverride).orderBy(cronScheduleOverride.jobName);
}

export async function upsertCronScheduleOverride(input: {
	jobName: CronJobName;
	presetId: string;
	pattern: string;
	updatedBy: string;
}): Promise<CronScheduleOverride> {
	const now = new Date();
	const [saved] = await db
		.insert(cronScheduleOverride)
		.values({
			jobName: input.jobName,
			presetId: input.presetId,
			pattern: input.pattern,
			updatedBy: input.updatedBy,
			createdAt: now,
			updatedAt: now,
		})
		.onConflictDoUpdate({
			target: cronScheduleOverride.jobName,
			set: {
				presetId: input.presetId,
				pattern: input.pattern,
				updatedBy: input.updatedBy,
				updatedAt: now,
			},
		})
		.returning();

	return saved;
}

export async function deleteCronScheduleOverride(jobName: CronJobName): Promise<void> {
	await db.delete(cronScheduleOverride).where(eq(cronScheduleOverride.jobName, jobName));
}
