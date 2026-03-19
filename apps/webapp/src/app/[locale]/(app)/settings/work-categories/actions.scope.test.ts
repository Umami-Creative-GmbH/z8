import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";

const WORK_CATEGORIES_ROOT = fileURLToPath(new URL(".", import.meta.url));

function stripComments(source: string): string {
	return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

const mockState = vi.hoisted(() => ({
	actor: {
		accessTier: "manager" as const,
		organizationId: "org-1",
		session: {
			user: {
				id: "user-1",
			},
		},
		currentEmployee: {
			id: "employee-manager-1",
			organizationId: "org-1",
			role: "manager" as const,
		},
		dbService: null as any,
	},
	managedEmployeeIds: new Set<string>(["employee-managed"]),
	teamPermissionsRows: [{ teamId: "team-managed", canManageTeamSettings: true }],
	projectManagers: [{ projectId: "project-managed" }],
	locationAssignments: [
		{ locationId: "location-managed", employeeId: "employee-manager-1" },
		{ locationId: "location-managed", employeeId: "employee-area-member" },
	],
	subareaAssignments: [
		{ subareaId: "subarea-managed", employeeId: "employee-manager-1" },
		{ subareaId: "subarea-managed", employeeId: "employee-area-member" },
	],
	teamEmployeeRows: [{ id: "employee-team-member", teamId: "team-managed" }],
	areaEmployeeRows: [{ id: "employee-area-member", teamId: null }],
	assignmentRows: [
		{
			id: "assignment-org",
			setId: "set-org",
			assignmentType: "organization",
			teamId: null,
			employeeId: null,
			priority: 0,
			effectiveFrom: null,
			effectiveUntil: null,
			isActive: true,
			createdAt: new Date("2026-01-01T00:00:00.000Z"),
			set: { id: "set-org", name: "Org Default", description: null },
			team: null,
			employee: null,
		},
		{
			id: "assignment-team-managed",
			setId: "set-team-managed",
			assignmentType: "team",
			teamId: "team-managed",
			employeeId: null,
			priority: 1,
			effectiveFrom: null,
			effectiveUntil: null,
			isActive: true,
			createdAt: new Date("2026-01-02T00:00:00.000Z"),
			set: { id: "set-team-managed", name: "Managed Team Set", description: null },
			team: { id: "team-managed", name: "Managed Team" },
			employee: null,
		},
		{
			id: "assignment-team-other",
			setId: "set-team-other",
			assignmentType: "team",
			teamId: "team-other",
			employeeId: null,
			priority: 1,
			effectiveFrom: null,
			effectiveUntil: null,
			isActive: true,
			createdAt: new Date("2026-01-03T00:00:00.000Z"),
			set: { id: "set-team-other", name: "Other Team Set", description: null },
			team: { id: "team-other", name: "Other Team" },
			employee: null,
		},
	],
	selectQueue: [] as Array<any>,
	insertValues: [] as Array<any>,
}));

vi.mock("next/cache", () => ({
	revalidatePath: vi.fn(),
}));

vi.mock("drizzle-orm", () => ({
	and: vi.fn((...args: unknown[]) => ({ and: args })),
	asc: vi.fn((value: unknown) => value),
	desc: vi.fn((value: unknown) => value),
	eq: vi.fn((left: unknown, right: unknown) => ({ eq: [left, right] })),
	inArray: vi.fn((left: unknown, right: unknown[]) => ({ inArray: [left, right] })),
	sql: vi.fn((strings: TemplateStringsArray) => strings.join("")),
}));

vi.mock("@/db/schema", () => ({
	employee: { id: "id", userId: "userId", organizationId: "organizationId", isActive: "isActive", role: "role" },
	projectManager: { employeeId: "employeeId", projectId: "projectId" },
	locationEmployee: { locationId: "locationId", employeeId: "employeeId" },
	subareaEmployee: { subareaId: "subareaId", employeeId: "employeeId" },
	team: { id: "id", name: "name", organizationId: "organizationId" },
	teamPermissions: {
		employeeId: "employeeId",
		organizationId: "organizationId",
		teamId: "teamId",
		canManageTeamSettings: "canManageTeamSettings",
	},
	workCategory: {
		id: "id",
		organizationId: "organizationId",
		name: "name",
		description: "description",
		factor: "factor",
		color: "color",
		isActive: "isActive",
		createdAt: "createdAt",
	},
	workCategorySet: { id: "id", organizationId: "organizationId", isActive: "isActive", name: "name", description: "description", createdAt: "createdAt" },
	workCategorySetAssignment: {
		id: "id",
		setId: "setId",
		organizationId: "organizationId",
		assignmentType: "assignmentType",
		teamId: "teamId",
		employeeId: "employeeId",
		isActive: "isActive",
		createdAt: "createdAt",
	},
	workCategorySetCategory: { setId: "setId", categoryId: "categoryId", sortOrder: "sortOrder" },
	workPeriod: { organizationId: "organizationId", employeeId: "employeeId", projectId: "projectId", workCategoryId: "workCategoryId" },
}));

vi.mock("@/app/[locale]/(app)/settings/employees/employee-action-utils", async () => {
	const { Effect } = await import("effect");
	const { AuthorizationError } = await import("@/lib/effect/errors");

	return {
		getEmployeeSettingsActorContext: vi.fn(() =>
			Effect.succeed({
				...mockState.actor,
				dbService: {
					db: {
						query: {
							employee: {
								findMany: vi.fn(async () => mockState.teamEmployeeRows),
							},
							locationEmployee: {
								findMany: vi.fn(async () => mockState.locationAssignments),
							},
							subareaEmployee: {
								findMany: vi.fn(async () => mockState.subareaAssignments),
							},
							teamPermissions: {
								findMany: vi.fn(async () => mockState.teamPermissionsRows),
							},
							projectManager: {
								findMany: vi.fn(async () => mockState.projectManagers),
							},
							workCategorySetAssignment: {
								findMany: vi.fn(async () => mockState.assignmentRows),
							},
						},
						select: vi.fn(() => ({
							from: vi.fn(() => ({
								innerJoin: vi.fn(() => ({
									where: vi.fn(() => {
										const execute = async () => mockState.selectQueue.shift() ?? [];
										return {
											orderBy: vi.fn(async () => execute()),
											then: (resolve: (value: unknown[]) => unknown, reject?: (error: unknown) => unknown) =>
												execute().then(resolve, reject),
										};
									}),
								})),
								where: vi.fn(() => {
									const execute = async () => mockState.selectQueue.shift() ?? [];
									return {
										orderBy: vi.fn(async () => execute()),
										limit: vi.fn(async () => execute()),
										then: (resolve: (value: unknown[]) => unknown, reject?: (error: unknown) => unknown) =>
											execute().then(resolve, reject),
									};
								}),
							})),
						})),
						insert: vi.fn(() => ({
							values: vi.fn((values: unknown) => {
								mockState.insertValues.push(values);
								return {
									returning: vi.fn(async () => [{ id: "category-created" }]),
								};
							}),
						})),
					},
					query: (_key: string, fn: () => Promise<unknown>) => Effect.promise(fn),
				},
			}),
		),
		getManagedEmployeeIdsForSettingsActor: vi.fn(() => Effect.succeed(mockState.managedEmployeeIds)),
		requireOrgAdminEmployeeSettingsAccess: vi.fn((actor: typeof mockState.actor, options: any) =>
			actor.accessTier === "orgAdmin"
				? Effect.void
				: Effect.fail(
						new AuthorizationError({
							message: options.message,
							userId: actor.session.user.id,
							resource: options.resource,
							action: options.action,
						}),
				  ),
		),
	};
});

vi.mock("@/lib/effect/services/auth.service", async () => {
	const { Context } = await import("effect");
	const AuthService = Context.GenericTag<any>("AuthService");
	return { AuthService };
});

vi.mock("@/lib/effect/services/database.service", async () => {
	const { Context } = await import("effect");
	const DatabaseService = Context.GenericTag<any>("DatabaseService");
	return { DatabaseService };
});

vi.mock("@/lib/effect/runtime", async () => {
	const { Effect, Layer } = await import("effect");
	return {
		AppLayer: Layer.empty,
		runtime: {
			runPromiseExit: Effect.runPromiseExit,
		},
	};
});

	const {
		createOrganizationCategory,
		getOrganizationCategories,
		getWorkCategorySets,
		getWorkCategorySetAssignments,
		getWorkCategorySetDetail,
	} = await import("./actions");

describe("work category settings manager scope", () => {
	beforeEach(() => {
		mockState.actor = {
			accessTier: "manager",
			organizationId: "org-1",
			session: { user: { id: "user-1" } },
			currentEmployee: {
				id: "employee-manager-1",
				organizationId: "org-1",
				role: "manager",
			},
			dbService: null,
		};
		mockState.managedEmployeeIds = new Set(["employee-managed"]);
		mockState.teamPermissionsRows = [{ teamId: "team-managed", canManageTeamSettings: true }];
		mockState.projectManagers = [{ projectId: "project-managed" }];
		mockState.locationAssignments = [
			{ locationId: "location-managed", employeeId: "employee-manager-1" },
			{ locationId: "location-managed", employeeId: "employee-area-member" },
		];
		mockState.subareaAssignments = [
			{ subareaId: "subarea-managed", employeeId: "employee-manager-1" },
			{ subareaId: "subarea-managed", employeeId: "employee-area-member" },
		];
		mockState.teamEmployeeRows = [{ id: "employee-team-member", teamId: "team-managed" }];
		mockState.areaEmployeeRows = [{ id: "employee-area-member", teamId: null }];
		mockState.assignmentRows = [
			{
				id: "assignment-org",
				setId: "set-org",
				assignmentType: "organization",
				teamId: null,
				employeeId: null,
				priority: 0,
				effectiveFrom: null,
				effectiveUntil: null,
				isActive: true,
				createdAt: new Date("2026-01-01T00:00:00.000Z"),
				set: { id: "set-org", name: "Org Default", description: null },
				team: null,
				employee: null,
			},
			{
				id: "assignment-team-managed",
				setId: "set-team-managed",
				assignmentType: "team",
				teamId: "team-managed",
				employeeId: null,
				priority: 1,
				effectiveFrom: null,
				effectiveUntil: null,
				isActive: true,
				createdAt: new Date("2026-01-02T00:00:00.000Z"),
				set: { id: "set-team-managed", name: "Managed Team Set", description: null },
				team: { id: "team-managed", name: "Managed Team" },
				employee: null,
			},
			{
				id: "assignment-team-other",
				setId: "set-team-other",
				assignmentType: "team",
				teamId: "team-other",
				employeeId: null,
				priority: 1,
				effectiveFrom: null,
				effectiveUntil: null,
				isActive: true,
				createdAt: new Date("2026-01-03T00:00:00.000Z"),
				set: { id: "set-team-other", name: "Other Team Set", description: null },
				team: { id: "team-other", name: "Other Team" },
				employee: null,
			},
		];
		mockState.selectQueue = [];
		mockState.insertValues = [];
	});

	it("shows managers only category definitions used by scoped teams own areas or managed projects", async () => {
		mockState.selectQueue = [
			[
				{ id: "category-area", organizationId: "org-1", name: "Own Area Category", description: null, factor: "1.00", color: null, isActive: true, createdAt: new Date("2026-01-01T00:00:00.000Z") },
				{ id: "category-team", organizationId: "org-1", name: "Managed Team Category", description: null, factor: "1.00", color: null, isActive: true, createdAt: new Date("2026-01-01T00:00:00.000Z") },
				{ id: "category-project", organizationId: "org-1", name: "Managed Project Category", description: null, factor: "1.00", color: null, isActive: true, createdAt: new Date("2026-01-01T00:00:00.000Z") },
				{ id: "category-other", organizationId: "org-1", name: "Other Category", description: null, factor: "1.00", color: null, isActive: true, createdAt: new Date("2026-01-01T00:00:00.000Z") },
			],
			[{ count: 1 }],
			[{ count: 1 }],
			[{ count: 0 }],
			[{ count: 1 }],
			[
				{ workCategoryId: "category-team" },
				{ workCategoryId: "category-area" },
			],
			[{ workCategoryId: "category-project" }],
		];

		const result = await getOrganizationCategories("org-1");

		expect(result).toEqual({
			success: true,
			data: expect.arrayContaining([
				expect.objectContaining({ id: "category-team" }),
				expect.objectContaining({ id: "category-area" }),
				expect.objectContaining({ id: "category-project" }),
			]),
		});
	});

	it("keeps tenant filters on id-based mutations and removes dead scoped-assignment helpers", () => {
		const source = stripComments(readFileSync(new URL("./actions.ts", import.meta.url), "utf8"));

		expect(/eq\(workCategory\.id, input\.categoryId\)[\s\S]*eq\(workCategory\.organizationId, actor\.organizationId\)/.test(source)).toBe(true);
		expect(/eq\(workCategory\.id, categoryId\)[\s\S]*eq\(workCategory\.organizationId, actor\.organizationId\)/.test(source)).toBe(true);
		expect(/eq\(workCategorySet\.id, input\.setId\)[\s\S]*eq\(workCategorySet\.organizationId, actor\.organizationId\)/.test(source)).toBe(true);
		expect(/eq\(workCategorySet\.id, setId\)[\s\S]*eq\(workCategorySet\.organizationId, actor\.organizationId\)/.test(source)).toBe(true);
		expect(/eq\(workCategorySetAssignment\.id, assignmentId\)[\s\S]*eq\(workCategorySetAssignment\.organizationId, actor\.organizationId\)/.test(source)).toBe(true);
		expect(source.includes("ensureScopedCategoryIds(")).toBe(true);
		expect(source.includes("getScopedOrganizationWorkCategorySet(")).toBe(true);
		expect(source.includes("getScopedOrganizationSetAssignment(")).toBe(true);
		expect(source.includes("function getScopedAssignments(")).toBe(false);
	});

	it("hides organization default assignments when scoped teams areas and projects do not use them", async () => {
		mockState.assignmentRows = [
			{
				id: "assignment-org",
				setId: "set-org",
				assignmentType: "organization",
				teamId: null,
				employeeId: null,
				priority: 0,
				effectiveFrom: null,
				effectiveUntil: null,
				isActive: true,
				createdAt: new Date("2026-01-01T00:00:00.000Z"),
				set: { id: "set-org", name: "Org Default", description: null },
				team: null,
				employee: null,
			},
			{
				id: "assignment-team-managed",
				setId: "set-team-managed",
				assignmentType: "team",
				teamId: "team-managed",
				employeeId: null,
				priority: 1,
				effectiveFrom: null,
				effectiveUntil: null,
				isActive: true,
				createdAt: new Date("2026-01-02T00:00:00.000Z"),
				set: { id: "set-team-managed", name: "Managed Team Set", description: null },
				team: { id: "team-managed", name: "Managed Team" },
				employee: null,
			},
		];
		mockState.selectQueue = [
			[{ workCategoryId: "category-team" }],
			[{ workCategoryId: "category-project" }],
			[
				{ categoryId: "category-team", setId: "set-team-managed" },
			],
		];

		const result = await getWorkCategorySetAssignments("org-1");

		expect(result).toEqual({
			success: true,
			data: [expect.objectContaining({ id: "assignment-team-managed" })],
		});
	});

	it("filters out unrelated assignments even when they share a visible set", async () => {
		mockState.assignmentRows = [
			{
				id: "assignment-team-managed",
				setId: "set-team-managed",
				assignmentType: "team",
				teamId: "team-managed",
				employeeId: null,
				priority: 1,
				effectiveFrom: null,
				effectiveUntil: null,
				isActive: true,
				createdAt: new Date("2026-01-02T00:00:00.000Z"),
				set: { id: "set-team-managed", name: "Managed Team Set", description: null },
				team: { id: "team-managed", name: "Managed Team" },
				employee: null,
			},
			{
				id: "assignment-team-other",
				setId: "set-team-managed",
				assignmentType: "team",
				teamId: "team-other",
				employeeId: null,
				priority: 1,
				effectiveFrom: null,
				effectiveUntil: null,
				isActive: true,
				createdAt: new Date("2026-01-03T00:00:00.000Z"),
				set: { id: "set-team-managed", name: "Managed Team Set", description: null },
				team: { id: "team-other", name: "Other Team" },
				employee: null,
			},
			{
				id: "assignment-employee-other",
				setId: "set-team-managed",
				assignmentType: "employee",
				teamId: null,
				employeeId: "employee-unmanaged",
				priority: 2,
				effectiveFrom: null,
				effectiveUntil: null,
				isActive: true,
				createdAt: new Date("2026-01-04T00:00:00.000Z"),
				set: { id: "set-team-managed", name: "Managed Team Set", description: null },
				team: null,
				employee: { id: "employee-unmanaged", firstName: "Una", lastName: "Scoped" },
			},
		];
		mockState.selectQueue = [
			[{ workCategoryId: "category-team" }],
			[{ workCategoryId: "category-project" }],
			[{ categoryId: "category-team", setId: "set-team-managed" }],
			[{ id: "employee-team-member" }, { id: "employee-managed" }, { id: "employee-area-member" }],
		];

		const result = await getWorkCategorySetAssignments("org-1");

		expect(result).toEqual({
			success: true,
			data: [expect.objectContaining({ id: "assignment-team-managed" })],
		});
	});

	it("shows managers only sets backed by scoped category usage instead of assignment visibility", async () => {
		mockState.assignmentRows = [
			{
				id: "assignment-org",
				setId: "set-org",
				assignmentType: "organization",
				teamId: null,
				employeeId: null,
				priority: 0,
				effectiveFrom: null,
				effectiveUntil: null,
				isActive: true,
				createdAt: new Date("2026-01-01T00:00:00.000Z"),
				set: { id: "set-org", name: "Org Default", description: null },
				team: null,
				employee: null,
			},
		];
		mockState.selectQueue = [
			[
				{ id: "set-org", name: "Org Default", description: null, isActive: true, createdAt: new Date("2026-01-01T00:00:00.000Z") },
				{ id: "set-team-managed", name: "Managed Team Set", description: null, isActive: true, createdAt: new Date("2026-01-02T00:00:00.000Z") },
			],
			[{ count: 1 }],
			[{ count: 1 }],
			[{ count: 1 }],
			[{ count: 0 }],
			[{ workCategoryId: "category-team" }],
			[{ workCategoryId: "category-project" }],
			[{ categoryId: "category-team", setId: "set-team-managed" }],
		];

		const result = await getWorkCategorySets("org-1");

		expect(result).toEqual({
			success: true,
			data: [expect.objectContaining({ id: "set-team-managed" })],
		});
	});

	it("rejects manager detail reads for arbitrary sets while allowing scoped sets", async () => {
		mockState.selectQueue = [
			[{ workCategoryId: "category-team" }],
			[{ workCategoryId: "category-project" }],
			[{ id: "set-other", organizationId: "org-1", isActive: true, name: "Other Set", description: null }],
			[],
			[{ id: "category-other", name: "Other", description: null, factor: "1.00", color: null, isActive: true, sortOrder: 0 }],
		];

		const denied = await getWorkCategorySetDetail("set-other");

		expect(denied).toMatchObject({ success: false });

		mockState.selectQueue = [
			[{ workCategoryId: "category-team" }],
			[{ workCategoryId: "category-project" }],
			[{ id: "set-team-managed", organizationId: "org-1", isActive: true, name: "Managed Team Set", description: null }],
			[{ categoryId: "category-team", setId: "set-team-managed" }],
			[{ id: "category-team", name: "Managed Team Category", description: null, factor: "1.00", color: null, isActive: true, sortOrder: 0 }],
		];

		const allowed = await getWorkCategorySetDetail("set-team-managed");

		expect(allowed).toEqual({
			success: true,
			data: {
				set: expect.objectContaining({ id: "set-team-managed" }),
				categories: expect.arrayContaining([expect.objectContaining({ id: "category-team" })]),
			},
		});
	});

	it("keeps owner parity with org admins for category reads", async () => {
		mockState.actor = {
			accessTier: "orgAdmin",
			organizationId: "org-1",
			session: { user: { id: "user-owner-1" } },
			currentEmployee: null,
			dbService: null,
		};
		mockState.selectQueue = [
			[
				{ id: "category-org", organizationId: "org-1", name: "Org Category", description: null, factor: "1.00", color: null, isActive: true, createdAt: new Date("2026-01-01T00:00:00.000Z") },
				{ id: "category-other", organizationId: "org-1", name: "Other Category", description: null, factor: "1.00", color: null, isActive: true, createdAt: new Date("2026-01-01T00:00:00.000Z") },
			],
			[{ count: 1 }],
			[{ count: 0 }],
		];

		const result = await getOrganizationCategories("org-1");

		expect(result).toEqual({
			success: true,
			data: [
				expect.objectContaining({ id: "category-org" }),
				expect.objectContaining({ id: "category-other" }),
			],
		});
	});

	it("rejects manager category creation while preserving owner org-admin parity", async () => {
		const managerResult = await createOrganizationCategory({
			organizationId: "org-1",
			name: "Manager Category",
			factor: "1.00",
		});

		expect(managerResult).toMatchObject({ success: false });

		mockState.actor = {
			accessTier: "orgAdmin",
			organizationId: "org-1",
			session: { user: { id: "user-owner-1" } },
			currentEmployee: null,
			dbService: null,
		};
		mockState.selectQueue = [[], []];

		const ownerResult = await createOrganizationCategory({
			organizationId: "org-1",
			name: "Owner Category",
			factor: "1.00",
		});

		expect(ownerResult).toEqual({ success: true, data: { id: "category-created" } });
		expect(mockState.insertValues).toEqual([
			expect.objectContaining({
				organizationId: "org-1",
				name: "Owner Category",
				createdBy: "user-owner-1",
			}),
		]);
	});
});
