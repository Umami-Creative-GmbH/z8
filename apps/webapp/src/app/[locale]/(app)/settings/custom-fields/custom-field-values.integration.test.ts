/**
 * #818: custom field values through the real settings server actions on
 * PostgreSQL: the employee detail save, the project and customer dialogs, the
 * custom fields section read, the own-profile read and the lists.
 *
 * Only the request/session, SSO proof, billing, notification delivery, the
 * fire-and-forget audit sink, the logger and the Next cache are replaced. Value
 * audit entries are written in the save transaction and read from the database.
 */

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { integrationAdminPool } from "@/test/integration-database";

const { sessions } = await vi.hoisted(async () => {
	const { AsyncLocalStorage } = await import("node:async_hooks");
	return {
		sessions: new AsyncLocalStorage<{ userId: string; organizationId: string }>(),
	};
});

vi.mock("next/server", async (importOriginal) =>
	(await import("@/test/integration-harness")).nextServer(importOriginal),
);
vi.mock("next/headers", async () => (await import("@/test/integration-harness")).nextHeaders());
vi.mock("next/cache", async (importOriginal) =>
	(await import("@/test/integration-harness")).nextCache(importOriginal),
);

vi.mock("@/lib/auth", () => ({
	auth: {
		api: {
			getSession: async () => {
				const current = sessions.getStore();
				return current
					? {
							user: { id: current.userId, role: "user" },
							session: {
								id: `t818-session-${current.userId}`,
								userId: current.userId,
								activeOrganizationId: current.organizationId,
							},
						}
					: null;
			},
		},
	},
}));

vi.mock("@/lib/enterprise-identity/session-sso-store", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/enterprise-identity/session-sso-store")>()),
	canAccessOrganizationWithSso: async () => true,
}));

vi.mock("@/lib/billing/guard", async () =>
	(await import("@/test/integration-harness")).billingGuard(),
);

vi.mock("@/lib/notifications/triggers", async (importOriginal) =>
	(await import("@/test/integration-harness")).notificationTriggers(importOriginal),
);

vi.mock("@/tolgee/server", async () => ({
	getTranslate: async () =>
		(await import("@/lib/organization/custom-fields/refusal-messages")).englishDefaults,
}));

vi.mock("@/lib/audit-logger", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/audit-logger")>()),
	logAudit: vi.fn(async () => undefined),
}));

vi.mock("@/lib/logger", async (importOriginal) => {
	const original = await importOriginal<typeof import("@/lib/logger")>();
	const quiet = { error: () => {}, warn: () => {}, info: () => {}, debug: () => {} };
	return {
		...original,
		logger: { ...original.logger, ...quiet },
		createLogger: () => ({ ...original.logger, ...quiet }),
	};
});

const { getCustomFieldSection, getOwnCustomFieldValues } = await import("./value-actions");
const { updateEmployee, listEmployees } = await import("../employees/actions");
const { archiveProject, createProject, updateProject, getProjects } = await import(
	"../projects/actions"
);
const { createProjectFromTemplate } = await import("../projects/from-template-actions");
const { createCustomer, updateCustomer, getCustomers } = await import("../customers/actions");
const { db } = await import("@/db");
const { changeCustomFields } = await import("@/lib/organization/custom-fields/definitions");

const ids = {
	organization: "t818-org",
	other: "t818-other-org",
	ownerUser: "t818-owner",
	managerUser: "t818-manager",
	employeeUser: "t818-employee",
	unmanagedUser: "t818-unmanaged",
	scimUser: "t818-scim",
	otherUser: "t818-other",
	owner: "e8180000-0000-4000-8000-000000000001",
	manager: "e8180000-0000-4000-8000-000000000002",
	employee: "e8180000-0000-4000-8000-000000000003",
	unmanaged: "e8180000-0000-4000-8000-000000000004",
	scim: "e8180000-0000-4000-8000-000000000005",
	otherEmployee: "e8180000-0000-4000-8000-000000000006",
	project: "e8180000-0000-4000-8000-000000000020",
	unmanagedProject: "e8180000-0000-4000-8000-000000000021",
	otherProject: "e8180000-0000-4000-8000-000000000022",
	customer: "e8180000-0000-4000-8000-000000000030",
	template: "e8180000-0000-4000-8000-000000000040",
} as const;
const users = [
	ids.ownerUser,
	ids.managerUser,
	ids.employeeUser,
	ids.unmanagedUser,
	ids.scimUser,
	ids.otherUser,
];

