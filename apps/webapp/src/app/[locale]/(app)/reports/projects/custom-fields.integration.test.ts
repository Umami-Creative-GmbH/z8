/**
 * #820: the detailed project report shows the project's customer and the
 * project's and the customer's custom fields the reader's base role sees, with
 * values as of the period's last day, on PostgreSQL. The real server action
 * runs; only the session, SSO store and logger are replaced.
 */

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { integrationAdminPool } from "@/test/integration-database";

const harness = vi.hoisted(() => ({ userId: null as string | null }));

vi.mock("next/headers", async () => (await import("@/test/integration-harness")).nextHeaders());

vi.mock("next/server", async (importOriginal) =>
	(await import("@/test/integration-harness")).nextServer(importOriginal),
);

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
								id: `t820p-session-${harness.userId}`,
								userId: harness.userId,
								activeOrganizationId: "t820p-org",
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

vi.mock("@/lib/billing/guard", async () =>
	(await import("@/test/integration-harness")).billingGuard(),
);

vi.mock("@/lib/logger", () => ({
	createLogger: () => ({
		error: () => {},
		warn: () => {},
		info: () => {},
		debug: () => {},
		child: () => ({ error: () => {}, warn: () => {}, info: () => {}, debug: () => {} }),
	}),
}));

const { db } = await import("@/db");
const { changeCustomFields } = await import("@/lib/organization/custom-fields/definitions");
const { writeCustomFieldValues } = await import("@/lib/organization/custom-fields/values");
const { getProjectDetailedReport } = await import("./actions");

const ids = {
	organization: "t820p-org",
	other: "t820p-other-org",
	ownerUser: "t820p-owner",
	managerUser: "t820p-manager",
	pmUser: "t820p-pm",
	otherUser: "t820p-other",
	owner: "82000000-0000-4000-8000-000000000001",
	manager: "82000000-0000-4000-8000-000000000002",
	pm: "82000000-0000-4000-8000-000000000003",
	otherEmployee: "82000000-0000-4000-8000-000000000004",
	customer: "82000000-0000-4000-8000-0000000000c1",
	website: "82000000-0000-4000-8000-0000000000a1",
	internal: "82000000-0000-4000-8000-0000000000a2",
} as const;
const users = [ids.ownerUser, ids.managerUser, ids.pmUser, ids.otherUser];

async function report(userId: string, projectId: string, end = "2026-03-31") {
	harness.userId = userId;
	const result = await getProjectDetailedReport(
		projectId,
		new Date("2026-03-01"),
		new Date(end),
	);
	if (!result.success) throw new Error(result.error);
	return result.data;
}

const names = (fields: { name: string }[] | undefined) => fields?.map((field) => field.name);

