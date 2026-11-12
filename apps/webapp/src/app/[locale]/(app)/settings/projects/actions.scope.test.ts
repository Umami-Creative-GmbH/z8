import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StubCaller } from "@/test/organization-action";

const mockState = vi.hoisted(() => ({
	caller: null as StubCaller | null,
	projectRows: [] as Array<any>,
	projectManagers: [] as Array<any>,
	projectAssignments: [] as Array<any>,
	hoursBooked: [] as Array<any>,
	projectQueue: [] as Array<any>,
	customerQueue: [] as Array<any>,
	updateWhereArgs: [] as Array<any>,
	insertCalls: [] as Array<any>,
	transactionProjectManagerShouldFail: false,
	transactionCalls: 0,
}));

vi.mock("next/cache", () => ({
	revalidatePath: vi.fn(),
}));

// Billable Time reads (#768) run on PostgreSQL in actions.billable-default.integration.test.ts.
vi.mock("@/lib/billable-time/settings", () => ({
	getBillableTimeSettings: vi.fn(async () => ({ enabled: true, currency: "EUR" })),
}));
vi.mock("@/lib/reports/completed-work", () => ({
	completedWorkPeriodCondition: vi.fn(() => undefined),
}));
vi.mock("@/lib/billable-time/project-customer", () => ({
	projectHasActiveCustomerSql: vi.fn(() => undefined),
	readProjectActiveCustomerId: vi.fn(async () => "customer-active"),
}));

vi.mock("@/lib/organization/custom-fields/values", () => ({
	findRecordsMissingRequiredValues: vi.fn(async () => new Set<string>()),
}));

vi.mock("@/lib/organization/custom-fields/form-values", () => ({
	keepCustomFieldRefusal: (error: unknown) => error,
	saveFormCustomFieldValues: vi.fn(async () => undefined),
}));

vi.mock("@/lib/audit-logger", () => ({
	AuditAction: {
		PROJECT_CREATED: "PROJECT_CREATED",
		PROJECT_UPDATED: "PROJECT_UPDATED",
	},
	logAudit: vi.fn(async () => undefined),
}));

vi.mock("@/db", async () => {
	const { project } = await import("@/db/schema");
	return {
		db: {
			query: {
				project: {
					findMany: vi.fn(async () => mockState.projectRows),
					findFirst: vi.fn(async () => mockState.projectQueue.shift() ?? null),
				},
				projectManager: {
					findMany: vi.fn(async () => mockState.projectManagers),
					findFirst: vi.fn(async () => null),
				},
				projectAssignment: {
					findMany: vi.fn(async () => mockState.projectAssignments),
					findFirst: vi.fn(async () => null),
				},
				customer: {
					findFirst: vi.fn(async () => mockState.customerQueue.shift() ?? null),
				},
			},
			select: vi.fn(() => ({
				from: vi.fn(() => ({
					// Awaited directly: the projects with an active customer (none here).
					where: vi.fn(() =>
						Object.assign(Promise.resolve([]), {
							groupBy: vi.fn(async () => mockState.hoursBooked),
						}),
					),
				})),
			})),
			transaction: vi.fn(async (callback: (tx: any) => Promise<unknown>) => {
				mockState.transactionCalls += 1;
				const tx = {
					update: vi.fn(() => ({
						set: vi.fn(() => ({
							where: vi.fn(async (whereArg: unknown) => {
								mockState.updateWhereArgs.push(whereArg);
								return undefined;
							}),
						})),
					})),
					insert: vi.fn((table: unknown) => {
						if (table === project) {
							return {
								values: vi.fn((values: unknown) => {
									mockState.insertCalls.push(values);
									return {
										returning: vi.fn(async () => [{ id: "created-project-1" }]),
									};
								}),
							};
						}

						return {
							values: vi.fn(async (values: unknown) => {
								if (mockState.transactionProjectManagerShouldFail) {
									throw new Error("project-manager-insert-failed");
								}

								mockState.insertCalls.push(values);
								return undefined;
							}),
						};
					}),
				};

				return await callback(tx);
			}),
		},
	};
});

vi.mock("@/lib/effect/runtime", async () => {
	const { runtimeModuleOver } = await import("@/test/effect-runtime");
	const { organizationActionStubLayer } = await import("@/test/organization-action");
	const { db } = await import("@/db");
	return runtimeModuleOver(organizationActionStubLayer(() => mockState.caller, { db }));
});

const {
	addProjectAssignment,
	addProjectManager,
	archiveProject,
	createProject,
	getEmployeesForSelection,
	getProjects,
	getTeamsForSelection,
	removeProjectAssignment,
	removeProjectManager,
	updateProject,
} = await import("./actions");