type Fields = Record<string, { id: string; options: { id: string; label: string }[] }>;

describe("custom field values in the settings actions on PostgreSQL", () => {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
	const admin = integrationAdminPool();
	let fields: Fields;

	function actAs<T>(userId: string, action: () => Promise<T>): Promise<T> {
		return sessions.run({ userId, organizationId: ids.organization }, action);
	}

	async function ok<T>(
		result: Promise<{ success: true; data: T } | { success: false; error: string }>,
	) {
		const settled = await result;
		if (!settled.success) throw new Error(`action failed: ${settled.error}`);
		return settled.data;
	}

	async function failure(result: Promise<{ success: boolean; error?: string; code?: string }>) {
		const settled = await result;
		return settled.success ? "accepted" : { error: settled.error, code: settled.code };
	}

	async function define(change: Record<string, unknown>) {
		const outcome = await changeCustomFields(db, {
			organizationId: ids.organization,
			actorUserId: ids.ownerUser,
			change: {
				kind: "create",
				type: "text",
				required: false,
				tracked: false,
				...change,
			},
		});
		if (!outcome.ok) throw new Error(`define refused: ${outcome.reason}`);
		const field = outcome.fields.find((f) => f.name === change.name && !f.archived);
		if (!field) throw new Error("field missing");
		return field;
	}

	async function cleanup() {
		await admin.query("delete from organization where id = any($1::text[])", [
			[ids.organization, ids.other],
		]);
		await admin.query('delete from "user" where id = any($1::text[])', [users]);
	}

	beforeEach(async () => {
		await cleanup();
		const timestamp = new Date("2026-10-01T08:00:00Z");
		await admin.query(
			`insert into organization (id, name, slug, timezone, created_at) values
			 ($1, 'T818', $1, 'Europe/Berlin', $3), ($2, 'T818 other', $2, 'UTC', $3)`,
			[ids.organization, ids.other, timestamp],
		);
		await admin.query(
			`insert into "user" (id, name, email, created_at, updated_at)
			 select user_id, user_id, user_id || '@example.test', $2, $2 from unnest($1::text[]) as user_id`,
			[users, timestamp],
		);
		const members: [string, string, string][] = [
			[ids.organization, ids.ownerUser, "owner"],
			[ids.organization, ids.managerUser, "member"],
			[ids.organization, ids.employeeUser, "member"],
			[ids.organization, ids.unmanagedUser, "member"],
			[ids.organization, ids.scimUser, "member"],
			[ids.other, ids.otherUser, "owner"],
		];
		for (const [organizationId, userId, role] of members) {
			await admin.query(
				`insert into member (id, organization_id, user_id, role, status, created_at)
				 values ($1, $2, $3, $4, 'approved', $5)`,
				[`m-${userId}`, organizationId, userId, role, timestamp],
			);
		}
		const employees: [string, string, string, string][] = [
			[ids.owner, ids.ownerUser, ids.organization, "admin"],
			[ids.manager, ids.managerUser, ids.organization, "manager"],
			[ids.employee, ids.employeeUser, ids.organization, "employee"],
			[ids.unmanaged, ids.unmanagedUser, ids.organization, "employee"],
			[ids.scim, ids.scimUser, ids.organization, "employee"],
			[ids.otherEmployee, ids.otherUser, ids.other, "admin"],
		];
		for (const [id, userId, organizationId, role] of employees) {
			await admin.query(
				`insert into employee (id, user_id, organization_id, first_name, last_name, role, is_active, updated_at)
				 values ($1, $2, $3, $2, 'T818', $4, true, $5)`,
				[id, userId, organizationId, role, timestamp],
			);
		}
		await admin.query(
			`insert into employee_managers (employee_id, manager_id, is_primary, assigned_by)
			 values ($1, $2, true, $3)`,
			[ids.employee, ids.manager, ids.ownerUser],
		);
		await admin.query(
			`insert into customer (id, organization_id, name, created_by, updated_at)
			 values ($1, $2, 'Acme', $3, $4)`,
			[ids.customer, ids.organization, ids.ownerUser, timestamp],
		);
		await admin.query(
			`insert into project (id, organization_id, name, customer_id, created_by, updated_at) values
			 ($1, $4, 'Bridge', $6, $5, $7),
			 ($2, $4, 'Tunnel', null, $5, $7),
			 ($3, $8, 'Elsewhere', null, $9, $7)`,
			[
				ids.project,
				ids.unmanagedProject,
				ids.otherProject,
				ids.organization,
				ids.ownerUser,
				ids.customer,
				timestamp,
				ids.other,
				ids.otherUser,
			],
		);
		await admin.query(
			`insert into project_manager (project_id, employee_id, assigned_by) values ($1, $2, $3)`,
			[ids.project, ids.manager, ids.ownerUser],
		);
		await admin.query(
			`insert into project_template (id, organization_id, name, created_by, updated_at)
			 values ($1, $2, 'Standard', $3, $4)`,
			[ids.template, ids.organization, ids.ownerUser, timestamp],
		);

		fields = {
			payrollId: await define({
				entity: "employee",
				name: "Payroll id",
				required: true,
				visibility: "admin",
				editLevel: "admin",
			}),
			desk: await define({
				entity: "employee",
				name: "Desk",
				visibility: "manager",
				editLevel: "manager",
			}),
			shirt: await define({
				entity: "employee",
				name: "Shirt size",
				type: "select",
				options: ["S", "M"],
				visibility: "employee",
				editLevel: "manager",
			}),
			badge: await define({
				entity: "employee",
				name: "Badge",
				type: "boolean",
				visibility: "employee",
				editLevel: "admin",
			}),
			po: await define({
				entity: "project",
				name: "PO number",
				required: true,
				visibility: "manager",
				editLevel: "manager",
			}),
			budgetCode: await define({
				entity: "project",
				name: "Budget code",
				type: "number",
				number: { integerOnly: true, min: "1", max: "9999" },
				visibility: "admin",
				editLevel: "admin",
			}),
			customerNo: await define({
				entity: "customer",
				name: "Customer number",
				required: true,
				visibility: "manager",
				editLevel: "manager",
			}),
			startedOn: await define({
				entity: "customer",
				name: "Customer since",
				type: "date",
				visibility: "manager",
				editLevel: "admin",
			}),
		};
	});

	afterAll(cleanup);

	const section = (entity: "employee" | "project" | "customer", recordId: string | null) =>
		getCustomFieldSection({ entity, recordId });

	describe("org admins", () => {
		it("set, change and clear values on an employee through the detail save", async () => {
			const [small, medium] = fields.shirt.options;
			await actAs(ids.ownerUser, () =>
				ok(
					updateEmployee(
						ids.employee,
						{ position: "Engineer" },
						{
							[fields.payrollId.id]: "P-100",
							[fields.desk.id]: "4.12",
							[fields.shirt.id]: small.id,
							[fields.badge.id]: true,
						},
					),
				),
			);
			let read = await actAs(ids.ownerUser, () => ok(section("employee", ids.employee)));
			expect(read.fields.map((f) => [f.name, f.editable])).toEqual([
				["Payroll id", true],
				["Desk", true],
				["Shirt size", true],
				["Badge", true],
			]);
			expect(read.values).toEqual({
				[fields.payrollId.id]: { type: "text", value: "P-100" },
				[fields.desk.id]: { type: "text", value: "4.12" },
				[fields.shirt.id]: { type: "select", value: small.id },
				[fields.badge.id]: { type: "boolean", value: true },
			});
			expect(read.missingRequiredFieldIds).toEqual([]);

			await actAs(ids.ownerUser, () =>
				ok(
					updateEmployee(
						ids.employee,
						{},
						{
							[fields.desk.id]: null,
							[fields.shirt.id]: medium.id,
							[fields.badge.id]: false,
						},
					),
				),
			);
			read = await actAs(ids.ownerUser, () => ok(section("employee", ids.employee)));
			expect(read.values).toEqual({
				[fields.payrollId.id]: { type: "text", value: "P-100" },
				[fields.shirt.id]: { type: "select", value: medium.id },
				[fields.badge.id]: { type: "boolean", value: false },
			});

			const { rows } = await admin.query<{ action: string; entity_id: string }>(
				`select action, entity_id from audit_log
				 where organization_id = $1 and action like 'custom_field_value.%' order by action`,
				[ids.organization],
			);
			expect(rows.map((row) => row.action)).toEqual([
				"custom_field_value.changed",
				"custom_field_value.changed",
				"custom_field_value.cleared",
				"custom_field_value.set",
				"custom_field_value.set",
				"custom_field_value.set",
				"custom_field_value.set",
			]);
			expect(new Set(rows.map((row) => row.entity_id))).toEqual(new Set([ids.employee]));
		});

		it("refuse an employee save with a missing required value and roll the save back", async () => {
			const result = await actAs(ids.ownerUser, () =>
				failure(updateEmployee(ids.employee, { position: "Lead" }, { [fields.desk.id]: "1" })),
			);
			expect(result).toEqual({
				error: 'Custom field "Payroll id": This field is required.',
				code: "ValidationError",
			});
			const { rows } = await admin.query<{ position: string | null }>(
				"select position from employee where id = $1",
				[ids.employee],
			);
			expect(rows[0].position).toBeNull();
			const read = await actAs(ids.ownerUser, () => ok(section("employee", ids.employee)));
			expect(read.values).toEqual({});
		});

		it("set values when creating and updating projects and customers", async () => {
			const created = await actAs(ids.ownerUser, () =>
				ok(
					createProject({
						organizationId: ids.organization,
						name: "Harbour",
						customFieldValues: { [fields.po.id]: "PO-7", [fields.budgetCode.id]: "42" },
					}),
				),
			);
			expect((await actAs(ids.ownerUser, () => ok(section("project", created.id)))).values).toEqual(
				{
					[fields.po.id]: { type: "text", value: "PO-7" },
					[fields.budgetCode.id]: { type: "number", value: "42" },
				},
			);
			await actAs(ids.ownerUser, () =>
				ok(updateProject(created.id, { customFieldValues: { [fields.budgetCode.id]: "" } })),
			);
			expect((await actAs(ids.ownerUser, () => ok(section("project", created.id)))).values).toEqual(
				{ [fields.po.id]: { type: "text", value: "PO-7" } },
			);

			const customer = await actAs(ids.ownerUser, () =>
				ok(
					createCustomer({
						organizationId: ids.organization,
						name: "Globex",
						customFieldValues: {
							[fields.customerNo.id]: "C-1",
							[fields.startedOn.id]: "2024-02-29",
						},
					}),
				),
			);
			await actAs(ids.ownerUser, () =>
				ok(updateCustomer(customer.id, { customFieldValues: { [fields.customerNo.id]: "C-2" } })),
			);
			expect(
				(await actAs(ids.ownerUser, () => ok(section("customer", customer.id)))).values,
			).toEqual({
				[fields.customerNo.id]: { type: "text", value: "C-2" },
				[fields.startedOn.id]: { type: "date", value: "2024-02-29" },
			});
		});

		it("keep a tracked field's history through the customer forms (#819)", async () => {
			const rateClass = await define({
				entity: "customer",
				name: "Rate class",
				tracked: true,
				required: true,
				visibility: "manager",
				editLevel: "manager",
			});
			const add = (validFrom: string, value: string) => ({ op: "add", validFrom, value });

			// A required tracked field whose only value starts in the future is missing today.
			expect(
				await actAs(ids.ownerUser, () =>
					failure(
						createCustomer({
							organizationId: ids.organization,
							name: "Future",
							customFieldValues: {
								[fields.customerNo.id]: "C-9",
								[rateClass.id]: { history: [add("2999-01-01", "R2")] },
							},
						}),
					),
				),
			).toEqual({ error: 'Custom field "Rate class": This field is required.', code: "ValidationError" });

			const customer = await actAs(ids.ownerUser, () =>
				ok(
					createCustomer({
						organizationId: ids.organization,
						name: "Globex",
						customFieldValues: {
							[fields.customerNo.id]: "C-1",
							[rateClass.id]: { history: [add("2020-01-01", "R1")] },
						},
					}),
				),
			);
			let read = await actAs(ids.ownerUser, () => ok(section("customer", customer.id)));
			expect(read.values[rateClass.id]).toEqual({ type: "text", value: "R1" });
			const [first] = read.history[rateClass.id];

			await actAs(ids.ownerUser, () =>
				ok(
					updateCustomer(customer.id, {
						customFieldValues: {
							[rateClass.id]: {
								history: [
									{ op: "correct", entryId: first.id, validFrom: "2020-01-01", value: "R0" },
									add("2999-01-01", "R2"),
								],
							},
						},
					}),
				),
			);
			read = await actAs(ids.ownerUser, () => ok(section("customer", customer.id)));
			expect(read.values[rateClass.id]).toEqual({ type: "text", value: "R0" });
			expect(read.history[rateClass.id].map((entry) => [entry.validFrom, entry.value])).toEqual([
				["2999-01-01", { type: "text", value: "R2" }],
				["2020-01-01", { type: "text", value: "R0" }],
			]);

			// Deleting the entry valid today leaves only a future one: the form refuses.
			expect(
				await actAs(ids.ownerUser, () =>
					failure(
						updateCustomer(customer.id, {
							customFieldValues: {
								[rateClass.id]: { history: [{ op: "delete", entryId: first.id }] },
							},
						}),
					),
				),
			).toEqual({ error: 'Custom field "Rate class": This field is required.', code: "ValidationError" });
			// A plain value for a tracked field is refused.
			expect(
				await actAs(ids.ownerUser, () =>
					failure(updateCustomer(customer.id, { customFieldValues: { [rateClass.id]: "R9" } })),
				),
			).toEqual({
				error: 'Custom field "Rate class": This field keeps a history. Add a dated change instead.',
				code: "ValidationError",
			});
		});

		it("refuse project and customer forms with missing required values or broken type rules", async () => {
			expect(
				await actAs(ids.ownerUser, () =>
					failure(
						createProject({
							organizationId: ids.organization,
							name: "Bare",
							customFieldValues: {},
						}),
					),
				),
			).toEqual({ error: 'Custom field "PO number": This field is required.', code: "ValidationError" });
			expect(
				await actAs(ids.ownerUser, () =>
					failure(
						createProjectFromTemplate({
							templateId: ids.template,
							name: "From template",
							customFieldValues: {},
						}),
					),
				),
			).toEqual({ error: 'Custom field "PO number": This field is required.', code: "ValidationError" });
			expect(
				await actAs(ids.ownerUser, () =>
					failure(
						createProject({
							organizationId: ids.organization,
							name: "Bad code",
							customFieldValues: { [fields.po.id]: "PO-1", [fields.budgetCode.id]: "1.5" },
						}),
					),
				),
			).toEqual({
				error: 'Custom field "Budget code": Enter a whole number.',
				code: "ValidationError",
			});
			expect(
				await actAs(ids.ownerUser, () =>
					failure(
						createCustomer({
							organizationId: ids.organization,
							name: "Initech",
							customFieldValues: { [fields.customerNo.id]: "" },
						}),
					),
				),
			).toEqual({ error: 'Custom field "Customer number": This field is required.', code: "ValidationError" });
			const { rows } = await admin.query(
				"select name from project where organization_id = $1 and name in ('Bare', 'From template', 'Bad code') union all select name from customer where name = 'Initech'",
				[ids.organization],
			);
			expect(rows).toEqual([]);

			// Paths other than the forms (archiving a project) are not held to required fields.
			expect(
				await actAs(ids.ownerUser, () => failure(archiveProject(ids.unmanagedProject))),
			).toBe("accepted");
			// A template creation with the required value goes through.
			const fromTemplate = await actAs(ids.ownerUser, () =>
				ok(
					createProjectFromTemplate({
						templateId: ids.template,
						name: "From template",
						customFieldValues: { [fields.po.id]: "PO-T" },
					}),
				),
			);
			expect(
				(await actAs(ids.ownerUser, () => ok(section("project", fromTemplate.id)))).values,
			).toEqual({ [fields.po.id]: { type: "text", value: "PO-T" } });
		});

		it("hold form saves without custom field values to the stored required values", async () => {
			const required = (name: string) => ({
				error: `Custom field "${name}": This field is required.`,
				code: "ValidationError",
			});
			// A client that sends no values (its section never loaded) can't skip required fields.
			expect(
				await actAs(ids.ownerUser, () =>
					failure(updateEmployee(ids.employee, { position: "Lead" })),
				),
			).toEqual(required("Payroll id"));
			expect(
				await actAs(ids.ownerUser, () =>
					failure(createProject({ organizationId: ids.organization, name: "No section" })),
				),
			).toEqual(required("PO number"));
			expect(
				await actAs(ids.ownerUser, () =>
					failure(createProjectFromTemplate({ templateId: ids.template, name: "No section" })),
				),
			).toEqual(required("PO number"));
			expect(
				await actAs(ids.ownerUser, () => failure(updateProject(ids.project, { name: "Renamed" }))),
			).toEqual(required("PO number"));
			expect(
				await actAs(ids.ownerUser, () =>
					failure(createCustomer({ organizationId: ids.organization, name: "No section" })),
				),
			).toEqual(required("Customer number"));
			expect(
				await actAs(ids.ownerUser, () =>
					failure(updateCustomer(ids.customer, { name: "Renamed" })),
				),
			).toEqual(required("Customer number"));
			const { rows } = await admin.query(
				`select name from project where organization_id = $1 and name in ('No section', 'Renamed')
				 union all select name from customer where organization_id = $1 and name in ('No section', 'Renamed')
				 union all select position from employee where id = $2 and position = 'Lead'`,
				[ids.organization, ids.employee],
			);
			expect(rows).toEqual([]);

			// With the stored values complete, the same saves go through.
			await actAs(ids.ownerUser, () =>
				ok(updateEmployee(ids.employee, {}, { [fields.payrollId.id]: "P-1" })),
			);
			await actAs(ids.ownerUser, () =>
				ok(updateProject(ids.project, { customFieldValues: { [fields.po.id]: "PO-1" } })),
			);
			await actAs(ids.ownerUser, () =>
				ok(updateCustomer(ids.customer, { customFieldValues: { [fields.customerNo.id]: "C-1" } })),
			);
			await actAs(ids.ownerUser, () => ok(updateEmployee(ids.employee, { position: "Lead" })));
			await actAs(ids.ownerUser, () => ok(updateProject(ids.project, { name: "Renamed" })));
			await actAs(ids.ownerUser, () => ok(updateCustomer(ids.customer, { name: "Renamed" })));
		});

		it("mark employees, projects and customers with missing required values in the lists", async () => {
			// An employee created by SCIM has no values and is saved anyway; it shows up as missing.
			const employees = await actAs(ids.ownerUser, () => ok(listEmployees({ status: "active" })));
			const flagged = Object.fromEntries(
				employees.employees.map((row) => [
					row.id,
					row.kind === "employee" ? row.missingRequiredCustomFields : undefined,
				]),
			);
			expect(flagged[ids.scim]).toBe(true);
			expect(
				(await actAs(ids.ownerUser, () => ok(section("employee", ids.scim))))
					.missingRequiredFieldIds,
			).toEqual([fields.payrollId.id]);

			await actAs(ids.ownerUser, () =>
				ok(updateEmployee(ids.scim, {}, { [fields.payrollId.id]: "P-9" })),
			);
			const after = await actAs(ids.ownerUser, () => ok(listEmployees({ status: "active" })));
			const scimRow = after.employees.find((row) => row.id === ids.scim);
			expect(scimRow?.kind === "employee" && scimRow.missingRequiredCustomFields).toBe(false);

			const projects = await actAs(ids.ownerUser, () => ok(getProjects(ids.organization)));
			expect(projects.find((p) => p.id === ids.project)?.missingRequiredCustomFields).toBe(true);
			const customers = await actAs(ids.ownerUser, () => ok(getCustomers(ids.organization)));
			expect(customers.find((c) => c.id === ids.customer)?.missingRequiredCustomFields).toBe(true);
		});
	});

	describe("managers", () => {
		it("see only fields visible to managers on employees they manage, and edit only manager fields", async () => {
			await actAs(ids.ownerUser, () =>
				ok(
					updateEmployee(
						ids.employee,
						{},
						{
							[fields.payrollId.id]: "P-SECRET",
							[fields.badge.id]: true,
						},
					),
				),
			);
			const read = await actAs(ids.managerUser, () => ok(section("employee", ids.employee)));
			expect(read.fields.map((f) => [f.name, f.editable])).toEqual([
				["Desk", true],
				["Shirt size", true],
				["Badge", false],
			]);
			expect(read.values).toEqual({ [fields.badge.id]: { type: "boolean", value: true } });
			expect(JSON.stringify(read)).not.toContain("P-SECRET");
			expect(read.missingRequiredFieldIds).toEqual([]);

			expect(
				await actAs(ids.managerUser, () => failure(section("employee", ids.unmanaged))),
			).toMatchObject({ code: "AuthorizationError" });

			// The admin-only required field doesn't block a manager's save.
			await actAs(ids.managerUser, () =>
				ok(updateEmployee(ids.employee, {}, { [fields.desk.id]: "7.01" })),
			);
			expect(
				await actAs(ids.managerUser, () =>
					failure(updateEmployee(ids.employee, {}, { [fields.payrollId.id]: "P-1" })),
				),
			).toEqual({
				error: "Custom field \"Payroll id\": You can't change this field.",
				code: "ValidationError",
			});
			expect(
				await actAs(ids.managerUser, () =>
					failure(updateEmployee(ids.employee, {}, { [fields.badge.id]: false })),
				),
			).toMatchObject({ code: "ValidationError" });
			expect(
				await actAs(ids.managerUser, () =>
					failure(updateEmployee(ids.unmanaged, {}, { [fields.desk.id]: "1" })),
				),
			).toMatchObject({ code: "AuthorizationError" });
			const { rows } = await admin.query<{ text_value: string }>(
				"select text_value from custom_field_value where employee_id = $1 and definition_id = $2",
				[ids.employee, fields.payrollId.id],
			);
			expect(rows).toEqual([{ text_value: "P-SECRET" }]);
		});

		it("see and edit manager fields on projects and customers they can see only", async () => {
			const read = await actAs(ids.managerUser, () => ok(section("project", ids.project)));
			expect(read.fields.map((f) => [f.name, f.editable])).toEqual([["PO number", true]]);
			expect(read.missingRequiredFieldIds).toEqual([fields.po.id]);

			await actAs(ids.managerUser, () =>
				ok(updateProject(ids.project, { customFieldValues: { [fields.po.id]: "PO-M" } })),
			);
			expect(
				await actAs(ids.managerUser, () =>
					failure(
						updateProject(ids.project, { customFieldValues: { [fields.budgetCode.id]: "5" } }),
					),
				),
			).toMatchObject({ code: "ValidationError" });
			expect(
				await actAs(ids.managerUser, () => failure(section("project", ids.unmanagedProject))),
			).toMatchObject({ code: "AuthorizationError" });
			expect(
				await actAs(ids.managerUser, () => failure(section("project", ids.otherProject))),
			).toMatchObject({ code: "AuthorizationError" });

			const customer = await actAs(ids.managerUser, () => ok(section("customer", ids.customer)));
			expect(customer.fields.map((f) => [f.name, f.editable])).toEqual([
				["Customer number", true],
				["Customer since", false],
			]);
			await actAs(ids.managerUser, () =>
				ok(updateCustomer(ids.customer, { customFieldValues: { [fields.customerNo.id]: "C-M" } })),
			);
			expect(
				await actAs(ids.managerUser, () =>
					failure(
						updateCustomer(ids.customer, {
							customFieldValues: { [fields.startedOn.id]: "2025-01-01" },
						}),
					),
				),
			).toMatchObject({ code: "ValidationError" });

			const projects = await actAs(ids.managerUser, () => ok(getProjects(ids.organization)));
			expect(projects.map((p) => [p.id, p.missingRequiredCustomFields])).toEqual([
				[ids.project, false],
			]);
		});
	});

	describe("employees", () => {
		it("see their own employee-visible values read-only, and nobody else's", async () => {
			const [small] = fields.shirt.options;
			await actAs(ids.ownerUser, () =>
				ok(
					updateEmployee(
						ids.employee,
						{},
						{
							[fields.payrollId.id]: "P-SECRET",
							[fields.desk.id]: "4.12",
							[fields.shirt.id]: small.id,
						},
					),
				),
			);
			const own = await actAs(ids.employeeUser, () => ok(getOwnCustomFieldValues()));
			expect(own.fields.map((f) => [f.name, f.editable])).toEqual([
				["Shirt size", false],
				["Badge", false],
			]);
			expect(own.values).toEqual({ [fields.shirt.id]: { type: "select", value: small.id } });
			expect(JSON.stringify(own)).not.toContain("P-SECRET");
			expect(JSON.stringify(own)).not.toContain("4.12");

			expect(
				await actAs(ids.employeeUser, () => failure(section("employee", ids.employee))),
			).toMatchObject({ code: "AuthorizationError" });
			expect(
				await actAs(ids.employeeUser, () => failure(section("employee", ids.unmanaged))),
			).toMatchObject({ code: "AuthorizationError" });
			expect(
				await actAs(ids.employeeUser, () =>
					failure(updateEmployee(ids.employee, {}, { [fields.shirt.id]: small.id })),
				),
			).toMatchObject({ code: "AuthorizationError" });
		});
	});
});
