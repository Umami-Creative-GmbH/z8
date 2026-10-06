/**
 * #605: expense project attribution from historical eligibility.
 *
 * The real report, project and exception actions, the submission owner and
 * the database triggers that capture assignment history run against a
 * disposable PostgreSQL database. Only the session, notifications and object
 * storage are replaced. History intervals are backdated directly where a test
 * needs history from before the run.
 */

import type { NextRequest } from "next/server";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { integrationAdminPool } from "@/test/integration-database";

const harness = vi.hoisted(() => ({
	userId: null as string | null,
	organizationId: "t605-org",
	tus: new Map<string, Buffer>(),
	objects: new Map<string, Buffer>(),
}));
vi.mock("next/headers", async () => (await import("@/test/integration-harness")).nextHeaders());
vi.mock("next/server", async (original) =>
	(await import("@/test/integration-harness")).nextServer(original),
);
vi.mock("next/cache", async (original) =>
	(await import("@/test/integration-harness")).nextCache(original),
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
vi.mock("@/lib/notifications/triggers", async (original) => ({
	...(await original<typeof import("@/lib/notifications/triggers")>()),
	onTravelExpenseReportDecided: async () => {},
}));
vi.mock("@/lib/storage/s3-client", () => ({
	S3_PUBLIC_BUCKET: "t605-public",
	s3Client: {
		async send(command: { input: { Key: string } }) {
			if (command.constructor.name === "DeleteObjectCommand") {
				harness.tus.delete(command.input.Key);
				return {};
			}
			const bytes = harness.tus.get(command.input.Key);
			if (!bytes) throw new Error("NoSuchKey");
			return {
				ContentLength: bytes.length,
				Body: { transformToByteArray: async () => new Uint8Array(bytes) },
			};
		},
	},
}));
vi.mock("@/lib/storage/export-s3-client", () => ({
	async uploadPrivateObject(_organizationId: string, key: string, data: Buffer) {
		harness.objects.set(key, Buffer.from(data));
		return { bucket: "t605-private", versionId: `v-${key.length}` };
	},
	async readPrivateObject(input: { key: string }) {
		const bytes = harness.objects.get(input.key);
		if (!bytes) throw new Error("NoSuchKey");
		return bytes;
	},
	async deletePrivateObject(input: { key: string }) {
		harness.objects.delete(input.key);
	},
}));

const actions = await import("@/app/[locale]/(app)/travel-expenses/report-actions");
const projectActions = await import("@/app/[locale]/(app)/travel-expenses/report-project-actions");
const exceptionActions = await import(
	"@/app/[locale]/(app)/settings/travel-expenses/project-exception-actions"
);
const { POST: processReceipt } = await import(
	"@/app/api/upload/travel-expense/report-receipt/route"
);
const { createOwnedTusFileKey } = await import("@/lib/upload/tus-ownership");
const { db } = await import("@/db");
const { loadTravelExpenseReportSubmittedRevision } = await import(
	"@/lib/approvals/evidence/travel-expense-report-store"
);
const { compareTravelExpenseReportWithSubmittedRevision } = await import(
	"@/lib/approvals/evidence/travel-expense-report-submission"
);

const ids = {
	requester: "e6050000-0000-4000-8000-000000000001",
	manager: "e6050000-0000-4000-8000-000000000002",
	admin: "e6050000-0000-4000-8000-000000000003",
	foreigner: "e6050000-0000-4000-8000-000000000004",
	team: "e6051000-0000-4000-8000-000000000001",
	direct: "e6052000-0000-4000-8000-000000000001",
	closed: "e6052000-0000-4000-8000-000000000002",
	teamProject: "e6052000-0000-4000-8000-000000000003",
	unassigned: "e6052000-0000-4000-8000-000000000004",
	foreignProject: "e6052000-0000-4000-8000-000000000005",
} as const;
type Person = "requester" | "manager" | "admin" | "foreigner";

const admin = integrationAdminPool();
const pdfBytes = Buffer.from("%PDF-1.4\n% receipt\n%%EOF");

async function cleanup() {
	await admin.query("delete from organization where id in ('t605-org', 't605-foreign')");
	await admin.query(
		"delete from travel_expense_receipt_upload where organization_id like 't605-%'",
	);
	await admin.query('delete from "user" where id like $1', ["t605-%"]);
}

async function seed() {
	await cleanup();
	await admin.query(
		`insert into organization (id, name, slug, timezone, created_at) values
		 ('t605-org','Expenses','t605-org','Europe/Berlin',now()),
		 ('t605-foreign','Foreign','t605-foreign','UTC',now())`,
	);
	const people: Array<[Person, string, string, string]> = [
		["requester", ids.requester, "t605-org", "employee"],
		["manager", ids.manager, "t605-org", "manager"],
		["admin", ids.admin, "t605-org", "admin"],
		["foreigner", ids.foreigner, "t605-foreign", "admin"],
	];
	for (const [name, employeeId, organizationId, role] of people) {
		await admin.query(
			'insert into "user" (id,name,email,created_at,updated_at) values ($1,$2,$3,now(),now())',
			[`t605-${name}`, name, `t605-${name}@example.test`],
		);
		await admin.query(
			"insert into member (id,organization_id,user_id,role,status,created_at) values ($1,$2,$3,$4,'approved',now())",
			[
				`t605-member-${name}`,
				organizationId,
				`t605-${name}`,
				role === "admin" ? "admin" : "member",
			],
		);
		await admin.query(
			"insert into employee (id,user_id,organization_id,role,updated_at) values ($1,$2,$3,$4,now())",
			[employeeId, `t605-${name}`, organizationId, role],
		);
	}
	await admin.query(
		`insert into employee_managers (id, employee_id, manager_id, is_primary, assigned_by, assigned_at, created_at)
		 values (gen_random_uuid(), $1, $2, true, 't605-manager', now(), now())`,
		[ids.requester, ids.manager],
	);
	await admin.query(
		"insert into team (id, organization_id, name, updated_at) values ($1, 't605-org', 'Field team', now())",
		[ids.team],
	);
	const projects: Array<[string, string, string, string]> = [
		[ids.direct, "t605-org", "Hamburg rollout", "active"],
		[ids.closed, "t605-org", "Closed audit", "active"],
		[ids.teamProject, "t605-org", "Team support", "active"],
		[ids.unassigned, "t605-org", "Legacy migration", "active"],
		[ids.foreignProject, "t605-foreign", "Foreign project", "active"],
	];
	for (const [id, organizationId, name, status] of projects) {
		await admin.query(
			`insert into project (id, organization_id, name, status, is_active, created_by, updated_at)
			 values ($1, $2, $3, $4, true, 't605-admin', now())`,
			[id, organizationId, name, status],
		);
	}
}

async function assign(projectId: string, target: { employeeId: string } | { teamId: string }) {
	const { rows } = await admin.query<{ id: string }>(
		`insert into project_assignment (id, project_id, organization_id, assignment_type, employee_id, team_id, created_by)
		 values (gen_random_uuid(), $1, 't605-org', $2, $3, $4, 't605-admin') returning id`,
		[
			projectId,
			"teamId" in target ? "team" : "employee",
			"employeeId" in target ? target.employeeId : null,
			"teamId" in target ? target.teamId : null,
		],
	);
	return rows[0]?.id as string;
}

/** Moves the start of every open history interval of a project back in time. */
async function backdateProjectHistory(projectId: string, from: string) {
	await admin.query(
		"update project_assignment_history set effective_from = $2 where project_id = $1 and effective_to is null",
		[projectId, from],
	);
}

function signIn(name: Person) {
	harness.userId = `t605-${name}`;
	harness.organizationId = name === "foreigner" ? "t605-foreign" : "t605-org";
}

async function load(reportId: string) {
	signIn("requester");
	const loaded = await actions.getMyTravelExpenseReport(reportId);
	if (!loaded.success) throw new Error(loaded.error);
	return loaded.data;
}

async function upload(reportId: string, itemId: string) {
	signIn("requester");
	const tusFileKey = createOwnedTusFileKey("t605-requester");
	harness.tus.set(tusFileKey, pdfBytes);
	return processReceipt(
		new Request("http://localhost/api/upload/travel-expense/report-receipt", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ tusFileKey, reportId, itemId, fileName: "receipt.pdf" }),
		}) as unknown as NextRequest,
	);
}

