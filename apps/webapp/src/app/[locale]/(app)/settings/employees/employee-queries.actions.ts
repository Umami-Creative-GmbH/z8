"use server";

import { and, asc, count, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { Effect } from "effect";
import { z } from "zod";
import { invitation, member, user } from "@/db/auth-schema";
import { employee, employeeInvitationDraft, team, workPolicyAssignment } from "@/db/schema";
import { dateFromInstant, systemClock } from "@/lib/datetime/temporal-core";
import { AuthorizationError, NotFoundError } from "@/lib/effect/errors";
import { type DatabaseClient, DatabaseService } from "@/lib/effect/services/database.service";
import { formerSinceDate, isFormerEmployee } from "@/lib/employee-lifecycle/current-roster";
import { formerSinceField } from "@/lib/employee-lifecycle/former-since";
import {
	loadCurrentContractTypes,
	loadTermsInForceOn,
} from "@/lib/employment-history/load-terms-in-force";
import { findRecordsMissingRequiredValues } from "@/lib/organization/custom-fields/values";
import {
	type OrganizationActor,
	organizationAction,
} from "@/lib/organization-action/organization-action";
import { meetsSettingsAccess } from "@/lib/organization-action/settings-access";
import { loadOrganizationDay } from "@/lib/personnel-file/organization-day";
import type {
	EmployeeDirectoryRow,
	EmployeeInvitationDraftWithRelations,
	EmployeeListParams,
	EmployeeMembershipSummary,
	EmployeeWithRelations,
} from "./employee-action-types";
import {
	decodeEmployeeInvitationDraftId,
	encodeEmployeeInvitationDraftId,
	normalizeEmployeeDirectoryStatus,
} from "./employee-action-types";
import { buildEligibleInvitationDraftPredicate } from "./employee-invitation-draft-eligibility";
import { managedEmployeeIdsOf, scopeReachesEmployee } from "./managed-employee";
import {
	buildEmployeeFilters,
	type EmployeeFilterParams,
	employeeSortName,
	mapSelectableEmployeeRow,
	type SelectableEmployeeRow,
	selectableEmployeeColumns,
	selectableEmployeePage,
} from "./selectable-employees";

const DEFAULT_LIMIT = 20;

/** Who reads the directory: their organization, and whether they are an org admin. */
type DirectoryViewer = {
	organizationId: string;
	userId: string;
	isOrgAdmin: boolean;
};

function directoryViewerOf(actor: OrganizationActor, organizationId: string): DirectoryViewer {
	return {
		organizationId,
		userId: actor.userId,
		isOrgAdmin: meetsSettingsAccess(actor.settingsAccess, "orgAdmin"),
	};
}

const employeeRoleSchema = z.enum(["admin", "manager", "employee"]);
const employeeListParamsSchema = z
	.strictObject({
		search: z.string().max(2000).optional(),
		role: z.union([employeeRoleSchema, z.literal("all")]).optional(),
		// An unknown or legacy status reads as the default, the current roster (#1438).
		status: z
			.enum(["current", "former", "draft", "all", "active", "inactive"])
			.optional()
			.catch(undefined),
		limit: z.number().int().min(1).max(1000).optional(),
		offset: z.number().int().min(0).optional(),
	})
	.default({});
const employeeSelectParamsSchema = z
	.strictObject({
		search: z.string().max(2000).optional(),
		role: z.union([employeeRoleSchema, z.literal("all")]).optional(),
		roles: z.array(employeeRoleSchema).optional(),
		status: z.enum(["current", "former", "all", "active", "inactive"]).optional().catch(undefined),
		teamId: z.string().optional(),
		excludeIds: z.array(z.string()).optional(),
		limit: z.number().int().min(1).max(1000).optional(),
		offset: z.number().int().min(0).optional(),
	})
	.default({});

/** Only an org admin sees an employee's full birthday; it reveals age (#1579). */
function birthdayVisibleTo(viewer: DirectoryViewer, birthday: Date | null): Date | null {
	return viewer.isOrgAdmin ? birthday : null;
}

function mapEmployeeRow(
	row: {
		employee: typeof employee.$inferSelect;
		user: typeof user.$inferSelect;
		team: typeof team.$inferSelect | null;
		membership: EmployeeMembershipSummary | null;
		isFormer: boolean;
		formerSince: string | null;
	},
	viewer: DirectoryViewer,
): EmployeeWithRelations {
	const isFormer = row.isFormer === true;
	return {
		...row.employee,
		birthday: birthdayVisibleTo(viewer, row.employee.birthday),
		kind: "employee",
		user: row.user,
		team: row.team,
		membership: row.membership?.id ? row.membership : null,
		isFormer,
		...formerSinceField(isFormer, row.formerSince),
	};
}

function mapDraftRow(row: {
	draft: typeof employeeInvitationDraft.$inferSelect;
	invitation: typeof invitation.$inferSelect;
	team: typeof team.$inferSelect | null;
}): EmployeeInvitationDraftWithRelations {
	const displayName = [row.draft.firstName, row.draft.lastName].filter(Boolean).join(" ").trim();
	return {
		...row.draft,
		kind: "invitationDraft",
		encodedId: encodeEmployeeInvitationDraftId(row.draft.id),
		userId: row.draft.id,
		invitation: row.invitation,
		team: row.team,
		membership: null,
		isActive: false,
		invitationStatus: row.invitation.status,
		realEmployeeId: null,
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
		},
	};
}

