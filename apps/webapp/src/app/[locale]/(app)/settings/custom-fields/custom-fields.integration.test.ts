/**
 * #817: org admins define, order and archive custom fields, on PostgreSQL.
 *
 * The real server actions, definition store, constraints and audit trail run
 * against a disposable database. Only the request/session, SSO session store,
 * Next cache and logger are replaced.
 */

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { integrationAdminPool } from "@/test/integration-database";

const harness = vi.hoisted(() => ({
	userId: null as string | null,
	organizationId: null as string | null,
}));

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
			getSession: async () =>
				harness.userId
					? {
							user: { id: harness.userId, role: "user" },
							session: {
								id: `session-${harness.userId}`,
								userId: harness.userId,
								activeOrganizationId: harness.organizationId,
							},
						}
					: null,
		},
	},
}));

vi.mock("@/lib/enterprise-identity/session-sso-store", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/enterprise-identity/session-sso-store")>()),
	canAccessOrganizationWithSso: async () => true,
}));

vi.mock("@/lib/logger", () => ({
	createLogger: () => ({
		error: () => {},
		warn: () => {},
		info: () => {},
		debug: () => {},
		child: () => ({ error: () => {}, warn: () => {}, info: () => {}, debug: () => {} }),
	}),
}));

const { changeCustomFields, getCustomFieldDefinitions } = await import("./actions");
const { listActiveCustomFields } = await import("@/lib/organization/custom-fields/definitions");
const { db } = await import("@/db");

const ids = {
	organization: "t817-org",
	otherOrganization: "t817-other-org",
	ownerUser: "t817-owner-user",
	adminUser: "t817-admin-user",
	managerUser: "t817-manager-user",
	employeeAdminUser: "t817-employee-admin-user",
	memberUser: "t817-member-user",
	otherOwnerUser: "t817-other-owner-user",
} as const;
const users = [
	ids.ownerUser,
	ids.adminUser,
	ids.managerUser,
	ids.employeeAdminUser,
	ids.memberUser,
	ids.otherOwnerUser,
];

type Change = Parameters<typeof changeCustomFields>[0];
type Fields = Awaited<ReturnType<typeof getCustomFieldDefinitions>> & { success: true };

const field = (overrides: Record<string, unknown> = {}) =>
	({
		kind: "create",
		entity: "employee",
		name: "Personnel number",
		type: "text",
		required: false,
		tracked: false,
		visibility: "manager",
		editLevel: "admin",
		...overrides,
	}) as Change;