async function addExpense(reportId: string, expenseDate: string) {
	signIn("requester");
	const added = await actions.addTripReportItemAction({ reportId });
	if (!added.success) throw new Error("add failed");
	const saved = await actions.saveReceiptItemDraftAction({
		reportId,
		itemId: added.data.item.id,
		expectedVersion: added.data.item.version,
		values: {
			expenseDate,
			category: "transport",
			description: `Train on ${expenseDate}`,
			amount: "89.90",
			currency: "EUR",
			paidBy: "employee",
			accountingReference: null,
		},
	});
	if (!saved.success || saved.data.status !== "saved") throw new Error("save failed");
	expect((await upload(reportId, added.data.item.id)).status).toBe(200);
	return added.data.item.id;
}

/** A complete trip in January 2026 with one expense per date. */
async function trip(dates: string[]) {
	signIn("requester");
	const created = await actions.createTripReportAction();
	if (!created.success) throw new Error(created.error);
	const reportId = created.data.reportId;
	const report = await load(reportId);
	const details = await actions.saveTripDetailsDraftAction({
		reportId,
		expectedVersion: report.trip?.version ?? 1,
		values: {
			purpose: "Customer workshop",
			startDate: dates[0] ?? "2026-01-15",
			endDate: dates.at(-1) ?? "2026-01-15",
			timeZone: "Europe/Berlin",
			destinations: [{ place: "Hamburg", countryCode: "DE" }],
		},
	});
	if (!details.success) throw new Error("details failed");
	const itemIds: string[] = [];
	for (const date of dates) itemIds.push(await addExpense(reportId, date));
	return { reportId, itemIds };
}