function buildInvitationDraftFilters(
	organizationId: string,
	now: Date,
	params: Pick<EmployeeFilterParams, "search" | "role" | "roles" | "status" | "teamId">,
) {
	// A pending invitation is someone about to join, never a former employee: drafts
	// stay listed under Current (the default), Draft and All (#1438).
	if (params.status === "former") {
		return null;
	}

	const conditions = [buildEligibleInvitationDraftPredicate({ organizationId, now })];

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

/**
 * Enriches the authorized directory page with visible missing custom fields
 * (#818) and current contract types (#1161). Invitation drafts keep their prepared data.
 */
function enrichEmployeeDirectoryRows(viewer: DirectoryViewer, rows: EmployeeDirectoryRow[]) {
	return Effect.gen(function* () {
		const dbService = yield* DatabaseService;
		const employees = rows.filter((row) => row.kind === "employee");
		const [missing, contractTypes] = yield* Effect.all([
			dbService.query("customFields.employeesMissingRequired", () =>
				findRecordsMissingRequiredValues(dbService.db, {
					organizationId: viewer.organizationId,
					entity: "employee",
					recordIds: employees.map((row) => row.id),
					viewer: { kind: "actor", userId: viewer.userId },
				}),
			),
			dbService.query("employeeContracts.current", () =>
				loadCurrentContractTypes(dbService.db, {
					organizationId: viewer.organizationId,
					employees,
				}),
			),
		]);
		return rows.map(
			(row): EmployeeDirectoryRow =>
				row.kind === "employee"
					? {
							...row,
							contractType: contractTypes.get(row.id) ?? row.contractType,
							missingRequiredCustomFields: missing.has(row.id),
						}
					: row,
		);
	});
}

function approvedMembershipOf(dbService: { readonly db: DatabaseClient }, organizationId: string) {
	return dbService.db
		.select({ id: member.id, role: member.role, status: member.status })
		.from(member)
		.where(
			and(
				eq(member.userId, employee.userId),
				eq(member.organizationId, organizationId),
				eq(member.status, "approved"),
			),
		)
		.orderBy(desc(member.createdAt), desc(member.id))
		.limit(1)
		.as("approved_employee_membership");
}

function loadEmployeePage(
	actor: OrganizationActor,
	organizationId: string,
	params: EmployeeListParams,
) {
	return Effect.gen(function* () {
		const dbService = yield* DatabaseService;
		const viewer = directoryViewerOf(actor, organizationId);
		const approvedMembership = approvedMembershipOf(dbService, organizationId);
		const limit = params.limit ?? DEFAULT_LIMIT;
		const offset = params.offset ?? 0;
		const filterParams = {
			...params,
			status: normalizeEmployeeDirectoryStatus(params.status, "all"),
		};
		// A scoped manager lists only the employees they manage (`actor.managedScope()`).
		const where = buildEmployeeFilters(organizationId, {
			...filterParams,
			onlyEmployeeIds: managedEmployeeIdsOf(yield* actor.managedScope()),
		});
		const directoryColumns = {
			employee,
			user,
			team,
			membership: {
				id: approvedMembership.id,
				role: approvedMembership.role,
				status: approvedMembership.status,
			},
			isFormer: isFormerEmployee(),
			formerSince: formerSinceDate(),
		};

		const includeInvitationDrafts = viewer.isOrgAdmin;
		if (!includeInvitationDrafts) {
			const [totalResult, rows] = yield* Effect.all([
				dbService.query("countEmployees", async () => {
					return await dbService.db
						.select({ total: count() })
						.from(employee)
						.innerJoin(user, eq(employee.userId, user.id))
						.where(where);
				}),
				dbService.query("listEmployees", async () => {
					return await dbService.db
						.select(directoryColumns)
						.from(employee)
						.innerJoin(user, eq(employee.userId, user.id))
						.leftJoin(team, eq(employee.teamId, team.id))
						.leftJoinLateral(approvedMembership, sql`true`)
						.where(where)
						.orderBy(asc(employeeSortName), asc(user.email), asc(employee.id))
						.limit(limit)
						.offset(offset);
				}),
			]);

			const total = totalResult[0]?.total ?? 0;
			return {
				employees: yield* enrichEmployeeDirectoryRows(
					viewer,
					rows.map((row) => mapEmployeeRow(row, viewer)),
				),
				total,
				hasMore: offset + rows.length < total,
			};
		}

		const now = dateFromInstant(systemClock.nowInstant());
		const draftWhere = buildInvitationDraftFilters(organizationId, now, filterParams);
		const [employeeRows, draftRows] = yield* Effect.all([
			dbService.query("listEmployees", async () => {
				return await dbService.db
					.select(directoryColumns)
					.from(employee)
					.innerJoin(user, eq(employee.userId, user.id))
					.leftJoin(team, eq(employee.teamId, team.id))
					.leftJoinLateral(approvedMembership, sql`true`)
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
							})
							.from(employeeInvitationDraft)
							.innerJoin(invitation, eq(employeeInvitationDraft.invitationId, invitation.id))
							.leftJoin(team, eq(employeeInvitationDraft.teamId, team.id))
							.where(draftWhere);
					})
				: Effect.succeed([]),
		]);

		const employees = sortEmployeeDirectoryRows([
			...employeeRows.map((row) => mapEmployeeRow(row, viewer)),
			...draftRows.map(mapDraftRow),
		]);
		const pagedEmployees = employees.slice(offset, offset + limit);

		return {
			employees: yield* enrichEmployeeDirectoryRows(viewer, pagedEmployees),
			total: employees.length,
			hasMore: offset + pagedEmployees.length < employees.length,
		};
	});
}

