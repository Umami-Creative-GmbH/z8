import { and, eq } from "drizzle-orm";
import type { ClockActor } from "@/app/[locale]/(app)/time-tracking/actions/clocking";
import { db } from "@/db";
import { employee } from "@/db/schema";
import type { BotCommandContext } from "@/lib/bot-platform/types";
import { resolveCommandActorEmployee } from "@/lib/integrations/resolve-command-actor";

/**
 * The clock actor for a bot command. The adapter authenticated the provider
 * request and resolved the platform user; this re-checks, in the command's own
 * organization, that the user is an approved member whose active employee
 * record is the one the adapter resolved. Anything else clocks nobody.
 */
export async function resolveBotClockActor(
	ctx: BotCommandContext,
	timezone: string,
): Promise<ClockActor | null> {
	const authorized = await resolveCommandActorEmployee(ctx.userId, ctx.organizationId);
	if (!authorized || authorized.id !== ctx.employeeId) return null;
	const record = await db.query.employee.findFirst({
		where: and(
			eq(employee.id, ctx.employeeId),
			eq(employee.organizationId, ctx.organizationId),
			eq(employee.userId, ctx.userId),
			eq(employee.isActive, true),
		),
	});
	if (!record) return null;
	return { userId: ctx.userId, employee: record, resolveTimezone: async () => timezone };
}