async function chooseItemProject(
	reportId: string,
	itemId: string,
	choice: { mode: "inherit" } | { mode: "none" } | { mode: "project"; projectId: string },
) {
	const report = await load(reportId);
	const item = report.items.find((candidate) => candidate.id === itemId);
	signIn("requester");
	return projectActions.saveItemProjectAction({
		reportId,
		itemId,
		expectedVersion: item?.version ?? 0,
		choice,
	});
}

async function chooseTripProject(reportId: string, projectId: string | null) {
	const report = await load(reportId);
	signIn("requester");
	return projectActions.saveTripProjectAction({
		reportId,
		expectedVersion: report.trip?.version ?? 0,
		projectId,
	});
}

async function choices(reportId: string, date: string) {
	signIn("requester");
	const result = await projectActions.getReportProjectChoicesAction({
		reportId,
		from: date,
		to: date,
		selectedProjectId: null,
	});
	if (!result.success) throw new Error(result.error);
	return result.data.choices.map((choice) => [choice.name, choice.basis]);
}

async function submit(reportId: string) {
	const report = await load(reportId);
	signIn("requester");
	return actions.submitTravelExpenseReportAction({
		reportId,
		reviewed: {
			detailsVersion: report.trip?.version ?? null,
			items: report.items.map((item) => ({
				id: item.id,
				version: item.version,
				receiptIds: item.receipts.map((receipt) => receipt.id),
			})),
		},
	});
}

async function frozenProjects(reportId: string) {
	const revision = await loadTravelExpenseReportSubmittedRevision(db, {
		organizationId: "t605-org",
		reportId,
	});
	if (!revision) throw new Error("no revision");
	return { revision, projects: revision.facts.items.map((item) => item.project ?? null) };
}

async function authorizeException(input: {
	projectId: string;
	validFrom: string;
	validTo: string;
	reason?: string;
	evidence?: string;
	employeeId?: string;
}) {
	return exceptionActions.authorizeProjectAttributionExceptionAction({
		employeeId: input.employeeId ?? ids.requester,
		projectId: input.projectId,
		validFrom: input.validFrom,
		validTo: input.validTo,
		reason: input.reason ?? "Staffed on the project before assignments were recorded",
		evidence: input.evidence ?? "Staffing plan January 2026, signed by the project lead",
	});
}

