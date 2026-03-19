"use server";

import { currentTimestamp } from "@/lib/datetime/drizzle-adapter";
import { and, eq, isNull } from "drizzle-orm";
import { Effect } from "effect";
import { user } from "@/db/auth-schema";
import { employee, employeeRateHistory } from "@/db/schema";
import { AppAccessService } from "@/lib/effect/services/app-access.service";
import { ValidationError } from "@/lib/effect/errors";
import { ManagerService } from "@/lib/effect/services/manager.service";
import { createLogger } from "@/lib/logger";
import {
	type AssignManagers,
	assignManagersSchema,
	type CreateEmployee,
	createEmployeeSchema,
	type PersonalInformation,
	personalInformationSchema,
	type UpdateEmployee,
	updateEmployeeSchema,
} from "@/lib/validations/employee";
import type { ServerActionResult } from "@/lib/effect/result";
import { filterEmployeeUpdateForScopedManager } from "./employee-scope";
import {
	ensureCanAccessEmployeeSettingsTarget,
	ensureSettingsActorCanAccessEmployeeTarget,
	getEmployeeContext,
	getEmployeeSettingsActorContext,
	getTargetEmployee,
	getTargetUser,
	hasAppAccessChanges,
	parseHourlyRate,
	requireOrgAdminEmployeeSettingsAccess,
	revalidateEmployeesCache,
	runTracedEmployeeAction,
	validateInput,
} from "./employee-action-utils";

const logger = createLogger("EmployeeActions");

export async function createEmployeeAction(
	data: CreateEmployee,
): Promise<ServerActionResult<typeof employee.$inferSelect>> {
	return runTracedEmployeeAction({
		name: "createEmployee",
		attributes: {
			"employee.organizationId": data.organizationId,
			"employee.role": data.role,
		},
		logError: (error) => {
			logger.error({ error }, "Failed to create employee");
		},
		execute: (span) =>
			Effect.gen(function* (_) {
				const actor = yield* _(
					getEmployeeSettingsActorContext({ organizationId: data.organizationId }),
				);
				const { session, dbService } = actor;

				yield* _(
					requireOrgAdminEmployeeSettingsAccess(actor, {
						message: "Only organization admins can create employee records",
						resource: "employee",
						action: "create",
					}),
				);

				if (actor.currentEmployee) {
					span.setAttribute("currentEmployee.id", actor.currentEmployee.id);
				}

				const validatedData = yield* _(validateInput(createEmployeeSchema, data));

				yield* _(getTargetUser(validatedData.userId));

				const existing = yield* _(
					dbService.query("checkExistingEmployee", async () => {
						return await dbService.db.query.employee.findFirst({
							where: and(
								eq(employee.userId, validatedData.userId),
								eq(employee.organizationId, validatedData.organizationId),
							),
						});
					}),
				);

				if (existing) {
					return yield* _(
						Effect.fail(
							new ValidationError({
								message: "Employee already exists for this user in this organization",
								field: "userId",
								value: validatedData.userId,
							}),
						),
					);
				}

				const hourlyRateValue = parseHourlyRate(validatedData.hourlyRate);

				const [newEmployee] = yield* _(
					dbService.query("createEmployee", async () => {
						return await dbService.db
							.insert(employee)
							.values({
								userId: validatedData.userId,
								organizationId: validatedData.organizationId,
								teamId: validatedData.teamId || null,
								role: validatedData.role,
								position: validatedData.position || null,
								firstName: validatedData.firstName || null,
								lastName: validatedData.lastName || null,
								gender: validatedData.gender || null,
								birthday: validatedData.birthday || null,
								startDate: validatedData.startDate || null,
								endDate: validatedData.endDate || null,
								isActive: true,
								contractType: validatedData.contractType || "fixed",
								currentHourlyRate: hourlyRateValue?.toString() || null,
							})
							.returning();
					}),
				);

				if (
					validatedData.contractType === "hourly" &&
					validatedData.hourlyRate &&
					hourlyRateValue
				) {
					yield* _(
						dbService.query("createInitialRateHistory", async () => {
							await dbService.db.insert(employeeRateHistory).values({
								employeeId: newEmployee.id,
								organizationId: validatedData.organizationId,
								hourlyRate: hourlyRateValue.toString(),
								currency: "EUR",
								effectiveFrom: new Date(),
								effectiveTo: null,
								reason: "Initial rate",
								createdBy: session.user.id,
							});
						}),
					);
				}

				logger.info(
					{
						employeeId: newEmployee.id,
						userId: newEmployee.userId,
						organizationId: newEmployee.organizationId,
					},
					"Employee created successfully",
				);

				revalidateEmployeesCache(newEmployee.organizationId);
				span.setAttribute("employee.id", newEmployee.id);

				return newEmployee;
			}),
	});
}

