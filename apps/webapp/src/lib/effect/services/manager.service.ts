import { and, eq } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";
import { employee, employeeManagers } from "@/db/schema";
import { withAuthorizationMutation } from "@/lib/authorization/authorization-mutation";
import { type ConflictError, type DatabaseError, NotFoundError, ValidationError } from "../errors";
import { DatabaseService } from "./database.service";

export interface ManagerAssignment {
	id: string;
	employeeId: string;
	managerId: string;
	isPrimary: boolean;
	assignedBy: string;
	assignedAt: Date;
	createdAt: Date;
}

export interface Manager {
	id: string;
	userId: string;
	firstName: string | null;
	lastName: string | null;
	email: string;
	name: string;
	isPrimary: boolean;
}

export class ManagerService extends Context.Tag("ManagerService")<
	ManagerService,
	{
		readonly assignManager: (
			employeeId: string,
			managerId: string,
			isPrimary: boolean,
			assignedBy: string,
		) => Effect.Effect<void, NotFoundError | ValidationError | ConflictError | DatabaseError>;
		readonly removeManager: (
			employeeId: string,
			managerId: string,
		) => Effect.Effect<void, NotFoundError | ValidationError | DatabaseError>;
		readonly getManagers: (
			employeeId: string,
		) => Effect.Effect<Manager[], NotFoundError | DatabaseError>;
		readonly getPrimaryManager: (
			employeeId: string,
		) => Effect.Effect<Manager | null, NotFoundError | DatabaseError>;
		readonly isManagerOf: (
			managerId: string,
			employeeId: string,
		) => Effect.Effect<boolean, DatabaseError>;
		readonly getManagedEmployees: (
			managerId: string,
			// biome-ignore lint/suspicious/noExplicitAny: Will be provided at runtime
		) => Effect.Effect<any[], DatabaseError>;
	}
>() {}