describe("custom field definitions on PostgreSQL", () => {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
	const admin = integrationAdminPool();

	function actAs(userId: string, organizationId: string = ids.organization) {
		harness.userId = userId;
		harness.organizationId = organizationId;
	}

	async function cleanup() {
		await admin.query("delete from organization where id = any($1::text[])", [
			[ids.organization, ids.otherOrganization],
		]);
		await admin.query('delete from "user" where id = any($1::text[])', [users]);
	}

	/** Applies a change that must succeed, returning every definition of the org. */
	async function apply(change: Change) {
		const result = await changeCustomFields(change);
		if (!result.success) throw new Error(`action failed: ${result.error}`);
		if (!result.data.ok) throw new Error(`change refused: ${result.data.reason}`);
		return result.data.fields;
	}

	async function refusal(change: Change) {
		const result = await changeCustomFields(change);
		if (!result.success) throw new Error(`action failed: ${result.error}`);
		return result.data.ok ? "accepted" : result.data.reason;
	}

	async function create(overrides: Record<string, unknown> = {}) {
		const fields = await apply(field(overrides));
		const name = (overrides.name as string | undefined) ?? "Personnel number";
		const entity = (overrides.entity as string | undefined) ?? "employee";
		const created = fields.find((f) => f.name === name && f.entity === entity && !f.archived);
		if (!created) throw new Error("created field missing");
		return created;
	}

	async function auditEntries(organizationId: string = ids.organization) {
		const { rows } = await admin.query<{
			action: string;
			entity_type: string;
			entity_id: string;
			performed_by: string;
			changes: string | null;
		}>(
			`select action, entity_type, entity_id, performed_by, changes from audit_log
			 where organization_id = $1 and entity_type like 'custom_field%'
			 order by timestamp, action, entity_id`,
			[organizationId],
		);
		return rows.map((row) => ({ ...row, changes: row.changes ? JSON.parse(row.changes) : null }));
	}

	beforeEach(async () => {
		await cleanup();
		const timestamp = new Date("2026-10-01T08:00:00Z");
		await admin.query(
			`insert into organization (id, name, slug, created_at) values
			 ($1, 'T817', $1, $3), ($2, 'T817 other', $2, $3)`,
			[ids.organization, ids.otherOrganization, timestamp],
		);
		await admin.query(
			`insert into "user" (id, name, email, created_at, updated_at)
			 select user_id, user_id, user_id || '@example.test', $2, $2 from unnest($1::text[]) as user_id`,
			[users, timestamp],
		);
		await admin.query(
			`insert into member (id, organization_id, user_id, role, status, created_at) values
			 ('t817-m-owner', $1, $3, 'owner', 'approved', $9),
			 ('t817-m-admin', $1, $4, 'admin', 'approved', $9),
			 ('t817-m-manager', $1, $5, 'member', 'approved', $9),
			 ('t817-m-employee-admin', $1, $6, 'member', 'approved', $9),
			 ('t817-m-member', $1, $7, 'member', 'approved', $9),
			 ('t817-m-other-owner', $2, $8, 'owner', 'approved', $9),
			 ('t817-m-admin-in-other', $2, $4, 'member', 'approved', $9)`,
			[
				ids.organization,
				ids.otherOrganization,
				ids.ownerUser,
				ids.adminUser,
				ids.managerUser,
				ids.employeeAdminUser,
				ids.memberUser,
				ids.otherOwnerUser,
				timestamp,
			],
		);
		await admin.query(
			`insert into employee (user_id, organization_id, first_name, last_name, role, updated_at) values
			 ($1, $5, 'Mia', 'Manager', 'manager', $6),
			 ($2, $5, 'Eve', 'EmployeeAdmin', 'admin', $6),
			 ($3, $5, 'Max', 'Member', 'employee', $6),
			 ($4, $5, 'Ada', 'Admin', 'employee', $6)`,
			[
				ids.managerUser,
				ids.employeeAdminUser,
				ids.memberUser,
				ids.adminUser,
				ids.organization,
				timestamp,
			],
		);
		actAs(ids.adminUser);
	});

	afterAll(cleanup);

	describe("defining fields", () => {
		it("creates a field of each type for each entity", async () => {
			for (const entity of ["employee", "project", "customer"]) {
				await create({ entity, name: "Text", type: "text" });
				await create({
					entity,
					name: "Number",
					type: "number",
					number: { integerOnly: true, min: "0", max: "99" },
				});
				await create({ entity, name: "Date", type: "date", required: true });
				await create({ entity, name: "Select", type: "select", options: ["Gold", "Silver"] });
				await create({ entity, name: "Boolean", type: "boolean", tracked: true });
			}

			const result = (await getCustomFieldDefinitions()) as Fields;
			expect(result.success).toBe(true);
			expect(result.data).toHaveLength(15);

			const projectFields = await listActiveCustomFields(db, ids.organization, "project");
			expect(projectFields.map((f) => [f.name, f.type, f.position])).toEqual([
				["Text", "text", 0],
				["Number", "number", 1],
				["Date", "date", 2],
				["Select", "select", 3],
				["Boolean", "boolean", 4],
			]);
			expect(projectFields[1]).toMatchObject({
				number: { integerOnly: true, min: "0", max: "99" },
				required: false,
				tracked: false,
				visibility: "manager",
				editLevel: "admin",
			});
			expect(projectFields[2]).toMatchObject({ required: true, number: null });
			expect(projectFields[3].options.map((o) => [o.label, o.archived])).toEqual([
				["Gold", false],
				["Silver", false],
			]);
			expect(projectFields[4]).toMatchObject({ tracked: true, required: false });
		});

		it("renames a field and changes its configuration, with audit entries", async () => {
			const created = await create({ type: "number" });

			const fields = await apply({
				kind: "update",
				fieldId: created.id,
				name: "Payroll number",
				required: true,
				visibility: "employee",
				editLevel: "manager",
				number: { integerOnly: true, min: "1", max: null },
			});

			expect(fields.find((f) => f.id === created.id)).toMatchObject({
				name: "Payroll number",
				required: true,
				visibility: "employee",
				editLevel: "manager",
				number: { integerOnly: true, min: "1", max: null },
			});
			expect(await auditEntries()).toEqual([
				expect.objectContaining({
					action: "custom_field.created",
					entity_type: "custom_field",
					entity_id: created.id,
					performed_by: ids.adminUser,
				}),
				expect.objectContaining({
					action: "custom_field.renamed",
					entity_id: created.id,
					changes: { before: { name: "Personnel number" }, after: { name: "Payroll number" } },
				}),
				expect.objectContaining({
					action: "custom_field.updated",
					entity_id: created.id,
					changes: {
						before: {
							required: false,
							visibility: "manager",
							editLevel: "admin",
							number: { integerOnly: false, min: null, max: null },
						},
						after: {
							required: true,
							visibility: "employee",
							editLevel: "manager",
							number: { integerOnly: true, min: "1", max: null },
						},
					},
				}),
			]);
		});

		it("writes nothing when an update changes nothing", async () => {
			const created = await create();
			await apply({
				kind: "update",
				fieldId: created.id,
				name: "Personnel number",
				required: false,
				visibility: "manager",
				editLevel: "admin",
			} as Change);

			expect((await auditEntries()).map((e) => e.action)).toEqual(["custom_field.created"]);
		});

		it("rejects changing the type or tracked flag after creation", async () => {
			const created = await create();
			const update = {
				kind: "update",
				fieldId: created.id,
				name: "Personnel number",
				required: false,
				visibility: "manager",
				editLevel: "admin",
			};

			expect(await refusal({ ...update, type: "number" } as Change)).toBe("type_fixed");
			expect(await refusal({ ...update, tracked: true } as Change)).toBe("tracked_fixed");
			expect(await refusal({ ...update, type: "text", tracked: false } as Change)).toBe("accepted");
		});

		it("rejects an edit level broader than the visibility, and an edit level of employee", async () => {
			expect(await refusal(field({ visibility: "admin", editLevel: "manager" }))).toBe(
				"edit_level_broader_than_visibility",
			);
			expect(await refusal(field({ visibility: "employee", editLevel: "employee" }))).toBe(
				"employees_never_edit",
			);
			const created = await create();
			expect(
				await refusal({
					kind: "update",
					fieldId: created.id,
					name: "Personnel number",
					required: false,
					visibility: "admin",
					editLevel: "manager",
				} as Change),
			).toBe("edit_level_broader_than_visibility");
		});

		it("refuses a required boolean field", async () => {
			expect(await refusal(field({ type: "boolean", required: true }))).toBe(
				"boolean_cannot_be_required",
			);
		});

		it("refuses a second active field with the same name on one entity", async () => {
			await create();
			expect(await refusal(field({ name: " personnel NUMBER " }))).toBe("name_taken");
			expect(await refusal(field({ entity: "project" }))).toBe("accepted");
		});
	});

	describe("the active-field cap", () => {
		it("rejects a 26th active field for an entity, and archiving one frees a place", async () => {
			const created = [];
			for (let i = 1; i <= 25; i++) created.push(await create({ name: `Field ${i}` }));

			expect(await refusal(field({ name: "Field 26" }))).toBe("too_many_fields");
			expect(await refusal(field({ name: "Field 26", entity: "customer" }))).toBe("accepted");

			await apply({ kind: "archive", fieldId: created[0].id });
			expect(await refusal(field({ name: "Field 26" }))).toBe("accepted");

			expect(await refusal({ kind: "restore", fieldId: created[0].id })).toBe("too_many_fields");
		});
	});

	describe("ordering", () => {
		it("reorders the active fields of one entity", async () => {
			const a = await create({ name: "A" });
			const b = await create({ name: "B" });
			const c = await create({ name: "C" });

			await apply({ kind: "reorder", entity: "employee", fieldIds: [c.id, a.id, b.id] });

			expect(
				(await listActiveCustomFields(db, ids.organization, "employee")).map((f) => f.name),
			).toEqual(["C", "A", "B"]);
			const reordered = (await auditEntries())
				.filter((e) => e.action === "custom_field.reordered")
				.map((e) => [e.entity_id, e.changes]);
			expect(reordered).toHaveLength(3);
			expect(reordered).toEqual(
				expect.arrayContaining([
					[c.id, { before: { position: 2 }, after: { position: 0 } }],
					[a.id, { before: { position: 0 }, after: { position: 1 } }],
					[b.id, { before: { position: 1 }, after: { position: 2 } }],
				]),
			);
		});

		it("refuses a reorder that does not list exactly the active fields", async () => {
			const a = await create({ name: "A" });
			const b = await create({ name: "B" });
			const archived = await create({ name: "Old" });
			await apply({ kind: "archive", fieldId: archived.id });

			expect(await refusal({ kind: "reorder", entity: "employee", fieldIds: [b.id] })).toBe(
				"stale_order",
			);
			expect(
				await refusal({
					kind: "reorder",
					entity: "employee",
					fieldIds: [b.id, a.id, archived.id],
				}),
			).toBe("stale_order");
			expect(await refusal({ kind: "reorder", entity: "employee", fieldIds: [b.id, a.id] })).toBe(
				"accepted",
			);
		});
	});

	describe("archiving", () => {
		it("archives and restores a field, hiding it from the active fields", async () => {
			const a = await create({ name: "A" });
			const b = await create({ name: "B" });

			const fields = await apply({ kind: "archive", fieldId: a.id });
			expect(fields.find((f) => f.id === a.id)).toMatchObject({ archived: true });
			expect(
				(await listActiveCustomFields(db, ids.organization, "employee")).map((f) => f.name),
			).toEqual(["B"]);
			expect(
				await refusal({
					kind: "update",
					fieldId: a.id,
					name: "A2",
					required: false,
					visibility: "manager",
					editLevel: "admin",
				} as Change),
			).toBe("field_archived");

			await apply({ kind: "restore", fieldId: a.id });
			expect(
				(await listActiveCustomFields(db, ids.organization, "employee")).map((f) => f.name),
			).toEqual(["B", "A"]);
			expect(b.position).toBe(1);
			expect(
				(await auditEntries()).filter((e) => e.entity_id === a.id).map((e) => e.action),
			).toEqual(["custom_field.created", "custom_field.archived", "custom_field.restored"]);
		});

		it("refuses to restore a field whose name an active field now has", async () => {
			const a = await create({ name: "A" });
			await apply({ kind: "archive", fieldId: a.id });
			await create({ name: "a" });

			expect(await refusal({ kind: "restore", fieldId: a.id })).toBe("name_taken");
		});

		it("refuses to archive a payroll identifier field, also of an inactive configuration", async () => {
			const payrollId = await create({ name: "Payroll ID" });
			await admin.query(
				`insert into payroll_export_format (id, name, version, updated_at) values
				 ('sage_lohn', 'Sage Lohn', '1.0', now())
				 on conflict (id) do nothing`,
			);
			const { rows: formats } = await admin.query<{ id: string; name: string }>(
				"select id, name from payroll_export_format where id = 'sage_lohn'",
			);
			await admin.query(
				`insert into payroll_export_config (organization_id, format_id, config, is_active, created_by, updated_at)
				 values ($1, 'sage_lohn', $2::jsonb, false, $3, now())`,
				[
					ids.organization,
					JSON.stringify({ personnelNumberType: "customField", personnelNumberCustomFieldId: payrollId.id }),
					ids.ownerUser,
				],
			);

			const outcome = await changeCustomFields({ kind: "archive", fieldId: payrollId.id });

			expect(outcome).toEqual({
				success: true,
				data: {
					ok: false,
					reason: "used_as_payroll_identifier",
					configurations: [formats.find((format) => format.id === "sage_lohn")?.name],
				},
			});
		});
	});

	describe("select options", () => {
		it("adds, renames, reorders, archives and restores options", async () => {
			const select = await create({ name: "Tier", type: "select", options: ["Gold"] });
			const gold = select.options[0];

			let fields = await apply({ kind: "addOption", fieldId: select.id, label: "Silver" });
			const silver = fields
				.find((f) => f.id === select.id)
				?.options.find((o) => o.label === "Silver");
			if (!silver) throw new Error("option missing");

			await apply({ kind: "renameOption", optionId: silver.id, label: "Platinum" });
			await apply({ kind: "reorderOptions", fieldId: select.id, optionIds: [silver.id, gold.id] });
			fields = await apply({ kind: "archiveOption", optionId: gold.id });

			const [tier] = await listActiveCustomFields(db, ids.organization, "employee");
			expect(tier.options.map((o) => [o.label, o.archived])).toEqual([
				["Platinum", false],
				["Gold", true],
			]);
			expect(await refusal({ kind: "archiveOption", optionId: silver.id })).toBe(
				"last_active_option",
			);
			expect(await refusal({ kind: "addOption", fieldId: select.id, label: "platinum" })).toBe(
				"duplicate_option_label",
			);

			await apply({ kind: "restoreOption", optionId: gold.id });
			const [restored] = await listActiveCustomFields(db, ids.organization, "employee");
			expect(restored.options.map((o) => [o.label, o.archived])).toEqual([
				["Platinum", false],
				["Gold", false],
			]);

			expect(
				(await auditEntries())
					.filter((e) => e.entity_type === "custom_field_option")
					.map((e) => e.action),
			).toEqual([
				"custom_field.option_added",
				"custom_field.option_added",
				"custom_field.option_renamed",
				"custom_field.option_reordered",
				"custom_field.option_reordered",
				"custom_field.option_archived",
				"custom_field.option_restored",
			]);
		});

		it("refuses option changes on a field that is not a select field", async () => {
			const text = await create();
			expect(await refusal({ kind: "addOption", fieldId: text.id, label: "A" })).toBe("not_select");
		});
	});

	describe("access", () => {
		it("lets owners and admins in", async () => {
			actAs(ids.ownerUser);
			expect(await refusal(field())).toBe("accepted");
			expect((await getCustomFieldDefinitions()).success).toBe(true);
		});

		it("refuses managers, employee-role admins and employees", async () => {
			for (const user of [ids.managerUser, ids.employeeAdminUser, ids.memberUser]) {
				actAs(user);
				expect(await getCustomFieldDefinitions()).toMatchObject({
					success: false,
					code: "AuthorizationError",
				});
				expect(await changeCustomFields(field())).toMatchObject({
					success: false,
					code: "AuthorizationError",
				});
			}
		});

		it("refuses an admin acting in an organization where they are only a member", async () => {
			actAs(ids.adminUser, ids.otherOrganization);
			expect(await changeCustomFields(field())).toMatchObject({
				success: false,
				code: "AuthorizationError",
			});
		});
	});

	describe("organization scoping", () => {
		it("never reads or writes another organization's definitions", async () => {
			actAs(ids.otherOwnerUser, ids.otherOrganization);
			const foreign = await create({ name: "Foreign", type: "select", options: ["X", "Y"] });
			const foreignOption = foreign.options[0];

			actAs(ids.adminUser);
			const own = await create({ name: "Own" });
			const result = (await getCustomFieldDefinitions()) as Fields;
			expect(result.data.map((f) => f.name)).toEqual(["Own"]);
			expect(await listActiveCustomFields(db, ids.organization, "employee")).toHaveLength(1);

			const update = {
				kind: "update",
				fieldId: foreign.id,
				name: "Hijacked",
				required: false,
				visibility: "manager",
				editLevel: "admin",
			} as Change;
			expect(await refusal(update)).toBe("field_not_found");
			expect(await refusal({ kind: "archive", fieldId: foreign.id })).toBe("field_not_found");
			expect(await refusal({ kind: "restore", fieldId: foreign.id })).toBe("field_not_found");
			expect(await refusal({ kind: "addOption", fieldId: foreign.id, label: "Z" })).toBe(
				"field_not_found",
			);
			expect(
				await refusal({ kind: "renameOption", optionId: foreignOption.id, label: "Hijacked" }),
			).toBe("option_not_found");
			expect(await refusal({ kind: "archiveOption", optionId: foreignOption.id })).toBe(
				"option_not_found",
			);
			expect(
				await refusal({
					kind: "reorder",
					entity: "employee",
					fieldIds: [foreign.id, own.id],
				}),
			).toBe("stale_order");

			actAs(ids.otherOwnerUser, ids.otherOrganization);
			const [untouched] = await listActiveCustomFields(db, ids.otherOrganization, "employee");
			expect(untouched).toMatchObject({ name: "Foreign", position: 0 });
			expect(untouched.options.map((o) => [o.label, o.archived])).toEqual([
				["X", false],
				["Y", false],
			]);
			expect(await auditEntries(ids.organization)).toHaveLength(1);
		});

		it("refuses an option that points at another organization's field in the database", async () => {
			actAs(ids.otherOwnerUser, ids.otherOrganization);
			const foreign = await create({ name: "Foreign", type: "select", options: ["X"] });

			await expect(
				admin.query(
					`insert into custom_field_option (organization_id, definition_id, label, position)
					 values ($1, $2, 'Smuggled', 9)`,
					[ids.organization, foreign.id],
				),
			).rejects.toThrow(/custom_field_option_definition_fk/);
		});
	});
});
