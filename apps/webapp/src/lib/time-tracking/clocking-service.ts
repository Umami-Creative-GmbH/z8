import "server-only";

import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { member } from "@/db/auth-schema";
import { employee } from "@/db/schema";
import { employeeHasOrganizationAccess } from "@/lib/employee-lifecycle/access";
import { assertEmployeeMayClock } from "@/lib/employee-lifecycle/clocking-gate";
import {
	type ClockingTransaction,
	createClockingService,
	createDatabaseClockingStore,
} from "./clocking-core";

export {
	type ClockingAction,
	ClockingAccessError,
	ClockingAppendAdoptedError,
	ClockingConflictError,
	type ClockingDependencies,
	ClockingOrganizationError,
	createClockingService,
	TimeEntryAppendReviewRequiredError,
} from "./clocking-core";

export const clockingService = createClockingService({
	async findApprovedMembership(userId, organizationId) {
		const membership = await db.query.member.findFirst({
			columns: { id: true },
			where: and(
				eq(member.userId, userId),
				eq(member.organizationId, organizationId),
				eq(member.status, "approved"),
			),
		});
		return Boolean(membership);
	},
	async findActiveEmployee(userId, organizationId) {
		return (
			(await db.query.employee.findFirst({
				columns: { id: true, organizationId: true },
				where: and(
					eq(employee.userId, userId),
					eq(employee.organizationId, organizationId),
					employeeHasOrganizationAccess(),
				),
			})) ?? null
		);
	},
	assertEmployeeMayClock,
	storeForTransaction: (transaction) =>
		createDatabaseClockingStore(transaction as ClockingTransaction),
	storeForCoordinatedTransaction: (context) =>
		createDatabaseClockingStore(context.db),
	transaction: (callback) =>
		db.transaction(async (tx) => callback(createDatabaseClockingStore(tx))),
});
