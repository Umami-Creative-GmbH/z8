import { and, desc, eq } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";
import {
	type changePolicyAssignment as ChangePolicyAssignmentTable,
	type changePolicy as ChangePolicyTable,
	changePolicy,
	changePolicyAssignment,
	employeeManagers,
} from "@/db/schema";
import { instantFromDate, systemClock } from "@/lib/datetime/temporal-core";
import type { DatabaseError } from "@/lib/effect/errors";
import {
	type ChangePolicyExemption,
	type ChangePolicyVerdict,
	readChangePolicyVerdict,
} from "@/lib/time-tracking/change-policy/verdict";
import { DatabaseService } from "./database.service";

// Type definitions
type ChangePolicy = typeof ChangePolicyTable.$inferSelect;
type ChangePolicyAssignment = typeof ChangePolicyAssignmentTable.$inferSelect;

/**
 * Manager information for notification
 */
export interface ManagerInfo {
	managerId: string;
	userId: string;
	name: string;
	isPrimary: boolean;
}

export class ChangePolicyService extends Context.Service<
	ChangePolicyService,
	{
		/**
		 * What the change policy in effect allows for an employee's work period, as
		 * `readChangePolicyVerdict` decides it.
		 */
		readonly getVerdict: (params: {
			organizationId: string;
			employeeId: string;
			workPeriodEndTime: Date | null;
			exemption?: ChangePolicyExemption | null;
			currentTime?: Date;
		}) => Effect.Effect<ChangePolicyVerdict, DatabaseError>;

		/**
		 * Get managers to notify for an approval request.
		 * Respects the notifyAllManagers policy setting.
		 */
		readonly getManagersForApproval: (
			employeeId: string,
			notifyAll: boolean,
		) => Effect.Effect<ManagerInfo[], DatabaseError>;

		// Configuration writes are owned by the settings actions, which take the
		// organization configuration guard; this service only reads.
		readonly getPolicies: (organizationId: string) => Effect.Effect<ChangePolicy[], DatabaseError>;

		readonly getPolicyById: (id: string) => Effect.Effect<ChangePolicy | null, DatabaseError>;

		readonly getAssignments: (organizationId: string) => Effect.Effect<
			Array<
				ChangePolicyAssignment & {
					policy: ChangePolicy;
					team?: { id: string; name: string } | null;
					employee?: {
						id: string;
						firstName: string | null;
						lastName: string | null;
					} | null;
				}
			>,
			DatabaseError
		>;
	}
>()("ChangePolicyService") {}

export const ChangePolicyServiceLive = Layer.effect(
	ChangePolicyService,
	Effect.gen(function* () {
		const dbService = yield* DatabaseService;

		return ChangePolicyService.of({
			getVerdict: ({ organizationId, employeeId, workPeriodEndTime, exemption, currentTime }) =>
				dbService.query("changePolicy.getVerdict", () =>
					readChangePolicyVerdict(dbService.db, {
						organizationId,
						employeeId,
						workEnd: workPeriodEndTime ? instantFromDate(workPeriodEndTime) : null,
						now: currentTime ? instantFromDate(currentTime) : systemClock.nowInstant(),
						exemption,
					}),
				),

			getManagersForApproval: (employeeId, notifyAll) =>
				Effect.gen(function* () {
					const managers = yield* dbService.query("getManagersForApproval", async () => {
						if (notifyAll) {
							// Get all managers
							const result = await dbService.db.query.employeeManagers.findMany({
								where: eq(employeeManagers.employeeId, employeeId),
								with: {
									manager: {
										columns: {
											id: true,
											userId: true,
											firstName: true,
											lastName: true,
										},
									},
								},
							});

							return result.flatMap((r) =>
								r.manager
									? [
											{
												managerId: r.manager.id,
												userId: r.manager.userId,
												name:
													[r.manager.firstName, r.manager.lastName].filter(Boolean).join(" ") ||
													"Manager",
												isPrimary: r.isPrimary,
											},
										]
									: [],
							);
						} else {
							// Get only primary manager
							const result = await dbService.db.query.employeeManagers.findFirst({
								where: and(
									eq(employeeManagers.employeeId, employeeId),
									eq(employeeManagers.isPrimary, true),
								),
								with: {
									manager: {
										columns: {
											id: true,
											userId: true,
											firstName: true,
											lastName: true,
										},
									},
								},
							});

							if (!result?.manager) {
								// Fallback: get any manager
								const fallback = await dbService.db.query.employeeManagers.findFirst({
									where: eq(employeeManagers.employeeId, employeeId),
									with: {
										manager: {
											columns: {
												id: true,
												userId: true,
												firstName: true,
												lastName: true,
											},
										},
									},
								});

								if (!fallback?.manager) return [];

								return [
									{
										managerId: fallback.manager.id,
										userId: fallback.manager.userId,
										name:
											[fallback.manager.firstName, fallback.manager.lastName]
												.filter(Boolean)
												.join(" ") || "Manager",
										isPrimary: fallback.isPrimary,
									},
								];
							}

							return [
								{
									managerId: result.manager.id,
									userId: result.manager.userId,
									name:
										[result.manager.firstName, result.manager.lastName].filter(Boolean).join(" ") ||
										"Manager",
									isPrimary: result.isPrimary,
								},
							];
						}
					});

					return managers;
				}),

			// Reads for configuration screens
			getPolicies: (organizationId) =>
				Effect.gen(function* () {
					const policies = yield* dbService.query("getChangePolicies", async () => {
						return await dbService.db.query.changePolicy.findMany({
							where: and(
								eq(changePolicy.organizationId, organizationId),
								eq(changePolicy.isActive, true),
							),
							orderBy: [desc(changePolicy.createdAt)],
						});
					});

					return policies;
				}),

			getPolicyById: (id) =>
				Effect.gen(function* () {
					const policy = yield* dbService.query("getChangePolicyById", async () => {
						return await dbService.db.query.changePolicy.findFirst({
							where: eq(changePolicy.id, id),
						});
					});

					return policy ?? null;
				}),

			getAssignments: (organizationId) =>
				Effect.gen(function* () {
					const assignments = yield* dbService.query("getChangePolicyAssignments", async () => {
						return await dbService.db.query.changePolicyAssignment.findMany({
							where: and(
								eq(changePolicyAssignment.organizationId, organizationId),
								eq(changePolicyAssignment.isActive, true),
							),
							with: {
								policy: true,
								team: {
									columns: {
										id: true,
										name: true,
									},
								},
								employee: {
									columns: {
										id: true,
										firstName: true,
										lastName: true,
									},
								},
							},
							orderBy: [
								desc(changePolicyAssignment.priority),
								desc(changePolicyAssignment.createdAt),
							],
						});
					});

					return assignments;
				}),
		});
	}),
);
