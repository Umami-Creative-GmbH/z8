import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StubCaller } from "@/test/organization-action";

const mockState = vi.hoisted(() => ({
	caller: null as StubCaller | null,
	projectManagers: [] as Array<any>,
	customerRows: [] as Array<any>,
	projectRows: [] as Array<any>,
	projectQueue: [] as Array<any>,
	customerQueue: [] as Array<any>,
	updateWhereArgs: [] as Array<any>,
	insertValues: [] as Array<any>,
	transactionProjectUpdateShouldFail: false,
	transactionCalls: 0,
}));

vi.mock("next/cache", () => ({
	revalidatePath: vi.fn(),
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
		CUSTOMER_CREATED: "CUSTOMER_CREATED",
		CUSTOMER_UPDATED: "CUSTOMER_UPDATED",
		CUSTOMER_DELETED: "CUSTOMER_DELETED",
	},
	logAudit: vi.fn(async () => undefined),
}));

vi.mock("@/db", async () => {
	const { customer } = await import("@/db/schema");
	const update = () => ({
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
	});
	return {
		db: {
			query: {
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
			transaction: vi.fn(async (callback: (tx: any) => Promise<unknown>) => {
				mockState.transactionCalls += 1;
				const tx = {
					insert: vi.fn((table: unknown) => ({
						values: vi.fn((values: unknown) => {
							mockState.insertValues.push(values);
							return {
								returning: vi.fn(async () => (table === customer ? [{ id: "customer-3" }] : [])),
							};
						}),
					})),
					update: vi.fn(update),
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

const { createCustomer, deleteCustomer, getCustomers, getCustomersForSelection, updateCustomer } =
	await import("./actions");

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

describe("customer settings manager scope", () => {
	beforeEach(() => {
		mockState.caller = scopedManager;
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
		mockState.transactionProjectUpdateShouldFail = false;
		mockState.transactionCalls = 0;
	});

	it("shows managers only customers attached to managed projects", async () => {
		const result = await getCustomers();

		expect(result).toEqual({
			success: true,
			data: [expect.objectContaining({ id: "customer-1", name: "Managed Customer" })],
		});
	});

	it("shows managers only scoped customers in project customer selection", async () => {
		const result = await getCustomersForSelection();

		expect(result).toEqual({
			success: true,
			data: [expect.objectContaining({ id: "customer-1", name: "Managed Customer" })],
		});
	});

	it("lets managers create a customer only when it is immediately tied to a managed project", async () => {
		mockState.projectQueue = [
			{ id: "project-1", organizationId: "org-1", customerId: null, isActive: true },
		];

		const result = await createCustomer({ name: "Scoped Customer", projectId: "project-1" });

		expect(result).toEqual({ success: true, data: { id: "customer-3" } });
		expect(mockState.updateWhereArgs).toHaveLength(1);
		expect(mockState.transactionCalls).toBe(1);
	});

	it("refuses managers a customer that is not tied to a project", async () => {
		const result = await createCustomer({ name: "Loose Customer" });

		expect(result).toMatchObject({ success: false, code: "AuthorizationError" });
		expect(mockState.transactionCalls).toBe(0);
	});

	it("shows a workforce admin every customer and lets them create one without a project", async () => {
		mockState.caller = workforceAdmin;

		await expect(getCustomers()).resolves.toEqual({
			success: true,
			data: expect.arrayContaining([
				expect.objectContaining({ id: "customer-1" }),
				expect.objectContaining({ id: "customer-2" }),
			]),
		});
		await expect(createCustomer({ name: "Loose Customer" })).resolves.toMatchObject({
			success: true,
		});
	});

	it("reads another organization's project as not found when attaching a new customer", async () => {
		mockState.caller = owner;
		mockState.projectQueue = [null];

		const result = await createCustomer({
			name: "Owner Customer",
			projectId: "project-outside-org",
		});

		expect(result).toMatchObject({ success: false, code: "NotFoundError" });
		expect(mockState.transactionCalls).toBe(0);
	});

	it("does not leave a customer behind when project attachment fails", async () => {
		mockState.projectQueue = [
			{ id: "project-1", organizationId: "org-1", customerId: null, isActive: true },
		];
		mockState.transactionProjectUpdateShouldFail = true;

		const result = await createCustomer({ name: "Scoped Customer", projectId: "project-1" });

		expect(result).toMatchObject({ success: false });
		expect(mockState.transactionCalls).toBe(1);
	});

	it("keeps owner membership parity with org admins for customer reads", async () => {
		mockState.caller = owner;

		const result = await getCustomers();

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

		const result = await updateCustomer({ customerId: "customer-2", name: "Changed" });

		expect(result).toEqual({
			success: false,
			error: "You do not have access to update this customer",
			code: "AuthorizationError",
		});
	});

	it("reads another organization's customer as not found", async () => {
		mockState.caller = owner;
		mockState.customerQueue = [null];

		const result = await deleteCustomer({ customerId: "customer-elsewhere" });

		expect(result).toMatchObject({ success: false, code: "NotFoundError" });
		expect(mockState.transactionCalls).toBe(0);
	});
});

describe("customer settings access levels", () => {
	it.each([
		["getCustomers", () => getCustomers()],
		["getCustomersForSelection", () => getCustomersForSelection()],
		["createCustomer", () => createCustomer({ name: "New", projectId: "project-1" })],
		["updateCustomer", () => updateCustomer({ customerId: "customer-1", name: "Changed" })],
		["deleteCustomer", () => deleteCustomer({ customerId: "customer-1" })],
	])("refuses %s to an org member", async (_name, call) => {
		mockState.caller = orgMember;
		mockState.transactionCalls = 0;

		await expect(call()).resolves.toMatchObject({ success: false, code: "AuthorizationError" });
		expect(mockState.transactionCalls).toBe(0);
	});
});