describe("project report custom fields on PostgreSQL", () => {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
	const admin = integrationAdminPool();

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
			actorUserId: organizationId === ids.other ? ids.otherUser : ids.ownerUser,
			change: {
				kind: "create",
				entity: "project",
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
			(f) => f.name === change.name && f.entity === (change.entity ?? "project") && !f.archived,
		);
		if (!field) throw new Error("field missing");
		return field;
	}

	async function write(
		entity: "project" | "customer",
		recordId: string,
		values: Record<string, unknown>,
	) {
		await db.transaction((tx) =>
			writeCustomFieldValues(tx, {
				organizationId: ids.organization,
				actorUserId: ids.ownerUser,
				level: "admin",
				entity,
				recordId,
				values,
				requireComplete: false,
			}),
		);
	}

	beforeEach(async () => {
		await cleanup();
		await admin.query(
			`insert into organization (id, name, slug, timezone, projects_enabled, created_at)
			 values ($1, 'T820P', $1, 'UTC', true, now()), ($2, 'T820P other', $2, 'UTC', true, now())`,
			[ids.organization, ids.other],
		);
		await admin.query(
			`insert into "user" (id, name, email, created_at, updated_at)
			 select user_id, user_id, user_id || '@example.test', now(), now() from unnest($1::text[]) as user_id`,
			[users],
		);
		await admin.query(
			`insert into member (id, organization_id, user_id, role, status, created_at) values
			 ('t820p-m-owner', $1, $3, 'owner', 'approved', now()),
			 ('t820p-m-manager', $1, $4, 'member', 'approved', now()),
			 ('t820p-m-pm', $1, $5, 'member', 'approved', now()),
			 ('t820p-m-other', $2, $6, 'owner', 'approved', now())`,
			[ids.organization, ids.other, ids.ownerUser, ids.managerUser, ids.pmUser, ids.otherUser],
		);
		await admin.query(
			`insert into employee (id, user_id, organization_id, role, updated_at) values
			 ($1, $2, $9, 'admin', now()),
			 ($3, $4, $9, 'manager', now()),
			 ($5, $6, $9, 'employee', now()),
			 ($7, $8, $10, 'admin', now())`,
			[
				ids.owner,
				ids.ownerUser,
				ids.manager,
				ids.managerUser,
				ids.pm,
				ids.pmUser,
				ids.otherEmployee,
				ids.otherUser,
				ids.organization,
				ids.other,
			],
		);
		await admin.query(
			`insert into customer (id, organization_id, name, created_by, updated_at)
			 values ($1, $2, 'Acme', $3, now())`,
			[ids.customer, ids.organization, ids.ownerUser],
		);
		await admin.query(
			`insert into project (id, organization_id, name, status, customer_id, created_by, updated_at) values
			 ($1, $3, 'Website', 'active', $4, $5, now()),
			 ($2, $3, 'Internal', 'active', null, $5, now())`,
			[ids.website, ids.internal, ids.organization, ids.customer, ids.ownerUser],
		);
		await admin.query(
			`insert into project_manager (project_id, employee_id, assigned_by) values ($1, $2, $3)`,
			[ids.website, ids.pm, ids.ownerUser],
		);
	});
	afterAll(cleanup);

	it("shows the customer and the project's and customer's fields the reader sees", async () => {
		const budgetCode = await define(ids.organization, {
			name: "Budget code",
			visibility: "admin",
			editLevel: "admin",
		});
		const phase = await define(ids.organization, {
			name: "Phase",
			type: "select",
			options: ["Discovery", "Delivery"],
		});
		const kickoff = await define(ids.organization, {
			name: "Kickoff",
			type: "date",
			visibility: "employee",
		});
		const retired = await define(ids.organization, { name: "Retired" });
		const accountTier = await define(ids.organization, {
			entity: "customer",
			name: "Account tier",
			visibility: "admin",
			editLevel: "admin",
		});
		const region = await define(ids.organization, { entity: "customer", name: "Region" });
		await define(ids.other, { name: "Foreign field", visibility: "employee" });
		await write("project", ids.website, {
			[budgetCode.id]: "BC-9",
			[phase.id]: phase.options[1].id,
			[kickoff.id]: "2026-02-02",
			[retired.id]: "old",
		});
		await write("customer", ids.customer, { [accountTier.id]: "A", [region.id]: "DACH" });
		await changeCustomFields(db, {
			organizationId: ids.organization,
			actorUserId: ids.ownerUser,
			change: { kind: "archive", fieldId: retired.id },
		});

		const ownerView = await report(ids.ownerUser, ids.website);
		expect(ownerView.project.customer?.name).toBe("Acme");
		expect(ownerView.project.customFields).toEqual([
			{ fieldId: budgetCode.id, name: "Budget code", type: "text", value: "BC-9" },
			{ fieldId: phase.id, name: "Phase", type: "select", value: "Delivery" },
			{ fieldId: kickoff.id, name: "Kickoff", type: "date", value: "2026-02-02" },
		]);
		expect(ownerView.project.customer?.customFields).toEqual([
			{ fieldId: accountTier.id, name: "Account tier", type: "text", value: "A" },
			{ fieldId: region.id, name: "Region", type: "text", value: "DACH" },
		]);

		// A manager never sees admin-only fields.
		const managerView = await report(ids.managerUser, ids.website);
		expect(names(managerView.project.customFields)).toEqual(["Phase", "Kickoff"]);
		expect(names(managerView.project.customer?.customFields)).toEqual(["Region"]);

		// A project manager whose base role is employee sees employee-visible fields only.
		const pmView = await report(ids.pmUser, ids.website);
		expect(names(pmView.project.customFields)).toEqual(["Kickoff"]);
		expect(pmView.project.customer?.customFields).toEqual([]);
	});

	it("shows no customer fields for a project without a customer", async () => {
		await define(ids.organization, { entity: "customer", name: "Region" });
		const phase = await define(ids.organization, { name: "Phase" });

		const view = await report(ids.ownerUser, ids.internal);
		expect(view.project.customer).toBeNull();
		expect(view.project.customFields).toEqual([
			{ fieldId: phase.id, name: "Phase", type: "text", value: null },
		]);
	});

	it("reads tracked values as of the period's last day", async () => {
		const stage = await define(ids.organization, { name: "Stage", tracked: true });
		await admin.query(
			`insert into custom_field_value
			 (organization_id, definition_id, project_id, text_value, valid_from, created_by, updated_by)
			 values ($1, $2, $3, 'Draft', '2026-03-01', $4, $4), ($1, $2, $3, 'Live', '2026-03-20', $4, $4)`,
			[ids.organization, stage.id, ids.website, ids.ownerUser],
		);

		expect((await report(ids.ownerUser, ids.website, "2026-03-15")).project.customFields).toEqual([
			{ fieldId: stage.id, name: "Stage", type: "text", value: "Draft" },
		]);
		expect((await report(ids.ownerUser, ids.website)).project.customFields?.[0]?.value).toBe(
			"Live",
		);
	});
});