export async function updateEmployeeAction(
	employeeId: string,
	data: UpdateEmployee,
): Promise<ServerActionResult<void>> {
	return runTracedEmployeeAction({
		name: "updateEmployee",
		attributes: {
			"employee.id": employeeId,
		},
		logError: (error) => {
			logger.error({ error, employeeId }, "Failed to update employee");
		},
		execute: () =>
			Effect.gen(function* (_) {
				const actor = yield* _(getEmployeeSettingsActorContext());
				const { session, dbService } = actor;

				const validatedData = yield* _(validateInput(updateEmployeeSchema, data));
				const targetEmployee = yield* _(getTargetEmployee(employeeId));

				yield* _(
					ensureSettingsActorCanAccessEmployeeTarget(actor, targetEmployee, {
						message: "You do not have access to this employee",
						resource: "employee",
						action: "update",
					}),
				);

				const scopedData: UpdateEmployee =
					actor.accessTier === "manager"
						? (filterEmployeeUpdateForScopedManager(validatedData) as UpdateEmployee)
						: validatedData;

				const newHourlyRate = parseHourlyRate(
					"hourlyRate" in scopedData ? (scopedData.hourlyRate as string | null | undefined) : undefined,
				);
				const currentRate = parseHourlyRate(targetEmployee.currentHourlyRate);

				const { hourlyRate: _hourlyRate, ...updateData } = scopedData;
				const updatePayload = {
					...updateData,
					currentHourlyRate: newHourlyRate?.toString() || null,
					updatedAt: currentTimestamp(),
				};

				const { canUseWebapp, canUseDesktop, canUseMobile, ...employeeUpdateData } = updatePayload;

				yield* _(
					dbService.query("updateEmployee", async () => {
						await dbService.db
							.update(employee)
							.set(employeeUpdateData)
							.where(eq(employee.id, employeeId));
					}),
				);

				if (hasAppAccessChanges(scopedData)) {
					const targetUser = yield* _(
						dbService.query("getTargetUserForAppAccess", async () => {
							return await dbService.db.query.user.findFirst({
								where: eq(user.id, targetEmployee.userId),
								columns: {
									id: true,
									name: true,
									email: true,
								},
							});
						}),
					);

					if (targetUser) {
						const appAccessService = yield* _(AppAccessService);
						yield* _(
							appAccessService.updatePermissions({
								userId: targetEmployee.userId,
								permissions: {
									canUseWebapp: scopedData.canUseWebapp,
									canUseDesktop: scopedData.canUseDesktop,
									canUseMobile: scopedData.canUseMobile,
								},
								changedBy: session.user.id,
								changedByEmail: session.user.email,
								organizationId: targetEmployee.organizationId,
								targetUserName: targetUser.name,
								targetUserEmail: targetUser.email,
							}),
						);

						logger.info(
							{
								employeeId,
								userId: targetEmployee.userId,
								canUseWebapp: scopedData.canUseWebapp,
								canUseDesktop: scopedData.canUseDesktop,
								canUseMobile: scopedData.canUseMobile,
							},
							"User app access permissions updated",
						);
					}
				}

				const effectiveContractType =
					("contractType" in scopedData ? scopedData.contractType : undefined) ??
					targetEmployee.contractType;
				if (
					effectiveContractType === "hourly" &&
					newHourlyRate !== null &&
					newHourlyRate !== currentRate
				) {
					yield* _(
						dbService.query("closeActiveRateHistory", async () => {
							await dbService.db
								.update(employeeRateHistory)
								.set({ effectiveTo: new Date() })
								.where(
									and(
										eq(employeeRateHistory.employeeId, employeeId),
										isNull(employeeRateHistory.effectiveTo),
									),
								);
						}),
					);

					yield* _(
						dbService.query("createRateHistoryEntry", async () => {
							await dbService.db.insert(employeeRateHistory).values({
								employeeId,
								organizationId: targetEmployee.organizationId,
								hourlyRate: newHourlyRate.toString(),
								currency: "EUR",
								effectiveFrom: new Date(),
								effectiveTo: null,
								reason: "Rate updated",
								createdBy: session.user.id,
							});
						}),
					);

					logger.info(
						{
							employeeId,
							previousRate: currentRate,
							newRate: newHourlyRate,
						},
						"Employee rate history created",
					);
				}

				logger.info({ employeeId }, "Employee updated successfully");
				revalidateEmployeesCache(actor.organizationId);
			}),
	});
}

