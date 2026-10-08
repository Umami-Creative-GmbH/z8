/** #780: real organization, employee and metadata readers on disposable PostgreSQL.
 * Only browser/session/request infrastructure is replaced. */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { integrationAdminPool } from "@/test/integration-database";

const session = vi.hoisted(() => ({
	userId: null as string | null,
	organizationId: "t780-org",
	switches: [] as string[],
}));
vi.mock("next/headers", async () =>
	(await import("@/test/integration-harness")).nextHeaders(),
);
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
				session.userId
					? {
							user: { id: session.userId, role: "user" },
							session: {
								id: "t780-session",
								userId: session.userId,
								activeOrganizationId: session.organizationId,
							},
						}
					: null,
			setActiveOrganization: async ({
				body,
			}: {
				body: { organizationId: string };
			}) => {
				session.switches.push(body.organizationId);
				return new Response("{}", {
					headers: { "Set-Cookie": "session=t780; HttpOnly; Path=/" },
				});
			},
		},
	},
}));
const metadata = await import("../context/route");
const browser = await import("./route");
const admin = integrationAdminPool();
const employee = "d7800000-0000-4000-8000-000000000001";
const project = "d7800000-0000-4000-8000-000000000002";
const otherProject = "d7800000-0000-4000-8000-000000000003";
async function cleanup() {
	await admin.query(
		"delete from organization where id in ('t780-org', 't780-other')",
	);
	await admin.query('delete from "user" where id = $1', ["t780-user"]);
}
beforeEach(async () => {
	await cleanup();
	session.userId = "t780-user";
	session.organizationId = "t780-org";
	session.switches = [];
	await admin.query(
		"insert into organization(id,name,slug,created_at) values ('t780-org','Desktop <workspace>','t780-org',now()),('t780-other','Other','t780-other',now())",
	);
	await admin.query(
		'insert into "user"(id,name,email,created_at,updated_at) values ($1,$1,$2,now(),now())',
		["t780-user", "t780@example.test"],
	);
	await admin.query(
		"insert into member(id,organization_id,user_id,role,status,created_at) values ('t780-member','t780-org','t780-user','member','approved',now())",
	);
	await admin.query(
		"insert into employee(id,user_id,organization_id,role,updated_at) values ($1,'t780-user','t780-org','employee',now())",
		[employee],
	);
	await admin.query(
		"insert into user_settings(user_id,timezone,locale,updated_at) values ('t780-user','Europe/Berlin','de',now())",
	);
	await admin.query(
		"insert into project(id,organization_id,name,created_by,updated_at) values ($1,'t780-org','Assigned','t780-user',now()),($2,'t780-other','Private elsewhere','t780-user',now())",
		[project, otherProject],
	);
	await admin.query(
		"insert into project_assignment(project_id,organization_id,assignment_type,employee_id,created_by) values ($1,'t780-org','employee',$3,'t780-user'),($2,'t780-other','employee',$3,'t780-user')",
		[project, otherProject, employee],
	);
});
afterAll(cleanup);
const url =
	"http://localhost:3000/api/desktop/open?organizationId=t780-org&userId=t780-user&section=time&language=de";
describe("desktop context and browser handoff", () => {
	vi.setConfig({ testTimeout: 60000, hookTimeout: 60000 });
	it("returns the authenticated employee's day basis, language and eligible projects only", async () => {
		const response = await metadata.GET();
		expect(response.status).toBe(200);
		expect(response.headers.get("Cache-Control")).toBe("private, no-store");
		expect(await response.json()).toMatchObject({
			userId: "t780-user",
			organizationId: "t780-org",
			employeeId: employee,
			timezone: "Europe/Berlin",
			locale: "de",
			projects: [{ id: project, name: "Assigned" }],
			categories: [],
		});
	});
	it("refuses metadata after membership is revoked, and refuses a signed-out request", async () => {
		await admin.query(
			"update member set status='pending' where id='t780-member'",
		);
		expect((await metadata.GET()).status).toBe(403);
		session.userId = null;
		expect((await metadata.GET()).status).toBe(401);
	});
	it("shows an escaped organization and does not change browser context on GET", async () => {
		const response = await browser.GET(new Request(url));
		expect(response.status).toBe(200);
		expect(await response.text()).toContain("Desktop &lt;workspace&gt;");
		expect(session.switches).toEqual([]);
	});
	it("blocks a different browser account and a cross-origin confirmation", async () => {
		session.userId = "different-user";
		expect((await browser.GET(new Request(url))).status).toBe(409);
		session.userId = "t780-user";
		expect(
			(
				await browser.POST(
					new Request(url, {
						method: "POST",
						headers: { origin: "https://elsewhere.test" },
					}),
				)
			).status,
		).toBe(403);
		expect(session.switches).toEqual([]);
	});
	it("rechecks membership before switching and forwards the new session cookie after confirmation", async () => {
		const response = await browser.POST(
			new Request(url, {
				method: "POST",
				headers: { origin: "http://localhost:3000" },
			}),
		);
		expect(response.status).toBe(303);
		expect(response.headers.get("Location")).toBe(
			"http://localhost:3000/de/time-tracking",
		);
		expect(response.headers.get("Set-Cookie")).toContain("session=t780");
		expect(session.switches).toEqual(["t780-org"]);
		await admin.query(
			"update member set status='pending' where id='t780-member'",
		);
		expect(
			(
				await browser.POST(
					new Request(url, {
						method: "POST",
						headers: { origin: "http://localhost:3000" },
					}),
				)
			).status,
		).toBe(403);
		expect(session.switches).toHaveLength(1);
	});
	it("opens the employee profile for timezone updates only after the same account and organization confirmation", async () => {
		const destination = url.replace("section=time", "section=preferences");
		const preview = await browser.GET(new Request(destination));
		expect(preview.status).toBe(200);
		expect(session.switches).toEqual([]);
		const response = await browser.POST(
			new Request(destination, {
				method: "POST",
				headers: { origin: "http://localhost:3000" },
			}),
		);
		expect(response.headers.get("Location")).toBe(
			"http://localhost:3000/de/settings/profile",
		);
		expect(session.switches).toEqual(["t780-org"]);
	});
});
