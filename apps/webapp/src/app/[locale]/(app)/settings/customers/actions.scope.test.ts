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
	projectManagers: [] as Array<any>,
	customerRows: [] as Array<any>,
	projectRows: [] as Array<any>,
	projectQueue: [] as Array<any>,
	customerQueue: [] as Array<any>,
	updateWhereArgs: [] as Array<any>,
	insertValues: [] as Array<any>,
	deleteWhereArgs: [] as Array<any>,
	transactionProjectUpdateShouldFail: false,
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
}));

vi.mock("@/db/schema", () => ({
	customer: {
		id: "id",
		organizationId: "organizationId",
		isActive: "isActive",
		name: "name",
		$inferInsert: {},
	},
	employee: {
		id: "id",
		userId: "userId",
		organizationId: "organizationId",
		isActive: "isActive",
		role: "role",
	},
	project: { id: "id", organizationId: "organizationId", customerId: "customerId", isActive: "isActive" },
	projectManager: { id: "id", projectId: "projectId", employeeId: "employeeId" },
}));

vi.mock("@/db/auth-schema", () => ({
	member: { userId: "userId", organizationId: "organizationId", role: "role" },
}));

vi.mock("@/lib/audit-logger", () => ({
	AuditAction: {
		CUSTOMER_CREATED: "CUSTOMER_CREATED",
		CUSTOMER_UPDATED: "CUSTOMER_UPDATED",
		CUSTOMER_DELETED: "CUSTOMER_DELETED",
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
			customer: {
				findMany: vi.fn(async () => mockState.customerRows),
				findFirst: vi.fn(async () => mockState.customerQueue.shift() ?? null),
			},
			project: {
				findMany: vi.fn(async () => mockState.projectRows),
				findFirst: vi.fn(async () => mockState.projectQueue.shift() ?? null),
			},
			projectManager: {
				findMany: vi.fn(async () => mockState.projectManagers),
				findFirst: vi.fn(async () => null),
			},
		},
		insert: vi.fn(() => ({
			values: vi.fn((values: unknown) => {
				mockState.insertValues.push(values);
				return {
					returning: vi.fn(async () => [{ id: "customer-3" }]),
				};
			}),
		})),
		update: vi.fn(() => ({
			set: vi.fn((values: unknown) => ({
				where: vi.fn(async (whereArg: unknown) => {
					mockState.insertValues.push(values);
					mockState.updateWhereArgs.push(whereArg);
					return undefined;
				}),
			})),
		})),
		delete: vi.fn(() => ({
			where: vi.fn(async (whereArg: unknown) => {
				mockState.deleteWhereArgs.push(whereArg);
				return undefined;
			}),
		})),
		transaction: vi.fn(async (callback: (tx: any) => Promise<unknown>) => {
			mockState.transactionCalls += 1;
			const tx = {
				insert: vi.fn((table: any) => {
					if (table?.name === "name") {
						return {
							values: vi.fn((values: unknown) => {
								mockState.insertValues.push(values);
								return {
									returning: vi.fn(async () => [{ id: "customer-3" }]),
								};
							}),
						};
					}

					return {
						values: vi.fn(async (values: unknown) => {
							mockState.insertValues.push(values);
							return undefined;
						}),
					};
				}),
				update: vi.fn(() => ({
					set: vi.fn((values: unknown) => ({
						where: vi.fn(async (whereArg: unknown) => {
							if (mockState.transactionProjectUpdateShouldFail) {
								throw new Error("project-update-failed");
							}
							mockState.insertValues.push(values);
							mockState.updateWhereArgs.push(whereArg);
							return undefined;
						}),
					})),
				})),
				delete: vi.fn(() => ({
					where: vi.fn(async (whereArg: unknown) => {
						mockState.deleteWhereArgs.push(whereArg);
						return undefined;
					}),
				})),
			};

			return await callback(tx);
		}),
	},
}));

const { createCustomer, getCustomers, getCustomersForSelection, updateCustomer } = await import("./actions");

describe("customer settings manager scope", () => {
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
		mockState.projectManagers = [{ id: "pm-1", projectId: "project-1", employeeId: "employee-1" }];
		mockState.customerRows = [
			{ id: "customer-1", organizationId: "org-1", name: "Managed Customer", isActive: true },
			{ id: "customer-2", organizationId: "org-1", name: "Other Customer", isActive: true },
		];
		mockState.projectRows = [
			{ id: "project-1", organizationId: "org-1", customerId: "customer-1", isActive: true },
		];
		mockState.projectQueue = [];
		mockState.customerQueue = [];
		mockState.updateWhereArgs = [];
		mockState.insertValues = [];
		mockState.deleteWhereArgs = [];
		mockState.transactionProjectUpdateShouldFail = false;
		mockState.transactionCalls = 0;
	});

	it("shows managers only customers attached to managed projects", async () => {
		const result = await getCustomers("org-1");

		expect(result).toEqual({
			success: true,
			data: [expect.objectContaining({ id: "customer-1", name: "Managed Customer" })],
		});
	});

	it("shows managers only scoped customers in project customer selection", async () => {
		const result = await getCustomersForSelection("org-1");

		expect(result).toEqual({
			success: true,
			data: [expect.objectContaining({ id: "customer-1", name: "Managed Customer" })],
		});
	});

	it("lets managers create a customer only when it is immediately tied to a managed project", async () => {
		mockState.projectQueue = [
			{ id: "project-1", organizationId: "org-1", customerId: null, isActive: true },
		];

		const result = await createCustomer({
			organizationId: "org-1",
			name: "Scoped Customer",
			projectId: "project-1",
		} as any);

		expect(result).toEqual({ success: true, data: { id: "customer-3" } });
		expect(mockState.updateWhereArgs).toHaveLength(1);
		expect(mockState.transactionCalls).toBe(1);
	});

	it("validates org-admin project ids before attaching new customers", async () => {
		mockState.membershipRecord = { role: "owner" };
		mockState.employeeRecord = null;
		mockState.projectQueue = [null];

		const result = await createCustomer({
			organizationId: "org-1",
			name: "Owner Customer",
			projectId: "project-outside-org",
		} as any);

		expect(result).toMatchObject({ success: false });
	});

	it("does not leave a customer behind when project attachment fails", async () => {
		mockState.projectQueue = [
			{ id: "project-1", organizationId: "org-1", customerId: null, isActive: true },
		];
		mockState.transactionProjectUpdateShouldFail = true;

		const result = await createCustomer({
			organizationId: "org-1",
			name: "Scoped Customer",
			projectId: "project-1",
		} as any);

		expect(result).toMatchObject({ success: false });
		expect(mockState.transactionCalls).toBe(1);
	});

	it("keeps owner membership parity with org admins for customer reads", async () => {
		mockState.membershipRecord = { role: "owner" };
		mockState.employeeRecord = null;

		const result = await getCustomers("org-1");

		expect(result).toEqual({
			success: true,
			data: expect.arrayContaining([
				expect.objectContaining({ id: "customer-1" }),
				expect.objectContaining({ id: "customer-2" }),
			]),
		});
	});

	it("rejects manager customer updates that would touch unmanaged project scope", async () => {
		mockState.projectRows = [
			{ id: "project-2", organizationId: "org-1", customerId: "customer-2", isActive: true },
		];
		mockState.customerQueue = [
			{ id: "customer-2", organizationId: "org-1", name: "Other Customer", isActive: true },
		];

		const result = await updateCustomer("customer-2", { name: "Changed" });

		expect(result).toMatchObject({ success: false });
	});
});
