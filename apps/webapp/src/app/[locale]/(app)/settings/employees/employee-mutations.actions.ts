"use server";

import { and, eq, isNull } from "drizzle-orm";
import { Effect } from "effect";
import { DateTime } from "luxon";
import { user } from "@/db/auth-schema";
import { employee, employeeRateHistory } from "@/db/schema";
import { currentTimestamp } from "@/lib/datetime/drizzle-adapter";
import { ValidationError } from "@/lib/effect/errors";
import type { ServerActionResult } from "@/lib/effect/result";
import { AppAccessService } from "@/lib/effect/services/app-access.service";
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
import { markEmployeeWorkBalanceDirty } from "@/lib/work-balance/service";
import {
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
import { filterEmployeeUpdateForScopedManager } from "./employee-scope";

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
								gender: validatedData.gender || null,
								pronouns: validatedData.pronouns || null,
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

				const inputData: UpdateEmployee =
					actor.accessTier === "manager"
						? (filterEmployeeUpdateForScopedManager(data) as UpdateEmployee)
						: data;
				const validatedData = yield* _(validateInput(updateEmployeeSchema, inputData));
				const targetEmployee = yield* _(getTargetEmployee(employeeId));

				yield* _(
					ensureSettingsActorCanAccessEmployeeTarget(actor, targetEmployee, {
						message: "You do not have access to this employee",
						resource: "employee",
						action: "update",
					}),
				);

				const scopedData: UpdateEmployee = validatedData;

				const newHourlyRate = parseHourlyRate(
					"hourlyRate" in scopedData
						? (scopedData.hourlyRate as string | null | undefined)
						: undefined,
				);
				const currentRate = parseHourlyRate(targetEmployee.currentHourlyRate);

				const { hourlyRate: _hourlyRate, ...updateData } = scopedData;
				const updatePayload = {
					...updateData,
					currentHourlyRate: newHourlyRate?.toString() || null,
					updatedAt: currentTimestamp(),
				};

				const {
					canUseWebapp,
					canUseDesktop,
					canUseMobile,
					firstName,
					lastName,
					...employeeUpdateData
				} = updatePayload as typeof updatePayload & {
					firstName?: string;
					lastName?: string;
				};

				yield* _(
					dbService.query("updateEmployee", async () => {
						await dbService.db
							.update(employee)
							.set(employeeUpdateData)
							.where(eq(employee.id, employeeId));
					}),
				);

				if (
					actor.accessTier === "orgAdmin" &&
					(firstName !== undefined || lastName !== undefined)
				) {
					const targetUser = yield* _(
						dbService.query("getTargetUserForNameUpdate", async () => {
							return await dbService.db.query.user.findFirst({
								where: eq(user.id, targetEmployee.userId),
								columns: {
									firstName: true,
									lastName: true,
								},
							});
						}),
					);
					const nextFirstName = firstName ?? targetUser?.firstName ?? "";
					const nextLastName = lastName ?? targetUser?.lastName ?? "";

					yield* _(
						dbService.query("updateEmployeeAuthUserName", async () => {
							await dbService.db
								.update(user)
								.set({
									firstName: nextFirstName,
									lastName: nextLastName,
									name: [nextFirstName, nextLastName].filter(Boolean).join(" "),
									updatedAt: new Date(),
								})
								.where(eq(user.id, targetEmployee.userId));
						}),
					);
				}

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

				const previousStartDate = dateToUtcIsoDate(targetEmployee.startDate);
				const hasStartDateUpdate =
					Object.hasOwn(scopedData, "startDate") && scopedData.startDate !== undefined;
				const nextStartDate = hasStartDateUpdate
					? dateToUtcIsoDate(scopedData.startDate)
					: previousStartDate;
				if (nextStartDate !== previousStartDate) {
					const dirtyFromDate = [previousStartDate, nextStartDate]
						.filter((value): value is string => Boolean(value))
						.sort()[0];
					yield* _(
						Effect.promise(() =>
							markEmployeeWorkBalanceDirty({
								employeeId,
								organizationId: targetEmployee.organizationId,
								dirtyFromDate,
							}),
						),
					);
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

function dateToUtcIsoDate(value: Date | string | null | undefined): string | null {
	if (!value) return null;
	return (
		typeof value === "string"
			? DateTime.fromISO(value, { zone: "utc" })
			: DateTime.fromJSDate(value, { zone: "utc" })
	).toISODate();
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

				const validatedData = yield* _(validateInput(personalInformationSchema, data, "profile"));
				const {
					firstName: _firstName,
					lastName: _lastName,
					...employeeProfileData
				} = validatedData;

				yield* _(
					dbService.query("updateOwnProfile", async () => {
						await dbService.db
							.update(employee)
							.set({
								...employeeProfileData,
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
							actor.session.user.id,
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