export async function updateOwnProfileAction(
	data: PersonalInformation,
): Promise<ServerActionResult<void>> {
	return runTracedEmployeeAction({
		name: "updateOwnProfile",
		logError: (error) => {
			logger.error({ error }, "Failed to update own profile");
		},
		execute: (span) =>
			Effect.gen(function* (_) {
				const { dbService, currentEmployee } = yield* _(getEmployeeContext());
				span.setAttribute("employee.id", currentEmployee.id);

				const validatedData = yield* _(
					validateInput(personalInformationSchema, data, "profile"),
				);

				yield* _(
					dbService.query("updateOwnProfile", async () => {
						await dbService.db
							.update(employee)
							.set({
								firstName: validatedData.firstName,
								lastName: validatedData.lastName,
								gender: validatedData.gender,
								birthday: validatedData.birthday,
								updatedAt: currentTimestamp(),
							})
							.where(eq(employee.id, currentEmployee.id));
					}),
				);

				logger.info({ employeeId: currentEmployee.id }, "Profile updated successfully");
			}),
	});
}

export async function assignManagersAction(
	employeeId: string,
	data: AssignManagers,
): Promise<ServerActionResult<void>> {
	return runTracedEmployeeAction({
		name: "assignManagers",
		attributes: {
			"employee.id": employeeId,
			"managers.count": data.managers.length,
		},
		logError: (error) => {
			logger.error({ error, employeeId }, "Failed to assign managers");
		},
		execute: () =>
			Effect.gen(function* (_) {
				const actor = yield* _(getEmployeeSettingsActorContext());
				const managerService = yield* _(ManagerService);
				const targetEmployee = yield* _(getTargetEmployee(employeeId));

				yield* _(
					requireOrgAdminEmployeeSettingsAccess(actor, {
						message: "Only organization admins can assign managers",
						resource: "manager_assignment",
						action: "create",
					}),
				);

				yield* _(
					ensureSettingsActorCanAccessEmployeeTarget(actor, targetEmployee, {
						message: "You do not have access to this employee",
						resource: "manager_assignment",
						action: "create",
					}),
				);

				const validatedData = yield* _(validateInput(assignManagersSchema, data));
				const existingManagers = yield* _(managerService.getManagers(employeeId));

				for (const existingManager of existingManagers) {
					if (validatedData.managers.some((manager) => manager.managerId === existingManager.id)) {
						continue;
					}

					if (existingManagers.length > 1) {
						yield* _(managerService.removeManager(employeeId, existingManager.id));
					}
				}

				for (const assignment of validatedData.managers) {
					yield* _(
						managerService.assignManager(
							employeeId,
							assignment.managerId,
							assignment.isPrimary,
							actor.currentEmployee?.id ?? actor.session.user.id,
						),
					);
				}

				logger.info(
					{
						employeeId,
						managerCount: validatedData.managers.length,
					},
					"Managers assigned successfully",
				);
			}),
	});
}
