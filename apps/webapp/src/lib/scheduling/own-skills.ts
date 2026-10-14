import { and, asc, eq } from "drizzle-orm";
import type { db as appDb } from "@/db";
import { employee, employeeSkill, skill } from "@/db/schema";
import type { Instant } from "@/lib/datetime/temporal-core";
import { loadSkillReminderWindow } from "./skill-reminder-store";

/**
 * The employee's own skills for their profile (#1143), where a skill expiry
 * reminder links the employee. Read-only: names and skill expiry dates, with
 * the organization's today and lead time for the badges. Organization-scoped
 * through both the employee and the skill.
 */

type Database = typeof appDb;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Reader = Database | Pick<Transaction, "select">;

export interface OwnSkills {
	/** The organization's today, `YYYY-MM-DD`. */
	today: string;
	expiringSoonDays: number;
	skills: Array<{ id: string; name: string; expiresAt: string | null }>;
}

export async function loadOwnSkills(
	database: Reader,
	input: { organizationId: string; employeeId: string; now: Instant },
): Promise<OwnSkills> {
	const { organizationId, employeeId } = input;
	const [window, skills] = await Promise.all([
		loadSkillReminderWindow(database, { organizationId, now: input.now }),
		database
			.select({ id: employeeSkill.id, name: skill.name, expiresAt: employeeSkill.expiresAt })
			.from(employeeSkill)
			.innerJoin(
				employee,
				and(eq(employee.id, employeeSkill.employeeId), eq(employee.organizationId, organizationId)),
			)
			.innerJoin(
				skill,
				and(eq(skill.id, employeeSkill.skillId), eq(skill.organizationId, organizationId)),
			)
			.where(eq(employeeSkill.employeeId, employeeId))
			.orderBy(asc(skill.name), asc(employeeSkill.id)),
	]);
	return { today: window.today, expiringSoonDays: window.leadDays, skills };
}
