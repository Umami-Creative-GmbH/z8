"use server";

import { and, asc, count, desc, eq, ilike, inArray, notInArray, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { Effect } from "effect";
import { invitation, user } from "@/db/auth-schema";
import {
	employee,
	employeeInvitationDraft,
	employeeManagers,
	team,
	workPolicyAssignment,
} from "@/db/schema";
import { ensureEmployeeProfilesForOrganizationMembers } from "@/lib/auth/organization-member-provisioning";
import { NotFoundError } from "@/lib/effect/errors";
import { runServerActionSafe, type ServerActionResult } from "@/lib/effect/result";
import { AppLayer } from "@/lib/effect/runtime";
import type {
	EmployeeDetailRecord,
	EmployeeDirectoryRow,
	EmployeeDirectoryStatus,
	EmployeeInvitationDraftWithRelations,
	EmployeeListParams,
	EmployeeSelectParams,
	EmployeeSelectResponse,
	EmployeeWithRelations,
	PaginatedEmployeeResponse,
	SelectableEmployee,
} from "./employee-action-types";
import {
	decodeEmployeeInvitationDraftId,
	encodeEmployeeInvitationDraftId,
} from "./employee-action-types";
import {
	ensureSettingsActorCanAccessEmployeeTarget,
	getEmployeeSettingsActorContext,
} from "./employee-action-utils";

const DEFAULT_LIMIT = 20;
const realEmployee = alias(employee, "realEmployee");
const realEmployeeUser = alias(user, "realEmployeeUser");

type EmployeeFilterParams = Omit<EmployeeSelectParams, "status"> & {
	status?: EmployeeDirectoryStatus;
};

const employeeSortName = sql<string>`
	coalesce(
		nullif(concat_ws(' ', ${user.firstName}, ${user.lastName}), ''),
		nullif(${user.name}, ''),
		${user.email}
	)
`;

function buildEmployeeFilters(
	organizationId: string,
	params: Pick<
		EmployeeFilterParams,
		"search" | "role" | "roles" | "status" | "teamId" | "excludeIds" | "managerId"
	>,
) {
	const conditions = [eq(employee.organizationId, organizationId)];

	if (params.role && params.role !== "all") {
		conditions.push(eq(employee.role, params.role));
	}

	if (params.roles?.length) {
		conditions.push(inArray(employee.role, params.roles));
	}

	if (params.status && params.status !== "all") {
		if (params.status === "draft") {
			conditions.push(sql<boolean>`false`);
		} else {
			conditions.push(eq(employee.isActive, params.status === "active"));
		}
	}

	if (params.teamId) {
		conditions.push(eq(employee.teamId, params.teamId));
	}

	if (params.managerId) {
		conditions.push(
			sql<boolean>`exists (
				select 1
				from ${employeeManagers}
				where ${employeeManagers.employeeId} = ${employee.id}
				and ${employeeManagers.managerId} = ${params.managerId}
			)`,
		);
	}

	if (params.excludeIds?.length) {
		conditions.push(notInArray(employee.id, params.excludeIds));
	}

	const normalizedSearch = params.search?.trim();
	if (normalizedSearch) {
		const pattern = `%${normalizedSearch}%`;
		conditions.push(
			or(
				ilike(user.firstName, pattern),
				ilike(user.lastName, pattern),
				ilike(user.name, pattern),
				ilike(user.email, pattern),
				ilike(employee.position, pattern),
			)!,
		);
	}

	return and(...conditions);
}

function mapEmployeeRow(row: {
	employee: typeof employee.$inferSelect;
	user: typeof user.$inferSelect;
	team: typeof team.$inferSelect | null;
}): EmployeeWithRelations {
	return {
		...row.employee,
		kind: "employee",
		user: row.user,
		team: row.team,
	};
}

function mapDraftRow(row: {
	draft: typeof employeeInvitationDraft.$inferSelect;
	invitation: typeof invitation.$inferSelect;
	team: typeof team.$inferSelect | null;
	realEmployee: Pick<typeof employee.$inferSelect, "id"> | null;
}): EmployeeInvitationDraftWithRelations {
	const displayName = [row.draft.firstName, row.draft.lastName].filter(Boolean).join(" ").trim();
	return {
		...row.draft,
		kind: "invitationDraft",
		encodedId: encodeEmployeeInvitationDraftId(row.draft.id),
		userId: row.draft.id,
		invitation: row.invitation,
		team: row.team,
		isActive: false,
		invitationStatus: row.invitation.status,
		realEmployeeId: row.realEmployee?.id ?? null,
		user: {
			id: row.draft.id,
			firstName: row.draft.firstName,
			lastName: row.draft.lastName,
			name: displayName || row.invitation.email,
			email: row.invitation.email,
			emailVerified: false,
			image: null,
			createdAt: row.draft.createdAt,
			updatedAt: row.draft.updatedAt,
			role: null,
			banned: null,
			banReason: null,
			banExpires: null,
			twoFactorEnabled: null,
			canCreateOrganizations: null,
			invitedVia: null,
			pendingInviteCode: null,
			canUseWebapp: true,
			canUseDesktop: true,
			canUseMobile: true,
		},
	};
}

function buildInvitationDraftFilters(
	organizationId: string,
	params: Pick<EmployeeFilterParams, "search" | "role" | "roles" | "status" | "teamId">,
) {
	if (params.status === "active" || params.status === "inactive") {
		return null;
	}

	const conditions = [eq(employeeInvitationDraft.organizationId, organizationId)];

	if (params.role && params.role !== "all") {
		conditions.push(eq(employeeInvitationDraft.role, params.role));
	}

	if (params.roles?.length) {
		conditions.push(inArray(employeeInvitationDraft.role, params.roles));
	}

	if (params.teamId) {
		conditions.push(eq(employeeInvitationDraft.teamId, params.teamId));
	}

	const normalizedSearch = params.search?.trim();
	if (normalizedSearch) {
		const pattern = `%${normalizedSearch}%`;
		conditions.push(
			or(
				ilike(employeeInvitationDraft.firstName, pattern),
				ilike(employeeInvitationDraft.lastName, pattern),
				ilike(invitation.email, pattern),
				ilike(employeeInvitationDraft.position, pattern),
			)!,
		);
	}

	return and(...conditions);
}

function sortEmployeeDirectoryRows(rows: EmployeeDirectoryRow[]) {
	return rows.toSorted((a, b) => {
		const nameCompare = (a.user.name || "").localeCompare(b.user.name || "");
		if (nameCompare !== 0) return nameCompare;
		const emailCompare = a.user.email.localeCompare(b.user.email);
		if (emailCompare !== 0) return emailCompare;
		return a.id.localeCompare(b.id);
	});
}

type SelectableEmployeeRow = {
	employee: Pick<
		typeof employee.$inferSelect,
		"id" | "userId" | "pronouns" | "position" | "role" | "isActive" | "teamId"
	>;
	user: Pick<
		typeof user.$inferSelect,
		"id" | "firstName" | "lastName" | "name" | "email" | "image"
	>;
	team: Pick<typeof team.$inferSelect, "id" | "name"> | null;
};

function mapSelectableEmployeeRow(row: SelectableEmployeeRow): SelectableEmployee {
	return {
		...row.employee,
		firstName: row.user.firstName,
		lastName: row.user.lastName,
		user: row.user,
		team: row.team?.id ? row.team : null,
	};
}

function loadEmployeePage(params: EmployeeListParams) {
	return Effect.gen(function* (_) {
		const actor = yield* _(getEmployeeSettingsActorContext());
		const { dbService } = actor;
		yield* _(
			dbService.query("reconcileOrganizationEmployeeProfiles", async () => {
				await ensureEmployeeProfilesForOrganizationMembers(dbService.db, actor.organizationId);
			}),
		);
		const limit = params.limit ?? DEFAULT_LIMIT;
		const offset = params.offset ?? 0;
		const where = buildEmployeeFilters(actor.organizationId, {
			...params,
			managerId:
				actor.accessTier === "manager" && actor.currentEmployee
					? actor.currentEmployee.id
					: undefined,
		});

		const includeInvitationDrafts = actor.accessTier === "orgAdmin";
		if (!includeInvitationDrafts) {
			const [totalResult, rows] = yield* _(
				Effect.all([
					dbService.query("countEmployees", async () => {
						return await dbService.db
							.select({ total: count() })
							.from(employee)
							.innerJoin(user, eq(employee.userId, user.id))
							.where(where);
					}),
					dbService.query("listEmployees", async () => {
						return await dbService.db
							.select({ employee, user, team })
							.from(employee)
							.innerJoin(user, eq(employee.userId, user.id))
							.leftJoin(team, eq(employee.teamId, team.id))
							.where(where)
							.orderBy(asc(employeeSortName), asc(user.email), asc(employee.id))
							.limit(limit)
							.offset(offset);
					}),
				]),
			);

			const total = totalResult[0]?.total ?? 0;
			return {
				employees: rows.map(mapEmployeeRow),
				total,
				hasMore: offset + rows.length < total,
			};
		}

		const draftWhere = buildInvitationDraftFilters(actor.organizationId, params);
		const [employeeRows, draftRows] = yield* _(
			Effect.all([
				dbService.query("listEmployees", async () => {
					return await dbService.db
						.select({ employee, user, team })
						.from(employee)
						.innerJoin(user, eq(employee.userId, user.id))
						.leftJoin(team, eq(employee.teamId, team.id))
						.where(where)
						.orderBy(asc(employeeSortName), asc(user.email), asc(employee.id));
				}),
				draftWhere
					? dbService.query("listEmployeeInvitationDrafts", async () => {
							return await dbService.db
								.select({
									draft: employeeInvitationDraft,
									invitation,
									team,
									realEmployee: { id: realEmployee.id },
								})
								.from(employeeInvitationDraft)
								.innerJoin(invitation, eq(employeeInvitationDraft.invitationId, invitation.id))
								.leftJoin(team, eq(employeeInvitationDraft.teamId, team.id))
								.leftJoin(realEmployeeUser, eq(realEmployeeUser.invitedVia, invitation.id))
								.leftJoin(
									realEmployee,
									and(
										eq(realEmployee.userId, realEmployeeUser.id),
										eq(realEmployee.organizationId, actor.organizationId),
									),
								)
								.where(draftWhere);
						})
					: Effect.succeed([]),
			]),
		);

		const employees = sortEmployeeDirectoryRows([
			...employeeRows.map(mapEmployeeRow),
			...draftRows.map(mapDraftRow),
		]);
		const pagedEmployees = employees.slice(offset, offset + limit);

		return {
			employees: pagedEmployees,
			total: employees.length,
			hasMore: offset + pagedEmployees.length < employees.length,
		};
	});
}

function loadSelectableEmployeePage(params: EmployeeSelectParams) {
	return Effect.gen(function* (_) {
		const actor = yield* _(getEmployeeSettingsActorContext());
		const { dbService } = actor;
		const limit = params.limit ?? DEFAULT_LIMIT;
		const offset = params.offset ?? 0;
		const where = buildEmployeeFilters(actor.organizationId, {
			...params,
			managerId:
				actor.accessTier === "manager" && actor.currentEmployee
					? actor.currentEmployee.id
					: undefined,
		});

		const [totalResult, rows] = yield* _(
			Effect.all([
				dbService.query("countSelectableEmployees", async () => {
					return await dbService.db
						.select({ total: count() })
						.from(employee)
						.innerJoin(user, eq(employee.userId, user.id))
						.where(where);
				}),
				dbService.query("listEmployeesForSelect", async () => {
					return await dbService.db
						.select({
							employee: {
								id: employee.id,
								userId: employee.userId,
								pronouns: employee.pronouns,
								position: employee.position,
								role: employee.role,
								isActive: employee.isActive,
								teamId: employee.teamId,
							},
							user: {
								id: user.id,
								firstName: user.firstName,
								lastName: user.lastName,
								name: user.name,
								email: user.email,
								image: user.image,
							},
							team: {
								id: team.id,
								name: team.name,
							},
						})
						.from(employee)
						.innerJoin(user, eq(employee.userId, user.id))
						.leftJoin(team, eq(employee.teamId, team.id))
						.where(where)
						.orderBy(asc(employeeSortName), asc(user.email), asc(employee.id))
						.limit(limit)
						.offset(offset);
				}),
			]),
		);

		const total = totalResult[0]?.total ?? 0;
		const typedRows = rows as unknown as SelectableEmployeeRow[];
		return {
			employees: typedRows.map(mapSelectableEmployeeRow),
			total,
			hasMore: offset + rows.length < total,
		};
	});
}

export async function getEmployeeAction(
	employeeId: string,
): Promise<ServerActionResult<EmployeeDetailRecord>> {
	const effect = Effect.gen(function* (_) {
		const actor = yield* _(getEmployeeSettingsActorContext());
		const { dbService } = actor;
		const draftId = decodeEmployeeInvitationDraftId(employeeId);

		if (draftId) {
			if (actor.accessTier !== "orgAdmin") {
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

			const draftRows = yield* _(
				dbService.query("getEmployeeInvitationDraft", async () => {
					return await dbService.db
						.select({
							draft: employeeInvitationDraft,
							invitation,
							team,
							realEmployee: { id: realEmployee.id },
						})
						.from(employeeInvitationDraft)
						.innerJoin(invitation, eq(employeeInvitationDraft.invitationId, invitation.id))
						.leftJoin(team, eq(employeeInvitationDraft.teamId, team.id))
						.leftJoin(realEmployeeUser, eq(realEmployeeUser.invitedVia, invitation.id))
						.leftJoin(
							realEmployee,
							and(
								eq(realEmployee.userId, realEmployeeUser.id),
								eq(realEmployee.organizationId, actor.organizationId),
							),
						)
						.where(
							and(
								eq(employeeInvitationDraft.id, draftId),
								eq(employeeInvitationDraft.organizationId, actor.organizationId),
							),
						)
						.limit(1);
				}),
			);

			const draftRow = draftRows[0];
			if (!draftRow) {
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

			return mapDraftRow(draftRow);
		}

		const rows = yield* _(
			dbService.query("getTargetEmployee", async () => {
				return await dbService.db
					.select({ employee, user, team })
					.from(employee)
					.innerJoin(user, eq(employee.userId, user.id))
					.leftJoin(team, eq(employee.teamId, team.id))
					.where(eq(employee.id, employeeId))
					.limit(1);
			}),
		);

		const targetEmployee = rows[0];
		if (!targetEmployee) {
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

		yield* _(
			ensureSettingsActorCanAccessEmployeeTarget(actor, targetEmployee.employee, {
				message: "You do not have access to this employee",
				resource: "employee",
				action: "read",
			}),
		);

		const detail = yield* _(
			dbService.query("getEmployeeRelations", async () => {
				return await dbService.db.query.employee.findFirst({
					where: eq(employee.id, employeeId),
					with: {
						user: true,
						team: true,
						managers: {
							with: {
								manager: {
									with: {
										user: true,
									},
								},
							},
						},
						workPolicyAssignments: {
							with: {
								policy: {
									with: {
										schedule: {
											with: {
												days: true,
											},
										},
									},
								},
							},
							orderBy: [desc(workPolicyAssignment.effectiveFrom)],
							limit: 1,
						},
					},
				});
			}),
		);

		if (!detail) {
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

		return { ...detail, kind: "employee" } as EmployeeWithRelations;
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}

export async function listEmployeesAction(
	params: EmployeeListParams = {},
): Promise<ServerActionResult<PaginatedEmployeeResponse>> {
	const effect = loadEmployeePage(params).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}

export async function listEmployeesForSelectAction(
	params: EmployeeSelectParams = {},
): Promise<ServerActionResult<EmployeeSelectResponse>> {
	const effect = loadSelectableEmployeePage(params).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}

export async function getEmployeesByIdsAction(
	employeeIds: string[],
): Promise<ServerActionResult<SelectableEmployee[]>> {
	if (employeeIds.length === 0) {
		return { success: true, data: [] };
	}

	const effect = Effect.gen(function* (_) {
		const actor = yield* _(getEmployeeSettingsActorContext());
		const { dbService } = actor;

		const rows = yield* _(
			dbService.query("getEmployeesByIds", async () => {
				const scopeWhere = buildEmployeeFilters(actor.organizationId, {
					excludeIds: [],
					roles: undefined,
					role: undefined,
					search: undefined,
					status: undefined,
					teamId: undefined,
					managerId:
						actor.accessTier === "manager" && actor.currentEmployee
							? actor.currentEmployee.id
							: undefined,
				});

				return await dbService.db
					.select({
						employee: {
							id: employee.id,
							userId: employee.userId,
							pronouns: employee.pronouns,
							position: employee.position,
							role: employee.role,
							isActive: employee.isActive,
							teamId: employee.teamId,
						},
						user: {
							id: user.id,
							firstName: user.firstName,
							lastName: user.lastName,
							name: user.name,
							email: user.email,
							image: user.image,
						},
						team: {
							id: team.id,
							name: team.name,
						},
					})
					.from(employee)
					.innerJoin(user, eq(employee.userId, user.id))
					.leftJoin(team, eq(employee.teamId, team.id))
					.where(and(scopeWhere, inArray(employee.id, employeeIds)))
					.orderBy(asc(employeeSortName), asc(user.email), asc(employee.id));
			}),
		);

		const typedRows = rows as unknown as SelectableEmployeeRow[];
		return typedRows.map(mapSelectableEmployeeRow);
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}