const employeeNotFound = (employeeId: string) =>
	new NotFoundError({
		message: "Employee not found",
		entityType: "employee",
		entityId: employeeId,
	});

/** One employee, or an invitation draft for an org admin, as the detail page shows it. */
export const getEmployeeAction = organizationAction(
	{
		name: "employees.get",
		requires: "scopedManager",
		schema: z.string().trim().min(1, "Invalid employee ID"),
	},
	({ actor, organizationId, input: employeeId }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;
			const viewer = directoryViewerOf(actor, organizationId);
			const draftId = decodeEmployeeInvitationDraftId(employeeId);

			if (draftId) {
				if (!viewer.isOrgAdmin) {
					return yield* Effect.fail(employeeNotFound(employeeId));
				}
				const now = dateFromInstant(systemClock.nowInstant());

				const draftRows = yield* dbService.query("getEmployeeInvitationDraft", async () => {
					return await dbService.db
						.select({
							draft: employeeInvitationDraft,
							invitation,
							team,
						})
						.from(employeeInvitationDraft)
						.innerJoin(invitation, eq(employeeInvitationDraft.invitationId, invitation.id))
						.leftJoin(team, eq(employeeInvitationDraft.teamId, team.id))
						.where(
							buildEligibleInvitationDraftPredicate({
								organizationId,
								now,
								draftId,
							}),
						)
						.limit(1);
				});

				const draftRow = draftRows[0];
				if (!draftRow) {
					return yield* Effect.fail(employeeNotFound(employeeId));
				}

				return mapDraftRow(draftRow);
			}

			const approvedMembership = approvedMembershipOf(dbService, organizationId);
			const rows = yield* dbService.query("getTargetEmployee", async () => {
				return await dbService.db
					.select({
						employee,
						user,
						team,
						membership: {
							id: approvedMembership.id,
							role: approvedMembership.role,
							status: approvedMembership.status,
						},
						// The page says whether they left, and since when (#1438, #1439).
						isFormer: isFormerEmployee(),
						formerSince: formerSinceDate(),
					})
					.from(employee)
					.innerJoin(user, eq(employee.userId, user.id))
					.leftJoin(team, eq(employee.teamId, team.id))
					.leftJoinLateral(approvedMembership, sql`true`)
					.where(and(eq(employee.id, employeeId), eq(employee.organizationId, organizationId)))
					.limit(1);
			});

			const targetEmployee = rows[0];
			if (!targetEmployee) {
				return yield* Effect.fail(employeeNotFound(employeeId));
			}

			if (!scopeReachesEmployee(yield* actor.managedScope(), targetEmployee.employee.id)) {
				return yield* Effect.fail(
					new AuthorizationError({
						message: "You do not have access to this employee",
						userId: actor.userId,
						resource: "employee",
						action: "read",
					}),
				);
			}

			const detail = yield* dbService.query("getEmployeeRelations", async () => {
				return await dbService.db.query.employee.findFirst({
					where: and(eq(employee.id, employeeId), eq(employee.organizationId, organizationId)),
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
			});

			if (!detail) {
				return yield* Effect.fail(employeeNotFound(employeeId));
			}

			// The edit form shows today's contract type read-only (#1177).
			const termsToday = yield* dbService.query("employmentTerms.getToday", async () => {
				const { timezone, today } = await loadOrganizationDay(dbService.db, {
					organizationId,
					now: systemClock.nowInstant(),
				});
				return loadTermsInForceOn(dbService.db, {
					organizationId,
					employeeId,
					date: today,
					timezone,
				});
			});

			return {
				...detail,
				birthday: birthdayVisibleTo(viewer, detail.birthday),
				kind: "employee",
				membership: targetEmployee.membership?.id ? targetEmployee.membership : null,
				contractTypeToday: termsToday?.contractType ?? null,
				isFormer: targetEmployee.isFormer === true,
				...formerSinceField(targetEmployee.isFormer === true, targetEmployee.formerSince),
			} as EmployeeWithRelations;
		}),
);

/** One page of the employee directory; an org admin also sees invitation drafts. */
export const listEmployeesAction = organizationAction(
	{ name: "employees.list", requires: "scopedManager", schema: employeeListParamsSchema },
	({ actor, organizationId, input }) => loadEmployeePage(actor, organizationId, input),
);

/** One page of the employees the actor may pick (employee pickers, the shift dialog). */
export const listEmployeesForSelectAction = organizationAction(
	{
		name: "employees.listForSelect",
		requires: "scopedManager",
		schema: employeeSelectParamsSchema,
	},
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			return yield* selectableEmployeePage(
				{ organizationId, onlyEmployeeIds: managedEmployeeIdsOf(yield* actor.managedScope()) },
				input,
			);
		}),
);

