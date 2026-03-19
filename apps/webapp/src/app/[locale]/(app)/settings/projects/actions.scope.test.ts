import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
	actorSession: {
		user: { id: "user-1", email: "manager@example.com", name: "Manager" },
		session: { activeOrganizationId: "org-1" },
	},
	employeeRecord: {
		id: "employee-1",
		userId: "user-1",
		organizationId: "org-1",
		role: "manager" as const,
		isActive: true,
	},
	membershipRecord: { role: "member" as const },
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

vi.mock("drizzle-orm", () => ({
	and: vi.fn((...args: unknown[]) => ({ and: args })),
	desc: vi.fn((value: unknown) => value),
	eq: vi.fn((left: unknown, right: unknown) => ({ eq: [left, right] })),
	inArray: vi.fn((left: unknown, right: unknown[]) => ({ inArray: [left, right] })),
	sql: vi.fn((strings: TemplateStringsArray) => strings.join("")),
}));

vi.mock("@/db/schema", () => ({
	customer: { id: "id", organizationId: "organizationId", isActive: "isActive" },
	employee: {
		id: "id",
		userId: "userId",
		organizationId: "organizationId",
		isActive: "isActive",
		role: "role",
	},
	project: {
		id: "id",
		organizationId: "organizationId",
		name: "name",
		createdAt: "createdAt",
		$inferInsert: {},
	},
	projectAssignment: { id: "id", projectId: "projectId", employeeId: "employeeId", teamId: "teamId" },
	projectManager: { id: "id", projectId: "projectId", employeeId: "employeeId" },
	projectNotificationState: { projectId: "projectId" },
	team: { id: "id", organizationId: "organizationId", name: "name" },
	workPeriod: { projectId: "projectId", durationMinutes: "durationMinutes" },
}));

vi.mock("@/db/auth-schema", () => ({
	member: { userId: "userId", organizationId: "organizationId", role: "role" },
}));

vi.mock("@/lib/audit-logger", () => ({
	AuditAction: {
		PROJECT_CREATED: "PROJECT_CREATED",
		PROJECT_UPDATED: "PROJECT_UPDATED",
	},
	logAudit: vi.fn(async () => undefined),
}));

vi.mock("@/lib/logger", () => ({
	logger: {
		error: vi.fn(),
	},
}));

vi.mock("@opentelemetry/api", () => ({
	SpanStatusCode: { OK: "OK", ERROR: "ERROR" },
	trace: {
		getTracer: () => ({
			startActiveSpan: (_name: string, ...args: any[]) => {
				const callback = args[args.length - 1];
				return callback({
					setStatus: vi.fn(),
					recordException: vi.fn(),
					end: vi.fn(),
				});
			},
		}),
	},
}));

vi.mock("@/lib/effect/services/auth.service", async () => {
	const { Context, Effect, Layer } = await import("effect");
	const AuthService = Context.GenericTag<any>("AuthService");
	const AuthServiceLive = Layer.succeed(AuthService, {
		getSession: () => Effect.succeed(mockState.actorSession),
	});
	return { AuthService, AuthServiceLive };
});

vi.mock("@/lib/effect/services/database.service", async () => {
	const { Context, Effect, Layer } = await import("effect");
	const DatabaseService = Context.GenericTag<any>("DatabaseService");
	const DatabaseServiceLive = Layer.succeed(DatabaseService, {
		query: (_name: string, fn: () => Promise<unknown>) => Effect.promise(fn),
	});
	return { DatabaseService, DatabaseServiceLive };
});

vi.mock("@/db", () => ({
	db: {
		query: {
			employee: {
				findFirst: vi.fn(async () => mockState.employeeRecord),
			},
			member: {
				findFirst: vi.fn(async () => mockState.membershipRecord),
			},
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
				where: vi.fn(() => ({
					groupBy: vi.fn(async () => mockState.hoursBooked),
				})),
			})),
		})),
		update: vi.fn(() => ({
			set: vi.fn(() => ({
				where: vi.fn(async (whereArg: unknown) => {
					mockState.updateWhereArgs.push(whereArg);
					return undefined;
				}),
			})),
		})),
		insert: vi.fn(() => ({
			values: vi.fn((values: unknown) => {
				mockState.insertCalls.push(values);
				return {
					returning: vi.fn(async () => [{ id: "created-project-1" }]),
				};
			}),
		})),
		transaction: vi.fn(async (callback: (tx: any) => Promise<unknown>) => {
			mockState.transactionCalls += 1;
			const tx = {
				insert: vi.fn((table: any) => {
					if (table?.name === "name") {
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
							if (table?.employeeId === "employeeId" && mockState.transactionProjectManagerShouldFail) {
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
}));

const { createProject, getProjects, updateProject } = await import("./actions");

describe("project settings manager scope", () => {
	beforeEach(() => {
		mockState.actorSession = {
			user: { id: "user-1", email: "manager@example.com", name: "Manager" },
			session: { activeOrganizationId: "org-1" },
		};
		mockState.employeeRecord = {
			id: "employee-1",
			userId: "user-1",
			organizationId: "org-1",
			role: "manager",
			isActive: true,
		};
		mockState.membershipRecord = { role: "member" };
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
				employee: { user: { name: "Manager" } },
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
		const result = await getProjects("org-1");

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

		const result = await updateProject("project-1", { name: "Managed Project Updated" });

		expect(result).toEqual({ success: true, data: undefined });
		expect(mockState.updateWhereArgs).toHaveLength(1);
	});

	it("lets managers create projects and scopes them by assigning themselves as manager", async () => {
		const result = await createProject({
			organizationId: "org-1",
			name: "New Managed Project",
		});

		expect(result).toEqual({ success: true, data: { id: "created-project-1" } });
		const managerAssignmentInserts = mockState.insertCalls.filter(
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

		const result = await createProject({
			organizationId: "org-1",
			name: "Broken Managed Project",
		});

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

		const result = await updateProject("project-1", { customerId: "customer-2" });

		expect(result).toMatchObject({ success: false });
	});

	it("keeps owner membership parity with org admins for project reads", async () => {
		mockState.membershipRecord = { role: "owner" };
		mockState.employeeRecord = null;

		const result = await getProjects("org-1");

		expect(result).toEqual({
			success: true,
			data: expect.arrayContaining([
				expect.objectContaining({ id: "project-1" }),
				expect.objectContaining({ id: "project-2" }),
			]),
		});
	});
});