export const ManagerServiceLive = Layer.effect(
	ManagerService,
	Effect.gen(function* (_) {
		const dbService = yield* _(DatabaseService);

		return ManagerService.of({
			assignManager: (employeeId, managerId, isPrimary, assignedBy) =>
				Effect.gen(function* (_) {
					// Validate: Cannot assign employee as their own manager
					if (employeeId === managerId) {
						yield* _(
							Effect.fail(
								new ValidationError({
									message: "Employee cannot be their own manager",
									field: "managerId",
									value: managerId,
								}),
							),
						);
					}

					// Verify both employees exist
					const [employeeExists, managerExists] = yield* _(
						dbService.query("verifyEmployeesExist", async () => {
							const [emp, mgr] = await Promise.all([
								dbService.db.query.employee.findFirst({
									where: eq(employee.id, employeeId),
								}),
								dbService.db.query.employee.findFirst({
									where: eq(employee.id, managerId),
								}),
							]);
							return [emp, mgr];
						}),
					);

					if (!employeeExists) {
						yield* _(
							Effect.fail(
								new NotFoundError({
									message: "Employee not found",
									entityType: "employee",
									entityId: employeeId,
								}),
							),
						);
					}

					if (!managerExists) {
						yield* _(
							Effect.fail(
								new NotFoundError({
									message: "Manager not found",
									entityType: "employee",
									entityId: managerId,
								}),
							),
						);
					}

					if (
						employeeExists &&
						managerExists &&
						employeeExists.organizationId !== managerExists.organizationId
					) {
						yield* _(
							Effect.fail(
								new ValidationError({
									message: "Manager must belong to the same organization as the employee",
									field: "managerId",
									value: managerId,
								}),
							),
						);
					}

					if (!employeeExists) return;

					// One protected transaction: the relation feeds the manager's creation
					// authority, so it commits under both users' exclusive protection.
					yield* _(
						dbService.query("assignManager", () =>
							withAuthorizationMutation(
								{
									organizationId: employeeExists.organizationId,
									employeeIds: [employeeId, managerId],
								},
								async (tx) => {
									const [existing] = await tx
										.select({ id: employeeManagers.id })
										.from(employeeManagers)
										.where(
											and(
												eq(employeeManagers.employeeId, employeeId),
												eq(employeeManagers.managerId, managerId),
											),
										);
									if (existing) {
										await tx
											.update(employeeManagers)
											.set({ isPrimary })
											.where(eq(employeeManagers.id, existing.id));
									} else {
										await tx.insert(employeeManagers).values({
											employeeId,
											managerId,
											isPrimary,
											assignedBy,
										});
									}

									// If this is primary, unset other primary managers
									if (isPrimary) {
										await tx
											.update(employeeManagers)
											.set({ isPrimary: false })
											.where(
												and(
													eq(employeeManagers.employeeId, employeeId),
													eq(employeeManagers.isPrimary, true),
												),
											);
										await tx
											.update(employeeManagers)
											.set({ isPrimary: true })
											.where(
												and(
													eq(employeeManagers.employeeId, employeeId),
													eq(employeeManagers.managerId, managerId),
												),
											);
									}
								},
								dbService.db,
							),
						),
					);
				}),

			removeManager: (employeeId, managerId) =>
				Effect.gen(function* (_) {
					const target = yield* _(
						dbService.query("getEmployeeForManagerRemoval", async () => {
							return await dbService.db.query.employee.findFirst({
								where: eq(employee.id, employeeId),
								columns: { organizationId: true },
							});
						}),
					);
					if (!target) {
						return yield* _(
							Effect.fail(
								new NotFoundError({
									message: "Employee not found",
									entityType: "employee",
									entityId: employeeId,
								}),
							),
						);
					}

					// The count check and the removal share the employee's protection, which
					// every relation writer for this employee takes.
					const removal = yield* _(
						dbService.query("removeManagerAssignment", () =>
							withAuthorizationMutation(
								{
									organizationId: target.organizationId,
									employeeIds: [employeeId, managerId],
								},
								async (tx) => {
									const managers = await tx
										.select({
											id: employeeManagers.id,
											managerId: employeeManagers.managerId,
											isPrimary: employeeManagers.isPrimary,
										})
										.from(employeeManagers)
										.where(eq(employeeManagers.employeeId, employeeId));

									// Prevent removing last manager
									if (managers.length <= 1) return "last_manager" as const;

									await tx
										.delete(employeeManagers)
										.where(
											and(
												eq(employeeManagers.employeeId, employeeId),
												eq(employeeManagers.managerId, managerId),
											),
										);

									// If removed manager was primary, assign primary to another manager
									const wasPrimary = managers.find(
										(m) => m.managerId === managerId && m.isPrimary,
									);
									const newPrimaryId = managers.find((m) => m.managerId !== managerId)?.id;
									if (wasPrimary && newPrimaryId) {
										await tx
											.update(employeeManagers)
											.set({ isPrimary: true })
											.where(eq(employeeManagers.id, newPrimaryId));
									}
									return "removed" as const;
								},
								dbService.db,
							),
						),
					);

					if (removal === "last_manager") {
						yield* _(
							Effect.fail(
								new ValidationError({
									message:
										"Cannot remove the last manager. Employee must have at least one manager.",
									field: "managerId",
								}),
							),
						);
					}
				}),

			getManagers: (employeeId) =>
				Effect.gen(function* (_) {
					const managers = yield* _(
						dbService.query("getManagersForEmployee", async () => {
							return await dbService.db.query.employeeManagers.findMany({
								where: eq(employeeManagers.employeeId, employeeId),
								with: {
									manager: {
										with: {
											user: true,
										},
									},
								},
							});
						}),
					);

					return managers.map((m) => ({
						id: m.manager.id,
						userId: m.manager.userId,
						firstName: m.manager.firstName,
						lastName: m.manager.lastName,
						email: m.manager.user.email,
						name: m.manager.user.name,
						isPrimary: m.isPrimary,
					}));
				}),

			getPrimaryManager: (employeeId) =>
				Effect.gen(function* (_) {
					const primaryAssignment = yield* _(
						dbService.query("getPrimaryManager", async () => {
							return await dbService.db.query.employeeManagers.findFirst({
								where: and(
									eq(employeeManagers.employeeId, employeeId),
									eq(employeeManagers.isPrimary, true),
								),
								with: {
									manager: {
										with: {
											user: true,
										},
									},
								},
							});
						}),
					);

					if (!primaryAssignment) {
						return null;
					}

					return {
						id: primaryAssignment.manager.id,
						userId: primaryAssignment.manager.userId,
						firstName: primaryAssignment.manager.firstName,
						lastName: primaryAssignment.manager.lastName,
						email: primaryAssignment.manager.user.email,
						name: primaryAssignment.manager.user.name,
						isPrimary: true,
					};
				}),

			isManagerOf: (managerId, employeeId) =>
				Effect.gen(function* (_) {
					const assignment = yield* _(
						dbService.query("checkManagerRelationship", async () => {
							return await dbService.db.query.employeeManagers.findFirst({
								where: and(
									eq(employeeManagers.managerId, managerId),
									eq(employeeManagers.employeeId, employeeId),
								),
							});
						}),
					);

					return assignment !== undefined;
				}),

			getManagedEmployees: (managerId) =>
				Effect.gen(function* (_) {
					const employees = yield* _(
						dbService.query("getManagedEmployees", async () => {
							return await dbService.db.query.employeeManagers.findMany({
								where: eq(employeeManagers.managerId, managerId),
								with: {
									employee: {
										with: {
											user: true,
											team: true,
										},
									},
								},
							});
						}),
					);

					return employees.map((e) => e.employee);
				}),
		});
	}),
);