/**
 * The employees with these IDs the actor may pick. Already selected employees
 * display even when they have left since (#1438): no roster filter here, and
 * the row carries the former-employee mark for the label.
 */
export const getEmployeesByIdsAction = organizationAction(
	{ name: "employees.getByIds", requires: "scopedManager", schema: z.array(z.string()) },
	({ actor, organizationId, input: employeeIds }) =>
		Effect.gen(function* () {
			if (employeeIds.length === 0) return [];
			return yield* loadEmployeesByIds(
				organizationId,
				managedEmployeeIdsOf(yield* actor.managedScope()),
				employeeIds,
			);
		}),
);

function loadEmployeesByIds(
	organizationId: string,
	onlyEmployeeIds: ReadonlySet<string> | null,
	employeeIds: string[],
) {
	return Effect.gen(function* () {
		const dbService = yield* DatabaseService;
		const scopeWhere = buildEmployeeFilters(organizationId, {
			excludeIds: [],
			roles: undefined,
			role: undefined,
			search: undefined,
			status: "all",
			teamId: undefined,
			onlyEmployeeIds,
		});
		const rows = yield* dbService.query("getEmployeesByIds", async () => {
			return await dbService.db
				.select(selectableEmployeeColumns)
				.from(employee)
				.innerJoin(user, eq(employee.userId, user.id))
				.leftJoin(team, eq(employee.teamId, team.id))
				.where(and(scopeWhere, inArray(employee.id, employeeIds)))
				.orderBy(asc(employeeSortName), asc(user.email), asc(employee.id));
		});

		const typedRows = rows as unknown as SelectableEmployeeRow[];
		return typedRows.map(mapSelectableEmployeeRow);
	});
}
