import "server-only";

import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { employee, userSettings } from "@/db/schema";
import { dateFromInstant, systemClock } from "@/lib/datetime/temporal-core";
import {
	acquireAdoptionGate,
	acquireExclusiveUserConfigurationAccessGuards,
	readAppendAdmission,
	type Transaction,
	type WorkTransactionAdmission,
} from "@/lib/time-tracking/work-transaction";
import { recordWorkBalanceRebuildIntent } from "@/lib/work-balance/rebuild-intents";
import {
	requestEmployeeWorkBalanceFullRebuild,
	type WorkBalanceDbClient,
} from "@/lib/work-balance/service";

export type UserTimezoneChange =
	| {
			status: "changed";
			/** Adopted organizations whose rebuild intent committed with the change. */
			rebuildOrganizationIds: string[];
	  }
	| { status: "unchanged" };

export class UserTimezoneScopeChanged extends Error {
	constructor() {
		super("User timezone organizations changed while waiting for protection");
		this.name = "UserTimezoneScopeChanged";
	}
}

const MAX_ATTEMPTS = 3;

/** Organizations in which the user has an employee record, sorted. */
async function employmentOrganizationIds(transaction: Transaction, userId: string) {
	const rows = await transaction
		.selectDistinct({ organizationId: employee.organizationId })
		.from(employee)
		.where(eq(employee.userId, userId))
		.orderBy(asc(employee.organizationId));
	return rows.map(({ organizationId }) => organizationId);
}

/**
 * The user timezone writer (#312). A user's zone governs manual interpretation
 * in every organization where the user has an employee record, and manual
 * preparation reads it under the user's shared configuration/access guard, so
 * the change holds that guard exclusively from before its first write through
 * commit. No organization lock protects it.
 *
 * Acquisition follows the #258 order and never reaches back: routing reads the
 * affected organizations, then their shared adoption gates (sorted, each with
 * its append control), then the exclusive user guard. Routing runs again under
 * protection; an organization that appeared or disappeared while waiting rolls
 * the attempt back and restarts with the new scope instead of being gated late.
 *
 * In each adopted organization the zone commits together with a durable,
 * user-scoped rebuild intent executed separately by
 * `processWorkBalanceRebuildIntents`. An organization that has not adopted keeps
 * the established in-transaction reset of the user's employees in it.
 */
export async function changeUserTimezone(input: {
	userId: string;
	timezone: string;
}): Promise<UserTimezoneChange> {
	for (let attempt = 1; ; attempt += 1) {
		try {
			return await db.transaction((transaction) => attemptChange(transaction, input));
		} catch (error) {
			if (!(error instanceof UserTimezoneScopeChanged) || attempt >= MAX_ATTEMPTS) throw error;
		}
	}
}

async function attemptChange(
	transaction: Transaction,
	input: { userId: string; timezone: string },
): Promise<UserTimezoneChange> {
	const organizationIds = await employmentOrganizationIds(transaction, input.userId);
	const admissions = new Map<string, WorkTransactionAdmission>();
	for (const organizationId of organizationIds) {
		await acquireAdoptionGate(transaction, organizationId);
		admissions.set(organizationId, await readAppendAdmission(transaction, organizationId));
	}
	await acquireExclusiveUserConfigurationAccessGuards(transaction, [input.userId]);
	const confirmed = await employmentOrganizationIds(transaction, input.userId);
	if (JSON.stringify(confirmed) !== JSON.stringify(organizationIds)) {
		throw new UserTimezoneScopeChanged();
	}

	// An absent row resolves to the organization zone, so creating one is a change
	// even when it names UTC.
	const [current] = await transaction
		.select({ timezone: userSettings.timezone })
		.from(userSettings)
		.where(eq(userSettings.userId, input.userId));
	if (current?.timezone === input.timezone) return { status: "unchanged" };

	await transaction
		.insert(userSettings)
		.values({ userId: input.userId, timezone: input.timezone })
		.onConflictDoUpdate({ target: userSettings.userId, set: { timezone: input.timezone } });

	const requestedAt = dateFromInstant(systemClock.nowInstant());
	const adopted = organizationIds.filter((id) => admissions.get(id) === "append");
	const legacy = organizationIds.filter((id) => admissions.get(id) !== "append");
	for (const organizationId of adopted) {
		await recordWorkBalanceRebuildIntent(transaction, {
			organizationId,
			reason: "user_timezone",
			userId: input.userId,
			requestedBy: input.userId,
			requestedAt,
		});
	}
	if (legacy.length > 0) {
		const legacyEmployees = await transaction
			.select({ id: employee.id, organizationId: employee.organizationId })
			.from(employee)
			.where(and(eq(employee.userId, input.userId), inArray(employee.organizationId, legacy)))
			.orderBy(asc(employee.id));
		for (const legacyEmployee of legacyEmployees) {
			await requestEmployeeWorkBalanceFullRebuild(
				{ employeeId: legacyEmployee.id, organizationId: legacyEmployee.organizationId },
				{ dbClient: transaction as WorkBalanceDbClient, requestedAt },
			);
		}
	}
	return { status: "changed", rebuildOrganizationIds: adopted };
}
