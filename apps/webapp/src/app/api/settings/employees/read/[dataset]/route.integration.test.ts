import { randomUUID } from "node:crypto";
import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";
import { updateEmployeeAction } from "@/app/[locale]/(app)/settings/employees/employee-mutations.actions";
import { updateWorkPolicy } from "@/app/[locale]/(app)/settings/work-policies/actions";
import { ORGANIZATION_CONTEXT_HEADERS } from "@/lib/auth/organization-display-context";
import {
	createLifecycleDatabaseFixture,
	type LifecycleDatabaseFixture,
	type SeededEmployee,
} from "@/lib/employee-lifecycle/testing/database.test.fixture";
import type { EmployeeReadSnapshot } from "@/lib/organization/employee-read-types";
import { parseSuperJsonResponse } from "@/lib/superjson";
import { GET } from "./route";

const state = vi.hoisted(() => ({
	userId: null as string | null,
	organizationId: null as string | null,
	queries: [] as string[],
}));
vi.mock("next/server", async (original) =>
	(await import("@/test/integration-harness")).nextServer(original),
);
vi.mock("next/headers", async () =>
	(await import("@/test/integration-harness")).nextHeaders(),
);
vi.mock("next/cache", async (original) => ({
	...(await (await import("@/test/integration-harness")).nextCache(original)),
	// Vitest does not compile use-cache directives. This suite proves SQL/access,
	// not cache reuse; native cache hit/expiry proof runs in the compiled fixture.
	cacheLife: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({
	auth: {
		api: {
			getSession: async () =>
				state.userId
					? {
							user: {
								id: state.userId,
								name: "Employee reader fixture",
								email: "reader@example.test",
								role: "user",
							},
							session: {
								id: `read-${state.userId}`,
								userId: state.userId,
								activeOrganizationId: state.organizationId,
							},
						}
					: null,
		},
	},
}));
vi.mock("@/db", async () =>
	(await import("@/test/integration-database")).integrationDbModule({
		logQuery: (query) => state.queries.push(query),
	}),
);
vi.mock("@/tolgee/server", async () => ({
	getTranslate: async () =>
		(await import("@/lib/organization/custom-fields/refusal-messages"))
			.englishDefaults,
}));

function request(
	dataset: string,
	query = "",
	expectedUser = state.userId,
	expectedOrganization = state.organizationId,
) {
	return GET(
		new Request(
			`http://localhost/api/settings/employees/read/${dataset}?${query}`,
			{
				headers: {
					[ORGANIZATION_CONTEXT_HEADERS.user]: expectedUser ?? "",
					[ORGANIZATION_CONTEXT_HEADERS.organization]:
						expectedOrganization ?? "",
				},
			},
		),
		{ params: Promise.resolve({ dataset }) },
	);
}

describe("employee GET transport over authorized PostgreSQL readers", () => {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
	let fixture: LifecycleDatabaseFixture;
	let manager: SeededEmployee;
	let managed: SeededEmployee;
	let unrelated: SeededEmployee;
	let foreign: SeededEmployee;
	let foreignOrganizationId: string;
	let legacyAdmin: SeededEmployee;
	const policyId = randomUUID();
	const foreignPolicyId = randomUUID();
	const invitationId = randomUUID();
	const draftId = randomUUID();
	beforeAll(async () => {
		fixture = await createLifecycleDatabaseFixture();
		manager = await fixture.seedEmployee();
		managed = await fixture.seedEmployee();
		unrelated = await fixture.seedEmployee();
		foreignOrganizationId = await fixture.createOrganization();
		foreign = await fixture.seedEmployee({
			organizationId: foreignOrganizationId,
			role: "admin",
		});
		await fixture.seedEmployee({ role: "admin", isActive: false });
		legacyAdmin = await fixture.seedEmployee({
			role: "admin",
			withPeriod: false,
		});
		await fixture.pool.query(
			`delete from employee where id=$1 and organization_id=$2`,
			[legacyAdmin.employeeId, fixture.organizationId],
		);
		await fixture.pool.query(`update employee set role='manager' where id=$1`, [
			manager.employeeId,
		]);
		await fixture.pool.query(
			`update "user" set name='Managed Pat' where id=$1`,
			[managed.userId],
		);
		await fixture.pool.query(
			`insert into employee_managers (employee_id, manager_id, is_primary, assigned_by) values ($1,$2,true,$3)`,
			[managed.employeeId, manager.employeeId, fixture.ownerUserId],
		);
		await fixture.pool.query(
			`insert into work_policy (id, organization_id, name, regulation_enabled, created_by, updated_at) values ($1,$2,'Fixture policy',false,$3,now())`,
			[policyId, fixture.organizationId, fixture.ownerUserId],
		);
		await fixture.pool.query(
			`insert into work_policy (id, organization_id, name, regulation_enabled, created_by, updated_at) values ($1,$2,'Other organization policy',false,$3,now())`,
			[foreignPolicyId, foreignOrganizationId, foreign.userId],
		);
		await fixture.pool.query(
			`insert into employee_employment_history (employee_id, organization_id, employment_period_id, valid_from, contract_type, weekly_contract_minutes, review_state, created_by, updated_at) values ($1,$2,$3,'2026-01-01T00:00:00Z','fixed',2400,'confirmed',$4,now())`,
			[
				managed.employeeId,
				fixture.organizationId,
				managed.employmentPeriodId,
				fixture.ownerUserId,
			],
		);
		await fixture.pool.query(
			`insert into invitation (id, organization_id, email, role, status, expires_at, inviter_id) values ($1,$2,$3,'member','pending',now()+interval '7 days',$4)`,
			[
				invitationId,
				fixture.organizationId,
				`${invitationId}@example.test`,
				fixture.ownerUserId,
			],
		);
		await fixture.pool.query(
			`insert into employee_invitation_draft (id, invitation_id, organization_id, normalized_email, first_name, last_name) values ($1,$2,$3,$4,'Draft','Pat')`,
			[
				draftId,
				invitationId,
				fixture.organizationId,
				`${invitationId}@example.test`,
			],
		);
	});
	beforeEach(() => {
		state.userId = manager.userId;
		state.organizationId = fixture.organizationId;
		state.queries = [];
	});
	afterAll(async () => fixture?.close());

	it("keeps manager scope, directory filters and dates at the GET boundary", async () => {
		const response = await request(
			"directory",
			"status=current&limit=20&offset=0&search=Managed",
		);
		expect(response.status).toBe(200);
		expect(response.headers.get("cache-control")).toBe("private, no-store");
		const body =
			await parseSuperJsonResponse<EmployeeReadSnapshot<"directory">>(response);
		expect(body.scope).toEqual({
			userId: manager.userId,
			organizationId: fixture.organizationId,
		});
		expect(body.data.employees.map((employee) => employee.id)).toEqual([
			managed.employeeId,
		]);
		expect(body.data.total).toBe(1);
		expect(body.data.hasMore).toBe(false);
		expect(body.data.employees[0].startDate).toBeInstanceOf(Date);
		expect(body.data.employees[0].startDate?.toISOString()).toBe(
			"2026-01-01T00:00:00.000Z",
		);
		expect(
			state.queries.some((query) => query.includes("employee_managers")),
		).toBe(true);
	});

	it("loads an authorized detail, schedule and confirmed history through independent GETs", async () => {
		const query = `employeeId=${managed.employeeId}`;
		const [detailResponse, scheduleResponse, historyResponse] =
			await Promise.all([
				request("detail", query),
				request("schedule", query),
				request("employment-history", query),
			]);
		expect([
			detailResponse.status,
			scheduleResponse.status,
			historyResponse.status,
		]).toEqual([200, 200, 200]);
		const detail =
			await parseSuperJsonResponse<EmployeeReadSnapshot<"detail">>(
				detailResponse,
			);
		expect(detail.data).toMatchObject({
			id: managed.employeeId,
			organizationId: fixture.organizationId,
			user: { name: "Managed Pat" },
		});
		expect(detail.data.createdAt).toBeInstanceOf(Date);
		const history =
			await parseSuperJsonResponse<EmployeeReadSnapshot<"employment-history">>(
				historyResponse,
			);
		expect(history.data).toHaveLength(1);
		expect(history.data[0]).toMatchObject({
			reviewState: "confirmed",
			weeklyContractMinutes: 2400,
			employmentPeriod: { id: managed.employmentPeriodId },
		});
		expect(history.data[0].validFrom).toBeInstanceOf(Date);
		expect(history.data[0].validFrom.toISOString()).toBe(
			"2026-01-01T00:00:00.000Z",
		);
		expect(history.data[0].employmentPeriod?.startedAt).toBeInstanceOf(Date);
		const schedule =
			await parseSuperJsonResponse<EmployeeReadSnapshot<"schedule">>(
				scheduleResponse,
			);
		expect(schedule.data).toBeNull();
	});

	it("offers only current organization manager choices and minimal policy choices", async () => {
		state.userId = fixture.ownerUserId;
		const managersResponse = await request(
			"managers",
			`employeeId=${managed.employeeId}`,
		);
		expect(managersResponse.status).toBe(200);
		const managers =
			await parseSuperJsonResponse<EmployeeReadSnapshot<"managers">>(
				managersResponse,
			);
		expect(new Set(managers.data.map((employee) => employee.userId))).toEqual(
			new Set([fixture.ownerUserId, manager.userId, legacyAdmin.userId]),
		);
		expect(managers.data.map((employee) => employee.id)).not.toContain(
			foreign.employeeId,
		);
		const policies = await parseSuperJsonResponse<
			EmployeeReadSnapshot<"work-policies">
		>(await request("work-policies"));
		expect(policies.data).toEqual([{ id: policyId, name: "Fixture policy" }]);
	});

	it("returns only the fields the eligible-manager selector displays", async () => {
		state.userId = fixture.ownerUserId;
		const response = await request(
			"managers",
			`employeeId=${managed.employeeId}`,
		);
		expect(response.status).toBe(200);
		const { data } =
			await parseSuperJsonResponse<EmployeeReadSnapshot<"managers">>(response);
		expect(data.length).toBeGreaterThan(0);
		for (const choice of data) {
			expect(Object.keys(choice).sort()).toEqual(["id", "user", "userId"]);
			expect(Object.keys(choice.user).sort()).toEqual([
				"email",
				"firstName",
				"image",
				"lastName",
				"name",
			]);
		}
	});

	it("reads accepted manager display and policy changes immediately through the same GET callers", async () => {
		state.userId = fixture.ownerUserId;
		const managers = () =>
			request("managers", `employeeId=${managed.employeeId}`).then(
				parseSuperJsonResponse<EmployeeReadSnapshot<"managers">>,
			);
		expect(
			(await managers()).data.find((person) => person.id === manager.employeeId)
				?.user.name,
		).toBe("Lifecycle");
		expect(
			(
				await updateEmployeeAction(manager.employeeId, {
					firstName: "Renamed",
					lastName: "Manager",
				})
			).success,
		).toBe(true);
		expect(
			(await managers()).data.find((person) => person.id === manager.employeeId)
				?.user.name,
		).toBe("Renamed Manager");
		expect(
			(await updateWorkPolicy(policyId, { name: "Renamed policy" })).success,
		).toBe(true);
		const policies = await parseSuperJsonResponse<
			EmployeeReadSnapshot<"work-policies">
		>(await request("work-policies"));
		expect(policies.data).toEqual([{ id: policyId, name: "Renamed policy" }]);
		await fixture.pool.query(
			`update work_policy set name='Fixture policy' where id=$1 and organization_id=$2`,
			[policyId, fixture.organizationId],
		);
	});

	it("uses the manager's current assigned set and refuses a later privilege reduction", async () => {
		try {
			await fixture.pool.query(
				`update employee set role='manager' where id=$1 and organization_id=$2`,
				[managed.employeeId, fixture.organizationId],
			);
			const selected = () =>
				request("managers", `employeeId=${unrelated.employeeId}`).then(
					parseSuperJsonResponse<EmployeeReadSnapshot<"managers">>,
				);
			expect((await selected()).data.map((person) => person.id)).toEqual([
				managed.employeeId,
			]);
			await fixture.pool.query(
				`delete from employee_managers where employee_id=$1 and manager_id=$2`,
				[managed.employeeId, manager.employeeId],
			);
			expect((await selected()).data).toEqual([]);
			await fixture.pool.query(
				`update employee set role='employee' where id=$1 and organization_id=$2`,
				[manager.employeeId, fixture.organizationId],
			);
			expect(
				(await request("managers", `employeeId=${unrelated.employeeId}`))
					.status,
			).toBe(403);
		} finally {
			await fixture.pool.query(
				`update employee set role='employee' where id=$1 and organization_id=$2`,
				[managed.employeeId, fixture.organizationId],
			);
			await fixture.pool.query(
				`update employee set role='manager' where id=$1 and organization_id=$2`,
				[manager.employeeId, fixture.organizationId],
			);
			await fixture.pool.query(
				`insert into employee_managers (employee_id, manager_id, is_primary, assigned_by) values ($1,$2,true,$3) on conflict do nothing`,
				[managed.employeeId, manager.employeeId, fixture.ownerUserId],
			);
		}
	});

	it("rechecks roster eligibility and policy deletion after external writes with unchanged update timestamps", async () => {
		state.userId = fixture.ownerUserId;
		const choices = () =>
			request("managers", `employeeId=${managed.employeeId}`).then(
				parseSuperJsonResponse<EmployeeReadSnapshot<"managers">>,
			);
		expect(
			(await choices()).data.some((person) => person.id === manager.employeeId),
		).toBe(true);
		try {
			await fixture.pool.query(
				`update employee set is_active=false where id=$1 and organization_id=$2`,
				[manager.employeeId, fixture.organizationId],
			);
			expect(
				(await choices()).data.some(
					(person) => person.id === manager.employeeId,
				),
			).toBe(false);
			await fixture.pool.query(
				`update work_policy set is_active=false where id=$1 and organization_id=$2`,
				[policyId, fixture.organizationId],
			);
			expect(
				(
					await parseSuperJsonResponse<EmployeeReadSnapshot<"work-policies">>(
						await request("work-policies"),
					)
				).data,
			).toEqual([]);
		} finally {
			await fixture.pool.query(
				`update employee set is_active=true where id=$1 and organization_id=$2`,
				[manager.employeeId, fixture.organizationId],
			);
			await fixture.pool.query(
				`update work_policy set is_active=true where id=$1 and organization_id=$2`,
				[policyId, fixture.organizationId],
			);
		}
	});

	it("keeps organization switching scoped and does not change another organization's choices after a local mutation", async () => {
		state.userId = foreign.userId;
		state.organizationId = foreignOrganizationId;
		const otherChoices = () =>
			request("managers", `employeeId=${managed.employeeId}`).then(
				parseSuperJsonResponse<EmployeeReadSnapshot<"managers">>,
			);
		const before = await otherChoices();
		expect(before.data.map((person) => person.id)).toEqual([
			foreign.employeeId,
		]);
		expect(
			(
				await parseSuperJsonResponse<EmployeeReadSnapshot<"work-policies">>(
					await request("work-policies"),
				)
			).data,
		).toEqual([{ id: foreignPolicyId, name: "Other organization policy" }]);
		state.userId = fixture.ownerUserId;
		state.organizationId = fixture.organizationId;
		expect(
			(
				await updateEmployeeAction(manager.employeeId, {
					firstName: "Organization A",
				})
			).success,
		).toBe(true);
		state.userId = foreign.userId;
		state.organizationId = foreignOrganizationId;
		expect((await otherChoices()).data).toEqual(before.data);
		expect(
			(
				await request(
					"work-policies",
					"",
					foreign.userId,
					fixture.organizationId,
				)
			).status,
		).toBe(409);
	});

	it("drops a newly due departure without waiting for the lifecycle worker to write employee state", async () => {
		state.userId = fixture.ownerUserId;
		const departureId = randomUUID();
		await fixture.pool.query(
			`insert into employee_departure (id, organization_id, employee_id, employment_period_id, mode, last_working_day, timezone, cutoff_at, created_by, request_id, request_fingerprint, revision, status) values ($1,$2,$3,$4,'scheduled','2026-10-24','UTC',clock_timestamp()+interval '1 second',$5,gen_random_uuid(),'selector-fixture',1,'pending')`,
			[
				departureId,
				fixture.organizationId,
				manager.employeeId,
				manager.employmentPeriodId,
				fixture.ownerUserId,
			],
		);
		const choices = () =>
			request("managers", `employeeId=${managed.employeeId}`).then(
				parseSuperJsonResponse<EmployeeReadSnapshot<"managers">>,
			);
		try {
			expect(
				(await choices()).data.some(
					(person) => person.id === manager.employeeId,
				),
			).toBe(true);
			await fixture.pool.query(`select pg_sleep(1.1)`);
			expect(
				(await choices()).data.some(
					(person) => person.id === manager.employeeId,
				),
			).toBe(false);
		} finally {
			await fixture.pool.query(
				`delete from employee_departure where id=$1 and organization_id=$2`,
				[departureId, fixture.organizationId],
			);
		}
	});

	it("keeps approved organization administrators without an employee profile working", async () => {
		await fixture.pool.query(
			`delete from employee where user_id=$1 and organization_id=$2`,
			[legacyAdmin.userId, fixture.organizationId],
		);
		state.userId = legacyAdmin.userId;
		const response = await request("work-policies");
		expect(response.status).toBe(200);
		expect(
			(
				await parseSuperJsonResponse<EmployeeReadSnapshot<"work-policies">>(
					response,
				)
			).data,
		).toEqual([{ id: policyId, name: "Fixture policy" }]);
	});

	it.each(["detail", "schedule", "employment-history"])(
		"denies an unmanaged and a foreign target for %s",
		async (dataset) => {
			expect(
				(await request(dataset, `employeeId=${unrelated.employeeId}`)).status,
			).toBe(403);
			expect(
				(await request(dataset, `employeeId=${foreign.employeeId}`)).status,
			).toBe(404);
		},
	);

	it("rejects replaced expected scope before reading directory rows", async () => {
		const response = await request(
			"directory",
			"",
			unrelated.userId,
			fixture.organizationId,
		);
		expect(response.status).toBe(409);
		expect(
			state.queries.some((query) => query.includes("employee_managers")),
		).toBe(false);
	});

	it("does not treat display headers as authorization for an ordinary employee", async () => {
		state.userId = unrelated.userId;
		expect((await request("directory")).status).toBe(403);
	});

	it("rejects signed-out requests before database reads", async () => {
		state.userId = null;
		expect((await request("directory")).status).toBe(401);
		expect(state.queries).toEqual([]);
	});

	it("rechecks approved membership on the next request", async () => {
		try {
			await fixture.pool.query(
				`update member set status='pending' where id=$1 and organization_id=$2`,
				[manager.memberId, fixture.organizationId],
			);
			expect((await request("directory")).status).toBe(403);
		} finally {
			await fixture.pool.query(
				`update member set status='approved' where id=$1 and organization_id=$2`,
				[manager.memberId, fixture.organizationId],
			);
		}
	});

	it.each(["limit=-1", "offset=-1", "role=owner", "status=unknown"])(
		"rejects invalid directory parameters %s",
		async (query) => {
			expect((await request("directory", query)).status).toBe(400);
		},
	);

	it("rejects real-employee datasets for invitation draft identifiers", async () => {
		expect(
			(
				await request(
					"schedule",
					`employeeId=${encodeURIComponent(`draft:${randomUUID()}`)}`,
				)
			).status,
		).toBe(400);
	});

	it("keeps pending invitation detail and draft roster visibility with the existing administrator reader", async () => {
		state.userId = fixture.ownerUserId;
		const target = `employeeId=${encodeURIComponent(`draft:${draftId}`)}`;
		const response = await request("detail", target);
		expect(response.status).toBe(200);
		const detail =
			await parseSuperJsonResponse<EmployeeReadSnapshot<"detail">>(response);
		expect(detail.data).toMatchObject({
			kind: "invitationDraft",
			encodedId: `draft:${draftId}`,
			user: { firstName: "Draft", lastName: "Pat" },
		});
		expect(detail.data.createdAt).toBeInstanceOf(Date);
		const directory = await parseSuperJsonResponse<
			EmployeeReadSnapshot<"directory">
		>(await request("directory", "status=draft&limit=20&offset=0"));
		expect(
			directory.data.employees.map((employee) => ({
				id: employee.id,
				kind: employee.kind,
			})),
		).toEqual([{ id: draftId, kind: "invitationDraft" }]);
		state.userId = manager.userId;
		expect((await request("detail", target)).status).toBe(404);
	});
});