const scopedManager: StubCaller = {
	userId: "user-1",
	activeOrganizationId: "org-1",
	membershipRole: "member",
	employee: { id: "employee-1", role: "manager", former: false },
};
const orgMember: StubCaller = {
	...scopedManager,
	employee: { id: "employee-1", role: "employee", former: false },
};
const owner: StubCaller = { ...scopedManager, membershipRole: "owner", employee: null };
const workforceAdmin: StubCaller = {
	...scopedManager,
	employee: { id: "employee-workforce-admin", role: "admin", former: false },
};

describe("project settings manager scope", () => {
	beforeEach(() => {
		mockState.caller = scopedManager;
		mockState.projectRows = [
			{
				id: "project-1",
				organizationId: "org-1",
				name: "Managed Project",
				description: null,
				status: "active",
				icon: null,
				color: null,
				budgetHours: null,
				deadline: null,
				customerId: null,
				customer: null,
				isActive: true,
				createdAt: new Date("2026-01-01T00:00:00.000Z"),
				createdBy: "user-1",
				updatedAt: new Date("2026-01-01T00:00:00.000Z"),
				updatedBy: null,
			},
			{
				id: "project-2",
				organizationId: "org-1",
				name: "Unmanaged Project",
				description: null,
				status: "planned",
				icon: null,
				color: null,
				budgetHours: null,
				deadline: null,
				customerId: null,
				customer: null,
				isActive: true,
				createdAt: new Date("2026-01-02T00:00:00.000Z"),
				createdBy: "user-1",
				updatedAt: new Date("2026-01-02T00:00:00.000Z"),
				updatedBy: null,
			},
		];
		mockState.projectManagers = [
			{
				id: "pm-1",
				projectId: "project-1",
				employeeId: "employee-1",
				employee: { organizationId: "org-1", user: { name: "Manager" } },
			},
		];
		mockState.projectAssignments = [];
		mockState.hoursBooked = [];
		mockState.projectQueue = [];
		mockState.customerQueue = [];
		mockState.updateWhereArgs = [];
		mockState.insertCalls = [];
		mockState.transactionProjectManagerShouldFail = false;
		mockState.transactionCalls = 0;
	});

	it("shows managers only their managed projects", async () => {
		const result = await getProjects();

		expect(result).toEqual({
			success: true,
			data: [expect.objectContaining({ id: "project-1", name: "Managed Project" })],
		});
	});

	it("lets managers update projects inside managed scope", async () => {
		mockState.projectQueue = [
			{
				id: "project-1",
				organizationId: "org-1",
				name: "Managed Project",
				customerId: null,
			},
		];

		const result = await updateProject({ projectId: "project-1", name: "Managed Project Updated" });

		expect(result).toEqual({ success: true, data: undefined });
		expect(mockState.updateWhereArgs).toHaveLength(1);
	});

	it("reads another organization's project as not found", async () => {
		mockState.projectQueue = [null];

		const result = await updateProject({ projectId: "project-elsewhere", name: "Taken over" });

		expect(result).toMatchObject({ success: false, code: "NotFoundError" });
		expect(mockState.updateWhereArgs).toHaveLength(0);
	});

	it("lets managers create projects and scopes them by assigning themselves as manager", async () => {
		const result = await createProject({ name: "New Managed Project" });

		expect(result).toEqual({ success: true, data: { id: "created-project-1" } });
		// One insert may carry several rows.
		const managerAssignmentInserts = mockState.insertCalls
			.flat()
			.filter(
				(value) =>
					value &&
					typeof value === "object" &&
					"projectId" in (value as Record<string, unknown>) &&
					"employeeId" in (value as Record<string, unknown>),
			);

		expect(managerAssignmentInserts).toEqual([
			expect.objectContaining({
				projectId: "created-project-1",
				employeeId: "employee-1",
			}),
		]);
		expect(mockState.transactionCalls).toBe(1);
	});

	it("does not leave a created project behind when manager assignment fails", async () => {
		mockState.transactionProjectManagerShouldFail = true;

		const result = await createProject({ name: "Broken Managed Project" });

		expect(result).toMatchObject({ success: false });
		expect(mockState.transactionCalls).toBe(1);
	});

	it("rejects managers when attaching an unmanaged customer to a managed project", async () => {
		mockState.projectQueue = [
			{
				id: "project-1",
				organizationId: "org-1",
				name: "Managed Project",
				customerId: null,
			},
		];
		mockState.customerQueue = [{ id: "customer-2", organizationId: "org-1", isActive: true }];
		mockState.projectRows = [
			{ id: "project-2", organizationId: "org-1", customerId: "customer-2", isActive: true },
		];

		const result = await updateProject({ projectId: "project-1", customerId: "customer-2" });

		expect(result).toEqual({
			success: false,
			error: "You do not have access to assign this customer",
			code: "AuthorizationError",
		});
	});

	it("keeps owner membership parity with org admins for project reads", async () => {
		mockState.caller = owner;

		const result = await getProjects();

		expect(result).toEqual({
			success: true,
			data: expect.arrayContaining([
				expect.objectContaining({ id: "project-1" }),
				expect.objectContaining({ id: "project-2" }),
			]),
		});
	});

	it("shows a workforce admin every project of the organization", async () => {
		mockState.caller = workforceAdmin;

		const result = await getProjects();

		expect(result).toEqual({
			success: true,
			data: [
				expect.objectContaining({ id: "project-1" }),
				expect.objectContaining({ id: "project-2" }),
			],
		});
	});

	it("lets a workforce admin update a project they do not manage", async () => {
		mockState.caller = workforceAdmin;
		mockState.projectQueue = [
			{ id: "project-2", organizationId: "org-1", name: "Unmanaged Project", customerId: null },
		];

		const result = await updateProject({ projectId: "project-2", name: "Renamed" });

		expect(result).toEqual({ success: true, data: undefined });
		expect(mockState.updateWhereArgs).toHaveLength(1);
	});

	it("lets a workforce admin attach any customer of the organization", async () => {
		mockState.caller = workforceAdmin;
		mockState.projectQueue = [
			{ id: "project-1", organizationId: "org-1", name: "Managed Project", customerId: null },
		];
		mockState.customerQueue = [{ id: "customer-2", organizationId: "org-1", isActive: true }];
		mockState.projectRows = [
			{ id: "project-2", organizationId: "org-1", customerId: "customer-2", isActive: true },
		];

		const result = await updateProject({ projectId: "project-1", customerId: "customer-2" });

		expect(result).toEqual({ success: true, data: undefined });
	});

	it("does not make a workforce admin the manager of a project they create", async () => {
		mockState.caller = workforceAdmin;

		const result = await createProject({ name: "Organization Project" });

		expect(result).toEqual({ success: true, data: { id: "created-project-1" } });
		const managerAssignmentInserts = mockState.insertCalls
			.flat()
			.filter(
				(value) =>
					value &&
					typeof value === "object" &&
					"projectId" in (value as Record<string, unknown>) &&
					"employeeId" in (value as Record<string, unknown>),
			);
		expect(managerAssignmentInserts).toEqual([]);
	});

	it("refuses a task requirement that is not a boolean", async () => {
		const result = await createProject({ name: "Odd", requiresTask: "yes" as never });

		expect(result).toMatchObject({ success: false, code: "ValidationError" });
		expect(mockState.transactionCalls).toBe(0);
	});
});