describe("expense project attribution (#605)", () => {
	beforeEach(async () => {
		await seed();
	});
	afterAll(async () => {
		await cleanup();
	});

	it("records assignment and team history from every writer, cascades included", async () => {
		const assignmentId = await assign(ids.direct, { employeeId: ids.requester });
		await assign(ids.teamProject, { teamId: ids.team });
		await admin.query("update employee set team_id = $2 where id = $1", [ids.requester, ids.team]);
		await admin.query("delete from project_assignment where id = $1", [assignmentId]);
		// Deleting the team cascades its assignments and clears the employee's team.
		await admin.query("delete from team where id = $1", [ids.team]);

		const { rows: assignments } = await admin.query(
			`select project_id, assignment_type, employee_id, team_id, effective_to is not null as closed
			 from project_assignment_history where organization_id = 't605-org' order by project_id`,
		);
		expect(assignments).toEqual([
			{
				project_id: ids.direct,
				assignment_type: "employee",
				employee_id: ids.requester,
				team_id: null,
				closed: true,
			},
			{
				project_id: ids.teamProject,
				assignment_type: "team",
				employee_id: null,
				team_id: ids.team,
				closed: true,
			},
		]);
		const { rows: memberships } = await admin.query(
			`select team_id, effective_to is not null as closed from employee_team_history
			 where employee_id = $1`,
			[ids.requester],
		);
		expect(memberships).toEqual([{ team_id: ids.team, closed: true }]);
	});

	it("never treats a current assignment as proof of an earlier expense date", async () => {
		await assign(ids.direct, { employeeId: ids.requester });
		const { reportId, itemIds } = await trip(["2026-01-15"]);

		expect(await choices(reportId, "2026-01-15")).toEqual([]);
		expect(
			await chooseItemProject(reportId, itemIds[0] as string, {
				mode: "project",
				projectId: ids.direct,
			}),
		).toEqual({ success: true, data: { status: "refused", reason: "ineligible" } });
	});

	it("keeps a proven assignment to a later closed project eligible and freezes its names", async () => {
		await assign(ids.closed, { employeeId: ids.requester });
		await backdateProjectHistory(ids.closed, "2026-01-01T00:00:00Z");
		await admin.query("update project set status = 'completed', is_active = false where id = $1", [
			ids.closed,
		]);
		const { reportId, itemIds } = await trip(["2026-01-15"]);

		expect(await choices(reportId, "2026-01-15")).toEqual([
			["Closed audit", "employee_assignment"],
		]);
		expect(
			await chooseItemProject(reportId, itemIds[0] as string, {
				mode: "project",
				projectId: ids.closed,
			}),
		).toMatchObject({ success: true, data: { status: "saved" } });
		expect(await submit(reportId)).toEqual({ success: true, data: { status: "submitted" } });

		await admin.query("update project set name = 'Renamed audit' where id = $1", [ids.closed]);
		await admin.query("delete from project_assignment where project_id = $1", [ids.closed]);
		const { revision, projects } = await frozenProjects(reportId);
		// Frozen at the current version: v4 (#605) or later.
		expect(revision.facts.schemaVersion).toBeGreaterThanOrEqual(4);
		expect(projects).toEqual([
			{
				projectId: ids.closed,
				name: "Closed audit",
				customerId: null,
				customerName: null,
				inheritedFromTrip: false,
				basis: "employee_assignment",
			},
		]);
		// Renames and assignment changes never rewrite or hold the submitted facts.
		expect(await compareTravelExpenseReportWithSubmittedRevision(db, revision)).toEqual({
			kind: "current",
		});
	});

	it("proves a team project only while the employee was in that team", async () => {
		await assign(ids.teamProject, { teamId: ids.team });
		await backdateProjectHistory(ids.teamProject, "2026-01-01T00:00:00Z");
		await admin.query("update employee set team_id = $2 where id = $1", [ids.requester, ids.team]);
		await admin.query(
			"update employee_team_history set effective_from = '2026-02-01T00:00:00Z' where employee_id = $1",
			[ids.requester],
		);
		const { reportId } = await trip(["2026-01-15", "2026-02-15"]);

		expect(await choices(reportId, "2026-01-15")).toEqual([]);
		expect(await choices(reportId, "2026-02-15")).toEqual([["Team support", "team_assignment"]]);
	});

	it("inherits the trip project per expense, lets expenses override it and re-checks it at submission", async () => {
		await assign(ids.direct, { employeeId: ids.requester });
		await backdateProjectHistory(ids.direct, "2026-01-10T00:00:00Z");
		const { reportId, itemIds } = await trip(["2026-01-05", "2026-01-15"]);
		const [early, late] = itemIds as [string, string];

		// Eligible on some day of the trip, so the trip may name it.
		expect(await chooseTripProject(reportId, ids.direct)).toMatchObject({
			data: { status: "saved" },
		});
		// The early expense inherits a project not proven on its own date.
		expect(await submit(reportId)).toEqual({
			success: true,
			data: { status: "project_ineligible", itemIds: [early] },
		});
		expect(await chooseItemProject(reportId, early, { mode: "none" })).toMatchObject({
			data: { status: "saved" },
		});
		expect(await submit(reportId)).toEqual({ success: true, data: { status: "submitted" } });
		const { projects } = await frozenProjects(reportId);
		expect(projects).toEqual([
			null,
			expect.objectContaining({
				projectId: ids.direct,
				name: "Hamburg rollout",
				inheritedFromTrip: true,
				basis: "employee_assignment",
			}),
		]);
		expect(late).toBeTruthy();
	});

	it("accepts an authorized, evidenced exception for unproven dates and freezes it", async () => {
		const { reportId, itemIds } = await trip(["2026-01-15"]);
		signIn("admin");
		const authorized = await authorizeException({
			projectId: ids.unassigned,
			validFrom: "2026-01-01",
			validTo: "2026-01-31",
		});
		expect(authorized).toMatchObject({ success: true, data: { status: "authorized" } });

		expect(await choices(reportId, "2026-01-15")).toEqual([["Legacy migration", "exception"]]);
		expect(await choices(reportId, "2026-02-01")).toEqual([]);
		expect(
			await chooseItemProject(reportId, itemIds[0] as string, {
				mode: "project",
				projectId: ids.unassigned,
			}),
		).toMatchObject({ data: { status: "saved" } });
		expect(await submit(reportId)).toEqual({ success: true, data: { status: "submitted" } });
		const { projects } = await frozenProjects(reportId);
		expect(projects[0]).toMatchObject({
			projectId: ids.unassigned,
			basis: "exception",
			exception: {
				validFrom: "2026-01-01",
				validTo: "2026-01-31",
				reason: "Staffed on the project before assignments were recorded",
				evidence: "Staffing plan January 2026, signed by the project lead",
				authorizedByEmployeeId: ids.admin,
			},
		});
	});

	it("lets only an expense administrator authorize exceptions, never their own or unexplained ones", async () => {
		signIn("requester");
		expect(
			await authorizeException({
				projectId: ids.unassigned,
				validFrom: "2026-01-01",
				validTo: "2026-01-31",
			}),
		).toEqual({ success: false, error: "Unauthorized: Admin access required" });

		signIn("admin");
		expect(
			await authorizeException({
				employeeId: ids.admin,
				projectId: ids.unassigned,
				validFrom: "2026-01-01",
				validTo: "2026-01-31",
			}),
		).toMatchObject({ success: false });
		expect(
			await authorizeException({
				projectId: ids.unassigned,
				validFrom: "2026-01-01",
				validTo: "2026-01-31",
				reason: " ",
				evidence: "",
			}),
		).toEqual({ success: true, data: { status: "invalid", errors: ["reason", "evidence"] } });
		expect(
			await authorizeException({
				projectId: ids.unassigned,
				validFrom: "2026-01-01",
				validTo: "2099-01-31",
			}),
		).toEqual({ success: true, data: { status: "invalid", errors: ["future_dates"] } });
		expect(
			await authorizeException({
				projectId: ids.foreignProject,
				validFrom: "2026-01-01",
				validTo: "2026-01-31",
			}),
		).toEqual({ success: false, error: "Project not found" });
		expect(
			await authorizeException({
				employeeId: ids.foreigner,
				projectId: ids.unassigned,
				validFrom: "2026-01-01",
				validTo: "2026-01-31",
			}),
		).toEqual({ success: false, error: "Employee not found" });

		const { rows } = await admin.query(
			"select count(*)::int as count from travel_expense_project_attribution_exception",
		);
		expect(rows[0]?.count).toBe(0);
	});

	it("always rejects another organization's project", async () => {
		const { reportId, itemIds } = await trip(["2026-01-15"]);
		const itemId = itemIds[0] as string;
		expect(
			await chooseItemProject(reportId, itemId, { mode: "project", projectId: ids.foreignProject }),
		).toEqual({ success: true, data: { status: "refused", reason: "project_not_found" } });
		expect(await chooseTripProject(reportId, ids.foreignProject)).toEqual({
			success: true,
			data: { status: "refused", reason: "project_not_found" },
		});
		// The organization-scoped foreign keys refuse it even below the actions.
		await expect(
			admin.query(
				"update travel_expense_report_item set project_id = $2, project_inherits = false where id = $1",
				[itemId, ids.foreignProject],
			),
		).rejects.toThrow(/travel_expense_report_item_project_fk/);
	});
});
