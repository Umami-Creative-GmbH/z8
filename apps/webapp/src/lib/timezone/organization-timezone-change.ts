import "server-only";

import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { member, organization } from "@/db/auth-schema";
import { employee } from "@/db/schema";
import { hasOrganizationRole } from "@/lib/auth/organization-role";
import {
	acquireAdoptionGate,
	acquireExclusiveOrganizationConfigurationGuard,
	acquireUserConfigurationAccessGuards,
	readAppendAdmission,
} from "@/lib/time-tracking/work-transaction";
import { recordWorkBalanceRebuildIntent } from "@/lib/work-balance/rebuild-intents";
import {
	requestOrganizationWorkBalanceFullRebuild,
	type WorkBalanceDbClient,
} from "@/lib/work-balance/service";

export type OrganizationTimezoneChange =
	| { status: "changed"; rebuild: "intent" | "in_transaction" }
	| { status: "unchanged" }
	| { status: "not_authorized" }
	| { status: "not_found" };

/**
 * The organization timezone writer (#311). Manual preparation reads the zone
 * under shared organization configuration protection, so the change takes the
 * exclusive guard before touching the row and holds it through commit.
 *
 * Acquisition follows the #258 order and never reaches back: the shared adoption
 * gate (and the append control under it), exclusive organization configuration,
 * the actor's shared user access guard, then the organization row. The owner is
 * revalidated under that protection.
 *
 * In an adopted organization the zone commits together with a durable rebuild
 * intent; balances are rebuilt separately by `processWorkBalanceRebuildIntents`,
 * so this transaction takes no employee or balance locks. Before adoption the
 * established in-transaction reset is kept.
 */
export async function changeOrganizationTimezone(input: {
	organizationId: string;
	actorUserId: string;
	timezone: string;
	requestedAt?: Date;
}): Promise<OrganizationTimezoneChange> {
	return db.transaction(async (transaction) => {
		await acquireAdoptionGate(transaction, input.organizationId);
		const admission = await readAppendAdmission(transaction, input.organizationId);
		await acquireExclusiveOrganizationConfigurationGuard(transaction, input.organizationId);
		await acquireUserConfigurationAccessGuards(transaction, [input.actorUserId]);

		const [current] = await transaction
			.select({ timezone: organization.timezone })
			.from(organization)
			.where(eq(organization.id, input.organizationId))
			.for("update");
		if (!current) return { status: "not_found" };

		const [membership] = await transaction
			.select({ role: member.role })
			.from(member)
			.where(
				and(
					eq(member.organizationId, input.organizationId),
					eq(member.userId, input.actorUserId),
					eq(member.status, "approved"),
				),
			);
		const [actorEmployee] = await transaction
			.select({ isActive: employee.isActive })
			.from(employee)
			.where(
				and(
					eq(employee.organizationId, input.organizationId),
					eq(employee.userId, input.actorUserId),
				),
			);
		if (!hasOrganizationRole(membership?.role, "owner") || actorEmployee?.isActive === false) {
			return { status: "not_authorized" };
		}

		if (current.timezone === input.timezone) return { status: "unchanged" };

		await transaction
			.update(organization)
			.set({ timezone: input.timezone })
			.where(eq(organization.id, input.organizationId));

		if (admission === "append") {
			await recordWorkBalanceRebuildIntent(transaction, {
				organizationId: input.organizationId,
				reason: "organization_timezone",
				requestedBy: input.actorUserId,
				requestedAt: input.requestedAt ?? new Date(),
			});
			return { status: "changed", rebuild: "intent" };
		}

		await requestOrganizationWorkBalanceFullRebuild(
			{ organizationId: input.organizationId },
			{ dbClient: transaction as WorkBalanceDbClient },
		);
		return { status: "changed", rebuild: "in_transaction" };
	});
}