describe("project settings access levels", () => {
	beforeEach(() => {
		mockState.projectQueue = [];
		mockState.transactionCalls = 0;
	});

	it.each([
		["getProjects", () => getProjects()],
		["createProject", () => createProject({ name: "New" })],
		["updateProject", () => updateProject({ projectId: "project-1", name: "Renamed" })],
		["archiveProject", () => archiveProject({ projectId: "project-1" })],
		[
			"addProjectAssignment",
			() => addProjectAssignment({ projectId: "project-1", type: "team", targetId: "team-1" }),
		],
		["removeProjectAssignment", () => removeProjectAssignment({ assignmentId: "assignment-1" })],
		["getTeamsForSelection", () => getTeamsForSelection()],
		["getEmployeesForSelection", () => getEmployeesForSelection()],
	])("refuses %s to an org member", async (_name, call) => {
		mockState.caller = orgMember;

		await expect(call()).resolves.toMatchObject({ success: false, code: "AuthorizationError" });
		expect(mockState.transactionCalls).toBe(0);
	});

	it.each([
		[
			"addProjectManager",
			() => addProjectManager({ projectId: "project-1", employeeId: "employee-2" }),
		],
		[
			"removeProjectManager",
			() => removeProjectManager({ projectId: "project-1", employeeId: "employee-2" }),
		],
	])("refuses %s to a scoped manager", async (_name, call) => {
		mockState.caller = scopedManager;

		await expect(call()).resolves.toMatchObject({ success: false, code: "AuthorizationError" });
	});
});
