/**
 * #818: the custom field value store on PostgreSQL. Typed rows, same-organization
 * foreign keys, cascades, type rules, edit levels, required fields, audit, the
 * viewer level loader and the as-of read contract. #819: tracked fields' dated
 * history.
 */

import { Temporal } from "temporal-polyfill";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { integrationAdminPool } from "@/test/integration-database";

const { db } = await import("@/db");
const { changeCustomFields } = await import("./definitions");
const {
	CustomFieldValuesRefused,
	loadCustomFieldViewerLevel,
	readCustomFieldSection,
	readCustomFieldValues,
	writeCustomFieldValues,
} = await import("./values");

const ids = {
	organization: "t818s-org",
	other: "t818s-other-org",
	admin: "t818s-admin",
	manager: "t818s-manager",
	member: "t818s-member",
	customRoleMember: "t818s-custom-role-member",
	inactive: "t818s-inactive",
	otherOwner: "t818s-other-owner",
} as const;
const users = Object.values(ids).filter((id) => !id.endsWith("org"));
const asOf = Temporal.PlainDate.from("2026-10-10");

type Entity = "employee" | "project" | "customer";

describe("custom field values on PostgreSQL", () => {
	const admin = integrationAdminPool();
	let employeeId: string;
	let managerEmployeeId: string;
	let projectId: string;
	let customerId: string;
	let otherEmployeeId: string;
	let otherProjectId: string;

	async function cleanup() {
		await admin.query("delete from organization where id = any($1::text[])", [
			[ids.organization, ids.other],
		]);
		await admin.query('delete from "user" where id = any($1::text[])', [users]);
	}

	async function define(
		organizationId: string,
		change: Record<string, unknown>,
	): Promise<{ id: string; options: { id: string; label: string }[] }> {
		const outcome = await changeCustomFields(db, {
			organizationId,
			actorUserId: organizationId === ids.other ? ids.otherOwner : ids.admin,
			change: {
				kind: "create",
				entity: "employee",
				type: "text",
				required: false,
				tracked: false,
				visibility: "manager",
				editLevel: "manager",
				...change,
			},
		});
		if (!outcome.ok) throw new Error(`define refused: ${outcome.reason}`);
		const field = outcome.fields.find(
			(f) => f.name === change.name && f.entity === (change.entity ?? "employee") && !f.archived,
		);
		if (!field) throw new Error("field missing");
		return field;
	}

	async function write(
		entity: Entity,
		recordId: string,
		values: Record<string, unknown>,
		options: { level?: "admin" | "manager" | "employee" | null; requireComplete?: boolean } = {},
	) {
		return db.transaction((tx) =>
			writeCustomFieldValues(tx, {
				organizationId: ids.organization,
				actorUserId: ids.admin,
				level: options.level === undefined ? "admin" : options.level,
				entity,
				recordId,
				values,
				requireComplete: options.requireComplete ?? false,
			}),
		);
	}

	async function refusal(promise: Promise<unknown>) {
		try {
			await promise;
			return "accepted";
		} catch (error) {
			if (error instanceof CustomFieldValuesRefused) return error.reason;
			throw error;
		}
	}

	async function read(
		entity: Entity,
		recordIds: string[],
		viewer: Parameters<typeof readCustomFieldValues>[1]["viewer"] = { kind: "system" },
	) {
		return readCustomFieldValues(db, {
			organizationId: ids.organization,
			entity,
			recordIds,
			asOf,
			viewer,
		});
	}

	async function audit() {
		const { rows } = await admin.query<{
			action: string;
			entity_type: string;
			entity_id: string;
			performed_by: string;
			changes: string;
			metadata: string;
		}>(
			`select action, entity_type, entity_id, performed_by, changes, metadata from audit_log
			 where organization_id = $1 and action like 'custom_field_value.%'
			 order by timestamp, action, entity_id`,
			[ids.organization],
		);
		return rows.map((row) => ({
			...row,
			changes: JSON.parse(row.changes),
			metadata: JSON.parse(row.metadata),
		}));
	}

	beforeEach(async () => {
		await cleanup();
		const timestamp = new Date("2026-10-01T08:00:00Z");
		await admin.query(
			`insert into organization (id, name, slug, created_at) values
			 ($1, 'T818S', $1, $3), ($2, 'T818S other', $2, $3)`,
			[ids.organization, ids.other, timestamp],
		);
		await admin.query(
			`insert into "user" (id, name, email, created_at, updated_at)
			 select user_id, user_id, user_id || '@example.test', $2, $2 from unnest($1::text[]) as user_id`,
			[users, timestamp],
		);
		await admin.query(
			`insert into member (id, organization_id, user_id, role, status, created_at) values
			 ('t818s-m-admin', $1, $3, 'admin', 'approved', $9),
			 ('t818s-m-manager', $1, $4, 'member', 'approved', $9),
			 ('t818s-m-member', $1, $5, 'member', 'approved', $9),
			 ('t818s-m-custom', $1, $6, 'member', 'approved', $9),
			 ('t818s-m-inactive', $1, $7, 'member', 'approved', $9),
			 ('t818s-m-other-owner', $2, $8, 'owner', 'approved', $9)`,
			[
				ids.organization,
				ids.other,
				ids.admin,
				ids.manager,
				ids.member,
				ids.customRoleMember,
				ids.inactive,
				ids.otherOwner,
				timestamp,
			],
		);
		const { rows: employees } = await admin.query<{ id: string; user_id: string }>(
			`insert into employee (user_id, organization_id, first_name, last_name, role, is_active, updated_at) values
			 ($1, $6, 'Mia', 'Manager', 'manager', true, $8),
			 ($2, $6, 'Max', 'Member', 'employee', true, $8),
			 ($3, $6, 'Cara', 'Custom', 'employee', true, $8),
			 ($4, $6, 'Ivo', 'Inactive', 'manager', false, $8),
			 ($5, $7, 'Otto', 'Other', 'admin', true, $8)
			 returning id, user_id`,
			[
				ids.manager,
				ids.member,
				ids.customRoleMember,
				ids.inactive,
				ids.otherOwner,
				ids.organization,
				ids.other,
				timestamp,
			],
		);
		const byUser = new Map(employees.map((row) => [row.user_id, row.id]));
		managerEmployeeId = byUser.get(ids.manager)!;
		employeeId = byUser.get(ids.member)!;
		otherEmployeeId = byUser.get(ids.otherOwner)!;
		const { rows: roles } = await admin.query<{ id: string }>(
			`insert into custom_role (organization_id, name, base_tier, created_by, updated_at)
			 values ($1, 'Team lead', 'manager', $2, $3) returning id`,
			[ids.organization, ids.admin, timestamp],
		);
		await admin.query(
			`insert into employee_custom_role (employee_id, custom_role_id, assigned_by) values ($1, $2, $3)`,
			[byUser.get(ids.customRoleMember), roles[0].id, ids.admin],
		);
		const { rows: customers } = await admin.query<{ id: string }>(
			`insert into customer (organization_id, name, created_by, updated_at)
			 values ($1, 'Acme', $2, $3) returning id`,
			[ids.organization, ids.admin, timestamp],
		);
		customerId = customers[0].id;
		const { rows: projects } = await admin.query<{ id: string; organization_id: string }>(
			`insert into project (organization_id, name, created_by, updated_at) values
			 ($1, 'Bridge', $3, $4), ($2, 'Other bridge', $5, $4) returning id, organization_id`,
			[ids.organization, ids.other, ids.admin, timestamp, ids.otherOwner],
		);
		projectId = projects.find((row) => row.organization_id === ids.organization)!.id;
		otherProjectId = projects.find((row) => row.organization_id === ids.other)!.id;
	});

	afterAll(cleanup);

	it("sets, changes and clears a value of each type on each record kind", async () => {
		const records: [Entity, () => string][] = [
			["employee", () => employeeId],
			["project", () => projectId],
			["customer", () => customerId],
		];
		for (const [entity, recordId] of records) {
			const text = await define(ids.organization, { entity, name: "Text" });
			const number = await define(ids.organization, {
				entity,
				name: "Number",
				type: "number",
				number: { integerOnly: false, min: "0", max: "1000" },
			});
			const date = await define(ids.organization, { entity, name: "Date", type: "date" });
			const flag = await define(ids.organization, { entity, name: "Flag", type: "boolean" });
			const select = await define(ids.organization, {
				entity,
				name: "Tier",
				type: "select",
				options: ["Gold", "Silver"],
			});
			const [gold, silver] = select.options;

			await write(entity, recordId(), {
				[text.id]: "PN-1",
				[number.id]: "12,50",
				[date.id]: "2024-02-29",
				[flag.id]: false,
				[select.id]: gold.id,
			});
			expect((await read(entity, [recordId()])).values[recordId()]).toEqual({
				[text.id]: { type: "text", value: "PN-1" },
				[number.id]: { type: "number", value: "12.5" },
				[date.id]: { type: "date", value: "2024-02-29" },
				[flag.id]: { type: "boolean", value: false },
				[select.id]: { type: "select", value: gold.id },
			});

			await write(entity, recordId(), {
				[text.id]: "PN-2",
				[number.id]: "1000",
				[date.id]: "2025-01-01",
				[flag.id]: true,
				[select.id]: silver.id,
			});
			expect((await read(entity, [recordId()])).values[recordId()]).toEqual({
				[text.id]: { type: "text", value: "PN-2" },
				[number.id]: { type: "number", value: "1000" },
				[date.id]: { type: "date", value: "2025-01-01" },
				[flag.id]: { type: "boolean", value: true },
				[select.id]: { type: "select", value: silver.id },
			});

			await write(entity, recordId(), {
				[text.id]: "",
				[number.id]: null,
				[date.id]: null,
				[flag.id]: null,
				[select.id]: null,
			});
			expect((await read(entity, [recordId()])).values[recordId()] ?? {}).toEqual({});
		}
	});

	it("audits every change with the field, the record, the old and the new value", async () => {
		const select = await define(ids.organization, {
			name: "Tier",
			type: "select",
			options: ["Gold", "Silver"],
		});
		const [gold, silver] = select.options;
		await write("employee", employeeId, { [select.id]: gold.id });
		await write("employee", employeeId, { [select.id]: gold.id });
		await write("employee", employeeId, { [select.id]: silver.id });
		await write("employee", employeeId, { [select.id]: null });

		const entries = await audit();
		expect(entries.map((e) => [e.action, e.entity_type, e.entity_id, e.performed_by])).toEqual([
			["custom_field_value.set", "employee", employeeId, ids.admin],
			["custom_field_value.changed", "employee", employeeId, ids.admin],
			["custom_field_value.cleared", "employee", employeeId, ids.admin],
		]);
		expect(entries[1].changes).toEqual({
			before: { optionId: gold.id, label: "Gold" },
			after: { optionId: silver.id, label: "Silver" },
		});
		expect(entries[1].metadata).toMatchObject({
			fieldId: select.id,
			fieldName: "Tier",
			fieldType: "select",
			entity: "employee",
		});
		expect(entries[2].changes).toEqual({
			before: { optionId: silver.id, label: "Silver" },
			after: null,
		});
	});

	it("rejects values that break their field's type rules", async () => {
		const text = await define(ids.organization, { name: "Text" });
		const number = await define(ids.organization, {
			name: "Count",
			type: "number",
			number: { integerOnly: true, min: "1", max: "9" },
		});
		const date = await define(ids.organization, { name: "Date", type: "date" });
		const select = await define(ids.organization, {
			name: "Tier",
			type: "select",
			options: ["Gold"],
		});
		const otherSelect = await define(ids.organization, {
			name: "Other tier",
			type: "select",
			options: ["Bronze"],
		});

		expect(await refusal(write("employee", employeeId, { [text.id]: "x".repeat(256) }))).toBe(
			"text_too_long",
		);
		expect(await refusal(write("employee", employeeId, { [number.id]: "2.5" }))).toBe(
			"number_not_integer",
		);
		expect(await refusal(write("employee", employeeId, { [number.id]: "10" }))).toBe(
			"number_out_of_range",
		);
		expect(await refusal(write("employee", employeeId, { [date.id]: "2023-02-29" }))).toBe(
			"invalid_date",
		);
		expect(
			await refusal(write("employee", employeeId, { [select.id]: otherSelect.options[0].id })),
		).toBe("invalid_option");
		expect(await refusal(write("employee", employeeId, { [text.id]: 5 }))).toBe("invalid_value");
		// A refusal rolls the whole write back.
		expect(
			await refusal(write("employee", employeeId, { [text.id]: "kept?", [number.id]: "99" })),
		).toBe("number_out_of_range");
		expect((await read("employee", [employeeId])).values[employeeId] ?? {}).toEqual({});
	});

	it("rejects writes to archived fields and new picks of archived options, but keeps a held one", async () => {
		const text = await define(ids.organization, { name: "Old" });
		const select = await define(ids.organization, {
			name: "Tier",
			type: "select",
			options: ["Gold", "Silver"],
		});
		const [gold, silver] = select.options;
		await write("employee", employeeId, { [select.id]: gold.id });
		await changeCustomFields(db, {
			organizationId: ids.organization,
			actorUserId: ids.admin,
			change: { kind: "archiveOption", optionId: gold.id },
		});
		await changeCustomFields(db, {
			organizationId: ids.organization,
			actorUserId: ids.admin,
			change: { kind: "archive", fieldId: text.id },
		});

		expect(await refusal(write("employee", employeeId, { [text.id]: "x" }))).toBe("field_archived");
		expect(await refusal(write("employee", employeeId, { [select.id]: gold.id }))).toBe("accepted");
		await write("employee", employeeId, { [select.id]: silver.id });
		expect(await refusal(write("employee", employeeId, { [select.id]: gold.id }))).toBe(
			"option_archived",
		);
	});

	it("rejects fields of another record kind or organization", async () => {
		const projectField = await define(ids.organization, { entity: "project", name: "PO" });
		const foreign = await define(ids.other, { name: "Foreign" });
		expect(await refusal(write("employee", employeeId, { [projectField.id]: "x" }))).toBe(
			"unknown_field",
		);
		expect(await refusal(write("employee", employeeId, { [foreign.id]: "x" }))).toBe(
			"unknown_field",
		);
		expect(await refusal(write("employee", employeeId, { "not-a-uuid": "x" }))).toBe(
			"unknown_field",
		);
	});

	it("rejects writes above the writer's edit level, whatever the value", async () => {
		const adminField = await define(ids.organization, {
			name: "Salary band",
			visibility: "admin",
			editLevel: "admin",
		});
		const managerField = await define(ids.organization, { name: "Desk" });
		await write("employee", employeeId, { [adminField.id]: "B2" });

		expect(
			await refusal(write("employee", employeeId, { [adminField.id]: "B2" }, { level: "manager" })),
		).toBe("not_editable");
		expect(
			await refusal(
				write("employee", employeeId, { [managerField.id]: "4.12" }, { level: "employee" }),
			),
		).toBe("not_editable");
		expect(
			await refusal(
				write("employee", employeeId, { [managerField.id]: "4.12" }, { level: "manager" }),
			),
		).toBe("accepted");
	});

	it("refuses a write that leaves a required field the writer may edit without a value", async () => {
		const required = await define(ids.organization, { name: "Cost centre", required: true });
		const adminRequired = await define(ids.organization, {
			name: "Payroll id",
			required: true,
			visibility: "admin",
			editLevel: "admin",
		});
		const optional = await define(ids.organization, { name: "Desk" });

		const error = await write(
			"employee",
			employeeId,
			{ [optional.id]: "4.12" },
			{ requireComplete: true },
		).catch((e) => e);
		expect(error).toBeInstanceOf(CustomFieldValuesRefused);
		expect(error).toMatchObject({ reason: "missing_required", fieldId: required.id });

		// A manager is held to the required fields they may edit only.
		expect(
			await refusal(
				write(
					"employee",
					employeeId,
					{ [required.id]: "CC-1" },
					{ level: "manager", requireComplete: true },
				),
			),
		).toBe("accepted");
		expect(await refusal(write("employee", employeeId, {}, { requireComplete: true }))).toBe(
			"missing_required",
		);
		await write("employee", employeeId, { [adminRequired.id]: "P-1" }, { requireComplete: true });
		// Without requireComplete (non-form paths), missing values are allowed.
		expect(await refusal(write("employee", managerEmployeeId, { [optional.id]: "1" }))).toBe(
			"accepted",
		);
	});

	describe("as-of read contract", () => {
		it("shows a viewer only the fields their level sees, and the system every field", async () => {
			const adminOnly = await define(ids.organization, {
				name: "Salary band",
				visibility: "admin",
				editLevel: "admin",
			});
			const managers = await define(ids.organization, { name: "Desk" });
			const everyone = await define(ids.organization, {
				name: "Shirt size",
				visibility: "employee",
				editLevel: "manager",
			});
			await write("employee", employeeId, {
				[adminOnly.id]: "B2",
				[managers.id]: "4.12",
				[everyone.id]: "M",
			});

			const system = await read("employee", [employeeId]);
			expect(system.fields.map((f) => f.name)).toEqual(["Salary band", "Desk", "Shirt size"]);
			expect(Object.keys(system.values[employeeId])).toHaveLength(3);

			const manager = await read("employee", [employeeId], { kind: "level", level: "manager" });
			expect(manager.fields.map((f) => f.name)).toEqual(["Desk", "Shirt size"]);
			expect(manager.values[employeeId]).toEqual({
				[managers.id]: { type: "text", value: "4.12" },
				[everyone.id]: { type: "text", value: "M" },
			});

			const employee = await read("employee", [employeeId], { kind: "actor", userId: ids.member });
			expect(employee.fields.map((f) => f.name)).toEqual(["Shirt size"]);
			expect(employee.values[employeeId]).toEqual({ [everyone.id]: { type: "text", value: "M" } });

			const nobody = await read("employee", [employeeId], { kind: "level", level: null });
			expect(nobody.fields).toEqual([]);
			expect(nobody.values).toEqual({});
		});

		it("lists missing required values per record among the fields the viewer sees", async () => {
			const required = await define(ids.organization, {
				entity: "customer",
				name: "Customer number",
				required: true,
			});
			const hidden = await define(ids.organization, {
				entity: "customer",
				name: "Credit limit",
				required: true,
				visibility: "admin",
				editLevel: "admin",
			});
			const result = await read("customer", [customerId], { kind: "level", level: "manager" });
			expect(result.missingRequired).toEqual({ [customerId]: [required.id] });
			const system = await read("customer", [customerId]);
			expect(system.missingRequired).toEqual({ [customerId]: [required.id, hidden.id] });
			await write("customer", customerId, { [required.id]: "C-1", [hidden.id]: "5000" });
			expect((await read("customer", [customerId])).missingRequired).toEqual({});
		});

		it("never returns values of records in another organization", async () => {
			const field = await define(ids.organization, { name: "Desk" });
			await write("employee", employeeId, { [field.id]: "4.12" });
			const result = await read("employee", [employeeId, otherEmployeeId]);
			expect(Object.keys(result.values)).toEqual([employeeId]);
		});
	});

	describe("tracked custom fields (#819)", () => {
		const day = (iso: string) => Temporal.PlainDate.from(iso);
		const add = (validFrom: string, value: unknown) => ({ op: "add", validFrom, value });
		const history = (...changes: unknown[]) => ({ history: changes });

		async function readAsOf(
			field: { id: string },
			date: string,
			entity: Entity = "employee",
			recordId = employeeId,
		) {
			const result = await readCustomFieldValues(db, {
				organizationId: ids.organization,
				entity,
				recordIds: [recordId],
				asOf: day(date),
				viewer: { kind: "system" },
			});
			return result.values[recordId]?.[field.id] ?? null;
		}

		async function entriesOf(field: { id: string }) {
			const section = await readCustomFieldSection(db, {
				organizationId: ids.organization,
				entity: "employee",
				recordId: employeeId,
				level: "admin",
			});
			return section.history[field.id] ?? [];
		}

		it("reads the value as of a date from the valid-from history", async () => {
			const grade = await define(ids.organization, { name: "Pay grade", tracked: true });
			await write("employee", employeeId, {
				[grade.id]: history(add("2026-03-01", "E5"), add("2026-07-01", "E6")),
			});

			expect(await readAsOf(grade, "2026-02-28")).toBeNull();
			expect(await readAsOf(grade, "2026-03-01")).toEqual({ type: "text", value: "E5" });
			expect(await readAsOf(grade, "2026-06-30")).toEqual({ type: "text", value: "E5" });
			expect(await readAsOf(grade, "2026-07-01")).toEqual({ type: "text", value: "E6" });
			expect(await readAsOf(grade, "2030-01-01")).toEqual({ type: "text", value: "E6" });
		});

		it("returns a back-dated change entered later from its valid-from date on", async () => {
			const grade = await define(ids.organization, {
				entity: "project",
				name: "Rate class",
				tracked: true,
			});
			await write("project", projectId, { [grade.id]: history(add("2026-07-01", "B")) });
			await write("project", projectId, { [grade.id]: history(add("2026-03-01", "A")) });

			expect(await readAsOf(grade, "2026-02-28", "project", projectId)).toBeNull();
			expect(await readAsOf(grade, "2026-03-01", "project", projectId)).toEqual({
				type: "text",
				value: "A",
			});
			expect(await readAsOf(grade, "2026-06-30", "project", projectId)).toEqual({
				type: "text",
				value: "A",
			});
			expect(await readAsOf(grade, "2026-07-01", "project", projectId)).toEqual({
				type: "text",
				value: "B",
			});
		});

		it("rejects two entries with the same valid-from date for one record and field", async () => {
			const grade = await define(ids.organization, { name: "Pay grade", tracked: true });
			await write("employee", employeeId, { [grade.id]: history(add("2026-03-01", "E5")) });
			expect(
				await refusal(
					write("employee", employeeId, { [grade.id]: history(add("2026-03-01", "E6")) }),
				),
			).toBe("duplicate_valid_from");
			// Another record may use the same date.
			expect(
				await refusal(
					write("employee", managerEmployeeId, { [grade.id]: history(add("2026-03-01", "E6")) }),
				),
			).toBe("accepted");

			await expect(
				admin.query(
					`insert into custom_field_value (organization_id, definition_id, employee_id, text_value, valid_from, tracked)
					 values ($1, $2, $3, 'E7', '2026-03-01', true)`,
					[ids.organization, grade.id, employeeId],
				),
			).rejects.toThrow(/custom_field_value_employee_dated_unique/);
		});

		it("lists the history newest first and corrects and deletes entries, audited", async () => {
			const grade = await define(ids.organization, { name: "Pay grade", tracked: true });
			await write("employee", employeeId, {
				[grade.id]: history(add("2026-03-01", "E5"), add("2026-07-01", "E6")),
			});
			const [july, march] = await entriesOf(grade);
			expect([july, march].map((entry) => [entry.validFrom, entry.value])).toEqual([
				["2026-07-01", { type: "text", value: "E6" }],
				["2026-03-01", { type: "text", value: "E5" }],
			]);

			await write("employee", employeeId, {
				[grade.id]: history(
					{ op: "correct", entryId: march.id, validFrom: "2026-02-01", value: "E4" },
					{ op: "delete", entryId: july.id },
				),
			});
			expect(await entriesOf(grade)).toEqual([
				{ id: march.id, validFrom: "2026-02-01", value: { type: "text", value: "E4" } },
			]);
			expect(await readAsOf(grade, "2026-08-01")).toEqual({ type: "text", value: "E4" });

			const entries = await audit();
			expect(entries.map((entry) => entry.action)).toEqual([
				"custom_field_value.history_added",
				"custom_field_value.history_added",
				"custom_field_value.history_corrected",
				"custom_field_value.history_deleted",
			]);
			expect(entries.every((entry) => entry.entity_id === employeeId)).toBe(true);
			expect(entries[2].changes).toEqual({
				before: { validFrom: "2026-03-01", value: "E5" },
				after: { validFrom: "2026-02-01", value: "E4" },
			});
			expect(entries[2].metadata).toMatchObject({
				fieldId: grade.id,
				fieldName: "Pay grade",
				entryId: march.id,
				entity: "employee",
			});
			expect(entries[3].changes).toEqual({
				before: { validFrom: "2026-07-01", value: "E6" },
				after: null,
			});
		});

		it("refuses history changes below the field's edit level", async () => {
			const grade = await define(ids.organization, {
				name: "Pay grade",
				tracked: true,
				visibility: "manager",
				editLevel: "admin",
			});
			await write("employee", employeeId, { [grade.id]: history(add("2026-03-01", "E5")) });
			const [entry] = await entriesOf(grade);
			for (const change of [
				add("2026-04-01", "E6"),
				{ op: "correct", entryId: entry.id, validFrom: "2026-03-01", value: "E9" },
				{ op: "delete", entryId: entry.id },
			]) {
				expect(
					await refusal(
						write("employee", employeeId, { [grade.id]: history(change) }, { level: "manager" }),
					),
				).toBe("not_editable");
			}
			expect(await entriesOf(grade)).toHaveLength(1);
		});

		it("counts a required tracked field whose only value starts in the future as missing today", async () => {
			const grade = await define(ids.organization, {
				name: "Pay grade",
				tracked: true,
				required: true,
			});
			const future = history(add("2999-01-01", "E9"));
			expect(
				await refusal(
					write("employee", employeeId, { [grade.id]: future }, { requireComplete: true }),
				),
			).toBe("missing_required");
			await write("employee", employeeId, { [grade.id]: future });
			const section = await readCustomFieldSection(db, {
				organizationId: ids.organization,
				entity: "employee",
				recordId: employeeId,
				level: "admin",
			});
			expect(section.missingRequiredFieldIds).toEqual([grade.id]);
			expect(section.values[grade.id]).toBeUndefined();

			expect(
				await refusal(
					write(
						"employee",
						employeeId,
						{ [grade.id]: history(add("2020-01-01", "E1")) },
						{ requireComplete: true },
					),
				),
			).toBe("accepted");
			expect(
				(
					await readCustomFieldSection(db, {
						organizationId: ids.organization,
						entity: "employee",
						recordId: employeeId,
						level: "admin",
					})
				).missingRequiredFieldIds,
			).toEqual([]);
		});

		it("keeps plain values for untracked fields and dated changes for tracked ones", async () => {
			const grade = await define(ids.organization, { name: "Pay grade", tracked: true });
			const desk = await define(ids.organization, { name: "Desk" });
			expect(await refusal(write("employee", employeeId, { [grade.id]: "E5" }))).toBe(
				"tracked_field",
			);
			expect(
				await refusal(
					write("employee", employeeId, { [desk.id]: history(add("2026-03-01", "4.12")) }),
				),
			).toBe("invalid_value");
			await write("employee", employeeId, { [desk.id]: "4.12" });
			expect(await readAsOf(desk, "1990-01-01")).toEqual({ type: "text", value: "4.12" });
			expect(await readAsOf(desk, "2999-01-01")).toEqual({ type: "text", value: "4.12" });
		});

		it("requires a valid-from date on tracked values and none on untracked ones", async () => {
			const grade = await define(ids.organization, { name: "Pay grade", tracked: true });
			const desk = await define(ids.organization, { name: "Desk" });
			const insert = (definitionId: string, validFrom: string | null, tracked: boolean) =>
				admin.query(
					`insert into custom_field_value (organization_id, definition_id, employee_id, text_value, valid_from, tracked)
					 values ($1, $2, $3, 'x', $4, $5)`,
					[ids.organization, definitionId, employeeId, validFrom, tracked],
				);
			await expect(insert(grade.id, null, true)).rejects.toThrow(
				/custom_field_value_valid_from_check/,
			);
			await expect(insert(desk.id, "2026-03-01", false)).rejects.toThrow(
				/custom_field_value_valid_from_check/,
			);
			// The flag can't disagree with the field's.
			await expect(insert(grade.id, null, false)).rejects.toThrow(
				/custom_field_value_definition_fk/,
			);
			await expect(insert(desk.id, "2026-03-01", true)).rejects.toThrow(
				/custom_field_value_definition_fk/,
			);
		});
	});

	describe("viewer level", () => {
		it("resolves org admins, employee roles, custom role base roles and no access", async () => {
			const level = (userId: string) =>
				loadCustomFieldViewerLevel(db, { organizationId: ids.organization, userId });
			expect(await level(ids.admin)).toBe("admin");
			expect(await level(ids.manager)).toBe("manager");
			expect(await level(ids.member)).toBe("employee");
			expect(await level(ids.customRoleMember)).toBe("manager");
			expect(await level(ids.inactive)).toBeNull();
			expect(await level(ids.otherOwner)).toBeNull();
		});
	});

	describe("database guarantees", () => {
		it("refuses a value that points at a record or field of another organization", async () => {
			const field = await define(ids.organization, { name: "Desk" });
			const foreignField = await define(ids.other, { name: "Foreign" });
			await expect(
				admin.query(
					`insert into custom_field_value (organization_id, definition_id, employee_id, text_value)
					 values ($1, $2, $3, 'x')`,
					[ids.organization, field.id, otherEmployeeId],
				),
			).rejects.toThrow(/custom_field_value_employee_fk/);
			await expect(
				admin.query(
					`insert into custom_field_value (organization_id, definition_id, project_id, text_value)
					 values ($1, $2, $3, 'x')`,
					[ids.organization, field.id, otherProjectId],
				),
			).rejects.toThrow(/custom_field_value_project_fk/);
			await expect(
				admin.query(
					`insert into custom_field_value (organization_id, definition_id, employee_id, text_value)
					 values ($1, $2, $3, 'x')`,
					[ids.organization, foreignField.id, employeeId],
				),
			).rejects.toThrow(/custom_field_value_definition_fk/);
		});

		it("refuses an option of another field, two records, two values and a second undated value", async () => {
			const select = await define(ids.organization, {
				name: "Tier",
				type: "select",
				options: ["Gold"],
			});
			const other = await define(ids.organization, {
				name: "Other",
				type: "select",
				options: ["Bronze"],
			});
			await expect(
				admin.query(
					`insert into custom_field_value (organization_id, definition_id, employee_id, select_option_id)
					 values ($1, $2, $3, $4)`,
					[ids.organization, select.id, employeeId, other.options[0].id],
				),
			).rejects.toThrow(/custom_field_value_select_option_fk/);
			await expect(
				admin.query(
					`insert into custom_field_value (organization_id, definition_id, employee_id, project_id, select_option_id)
					 values ($1, $2, $3, $4, $5)`,
					[ids.organization, select.id, employeeId, projectId, select.options[0].id],
				),
			).rejects.toThrow(/custom_field_value_one_record_check/);
			await expect(
				admin.query(
					`insert into custom_field_value (organization_id, definition_id, employee_id, text_value, select_option_id)
					 values ($1, $2, $3, 'x', $4)`,
					[ids.organization, select.id, employeeId, select.options[0].id],
				),
			).rejects.toThrow(/custom_field_value_one_value_check/);
			const insert = () =>
				admin.query(
					`insert into custom_field_value (organization_id, definition_id, employee_id, select_option_id)
					 values ($1, $2, $3, $4)`,
					[ids.organization, select.id, employeeId, select.options[0].id],
				);
			await insert();
			await expect(insert()).rejects.toThrow(/custom_field_value_employee_undated_unique/);
		});

		it("deletes a project's and a customer's values with the record", async () => {
			const projectField = await define(ids.organization, { entity: "project", name: "PO" });
			const customerField = await define(ids.organization, { entity: "customer", name: "No" });
			await write("project", projectId, { [projectField.id]: "PO-1" });
			await write("customer", customerId, { [customerField.id]: "C-1" });
			await admin.query("delete from project where id = $1", [projectId]);
			await admin.query("delete from customer where id = $1", [customerId]);
			const { rows } = await admin.query(
				"select count(*)::int as count from custom_field_value where organization_id = $1",
				[ids.organization],
			);
			expect(rows[0].count).toBe(0);
		});
	});
});
