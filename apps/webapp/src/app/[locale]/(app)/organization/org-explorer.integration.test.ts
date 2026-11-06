/**
 * PostgreSQL contract for the Org Explorer (#1576): it shows the current roster
 * only, reads team membership from team memberships, draws one reporting line
 * per person from their primary manager, stays inside the active organization,
 * and loads a large organization on demand.
 */
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
import {
	createLifecycleDatabaseFixture,
	type LifecycleDatabaseFixture,
	type SeededEmployee,
} from "@/lib/employee-lifecycle/testing/database.test.fixture";
import { SMALL_ORG_EMPLOYEE_LIMIT } from "./org-explorer-types";

const harness = vi.hoisted(() => ({
	userId: null as string | null,
	organizationId: null as string | null,
}));

vi.mock("next/headers", async () =>
	(await import("@/test/integration-harness")).nextHeaders(),
);

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
								id: `t1576-org-explorer-${harness.userId}`,
								userId: harness.userId,
								activeOrganizationId: harness.organizationId,
							},
						}
					: null,
		},
	},
}));

vi.mock("@/lib/billing/guard", async () =>
	(await import("@/test/integration-harness")).billingGuard(),
);

const {
	getOrgExplorerData,
	getOrgExplorerGroup,
	getOrgExplorerPeople,
	getOrgExplorerTeamMembers,
	searchOrgEmployees,
} = await import("./actions");
const { loadCurrentTeamMemberIds, loadUnplacedPeopleIds } = await import(
	"./org-explorer-queries"
);
const { db } = await import("@/db");

const PAST_CUTOFF = "2026-09-14T13:00:00Z";

async function unwrap<T>(
	result: Promise<
		{ success: true; data: T } | { success: false; error: unknown }
	>,
) {
	const settled = await result;
	if (!settled.success) throw new Error(String(settled.error));
	return settled.data;
}

describe("Org Explorer (#1576)", () => {
	vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });
	let fixture: LifecycleDatabaseFixture;

	beforeAll(async () => {
		fixture = await createLifecycleDatabaseFixture();
	});

	afterAll(async () => {
		await fixture?.close();
	});

	async function seed(
		name: string,
		input: Parameters<LifecycleDatabaseFixture["seedEmployee"]>[0] = {},
	) {
		const seeded = await fixture.seedEmployee(input);
		await fixture.pool.query(
			`update "user" set name = $1, email = $2 where id = $3`,
			[
				name,
				`${name.toLowerCase().replaceAll(" ", ".")}.${seeded.userId}@example.test`,
				seeded.userId,
			],
		);
		return seeded;
	}

	async function manage(
		employee: SeededEmployee,
		manager: SeededEmployee,
		isPrimary = true,
	) {
		await fixture.pool.query(
			`insert into employee_managers (employee_id, manager_id, is_primary, assigned_by)
			 values ($1, $2, $3, $4)`,
			[employee.employeeId, manager.employeeId, isPrimary, fixture.ownerUserId],
		);
	}

	async function createTeam(
		organizationId: string,
		name: string,
		lead: SeededEmployee | null = null,
	): Promise<string> {
		const teamId = randomUUID();
		await fixture.pool.query(
			`insert into team (id, organization_id, name, description, primary_manager_id, updated_at)
			 values ($1, $2, $3, $4, $5, now())`,
			[
				teamId,
				organizationId,
				name,
				`${name} description`,
				lead?.employeeId ?? null,
			],
		);
		return teamId;
	}

	async function join(
		organizationId: string,
		teamId: string,
		employee: SeededEmployee,
		primary: boolean,
	) {
		await fixture.pool.query(
			`insert into team_membership (organization_id, team_id, employee_id) values ($1, $2, $3)`,
			[organizationId, teamId, employee.employeeId],
		);
		if (primary) {
			await fixture.pool.query(
				`update employee set team_id = $1 where id = $2`,
				[teamId, employee.employeeId],
			);
		}
	}

	async function depart(employee: SeededEmployee) {
		await fixture.pool.query(
			`insert into employee_departure
			 (organization_id, employee_id, employment_period_id, mode, last_working_day, timezone,
			  cutoff_at, created_by, request_id, request_fingerprint, revision, status)
			 values ($1, $2, $3, 'scheduled', '2026-09-14', 'UTC', $4, $5, gen_random_uuid(), 'test', 1, 'pending')`,
			[
				fixture.organizationId,
				employee.employeeId,
				employee.employmentPeriodId,
				PAST_CUTOFF,
				fixture.ownerUserId,
			],
		);
	}

	describe("a small organization", () => {
		let ceo: SeededEmployee;
		let vp: SeededEmployee;
		let ada: SeededEmployee;
		let bob: SeededEmployee;
		let cat: SeededEmployee;
		let lou: SeededEmployee;
		let gone: SeededEmployee;
		let departed: SeededEmployee;
		let formerBoss: SeededEmployee;
		let outsider: SeededEmployee;
		let ops: string;
		let sales: string;
		let outsideTeam: string;
		let organizationB: string;

		beforeAll(async () => {
			await fixture.pool.query(
				`update "user" set name = 'Owner' where id = $1`,
				[fixture.ownerUserId],
			);
			await fixture.pool.query(
				`update "user" set name = 'Target' from employee where employee.user_id = "user".id and employee.id = $1`,
				[fixture.employeeId],
			);
			ceo = await seed("Cora Ceo");
			vp = await seed("Vic Vp");
			ada = await seed("Ada Analyst");
			bob = await seed("Bob Builder");
			cat = await seed("Cat Coder");
			lou = await seed("Lou Loner");
			gone = await seed("Gus Gone", { isActive: false });
			departed = await seed("Dee Departed");
			formerBoss = await seed("Fay Former", { isActive: false });
			await depart(departed);

			await manage(vp, ceo);
			await manage(ada, vp);
			await manage(ada, ceo, false);
			await manage(bob, vp);
			await manage(gone, vp);
			await manage(departed, vp);
			// Cat's primary manager left: the remaining current manager carries the line.
			await manage(cat, formerBoss);
			await manage(cat, bob, false);
			for (const unplaced of [fixture.ownerEmployeeId, fixture.employeeId]) {
				await fixture.pool.query(
					`insert into employee_managers (employee_id, manager_id, is_primary, assigned_by)
					 values ($1, $2, true, $3)`,
					[unplaced, ceo.employeeId, fixture.ownerUserId],
				);
			}

			ops = await createTeam(fixture.organizationId, "Ops", ceo);
			sales = await createTeam(fixture.organizationId, "Sales", ada);
			await join(fixture.organizationId, ops, ada, false);
			await join(fixture.organizationId, ops, bob, true);
			await join(fixture.organizationId, ops, gone, true);
			await join(fixture.organizationId, ops, departed, true);
			await join(fixture.organizationId, sales, ada, true);

			organizationB = await fixture.createOrganization();
			outsider = await seed("Ada Outsider", { organizationId: organizationB });
			outsideTeam = await createTeam(organizationB, "Outside");
			await join(organizationB, outsideTeam, outsider, true);
		});

		beforeEach(() => {
			harness.userId = fixture.ownerUserId;
			harness.organizationId = fixture.organizationId;
		});

		it("loads the whole current roster and nobody else", async () => {
			const data = await unwrap(getOrgExplorerData());
			const ids = data.people.map((entry) => entry.employeeId);

			expect(data.complete).toBe(true);
			expect(data.viewerEmployeeId).toBe(fixture.ownerEmployeeId);
			expect(data.employeeCount).toBe(8);
			expect(ids.toSorted()).toEqual(
				[
					fixture.ownerEmployeeId,
					fixture.employeeId,
					ceo.employeeId,
					vp.employeeId,
					ada.employeeId,
					bob.employeeId,
					cat.employeeId,
					lou.employeeId,
				].toSorted(),
			);
			expect(ids).not.toContain(gone.employeeId);
			expect(ids).not.toContain(departed.employeeId);
			expect(ids).not.toContain(outsider.employeeId);
		});

		it("lists managers with the primary manager first, and reports through any manager", async () => {
			const data = await unwrap(getOrgExplorerData());
			const byId = new Map(
				data.people.map((entry) => [entry.employeeId, entry]),
			);

			expect(byId.get(ada.employeeId)?.managerIds).toEqual([
				vp.employeeId,
				ceo.employeeId,
			]);
			expect(byId.get(vp.employeeId)?.reportIds.toSorted()).toEqual(
				[ada.employeeId, bob.employeeId].toSorted(),
			);
			expect(byId.get(vp.employeeId)?.lineReportIds.toSorted()).toEqual(
				[ada.employeeId, bob.employeeId].toSorted(),
			);
			expect(byId.get(ceo.employeeId)?.reportIds).toContain(ada.employeeId);
			expect(byId.get(ceo.employeeId)?.lineReportIds).not.toContain(
				ada.employeeId,
			);
		});

		it("carries a reporting line through the next current manager when the primary one left", async () => {
			const data = await unwrap(getOrgExplorerData());
			const byId = new Map(
				data.people.map((entry) => [entry.employeeId, entry]),
			);

			expect(byId.get(cat.employeeId)?.managerIds).toEqual([bob.employeeId]);
			expect(byId.get(bob.employeeId)?.lineReportIds).toEqual([cat.employeeId]);
		});

		it("names the primary manager only when one is marked and still current", async () => {
			const data = await unwrap(getOrgExplorerData());
			const byId = new Map(
				data.people.map((entry) => [entry.employeeId, entry]),
			);

			expect(byId.get(ada.employeeId)?.primaryManagerId).toBe(vp.employeeId);
			expect(byId.get(cat.employeeId)?.primaryManagerId).toBeNull();
			expect(byId.get(ceo.employeeId)?.primaryManagerId).toBeNull();
		});

		it("puts people with no manager and reports on top and counts those with neither", async () => {
			const data = await unwrap(getOrgExplorerData());

			expect(data.rootIds).toEqual([ceo.employeeId]);
			expect(data.noReportingLineCount).toBe(1);
			expect(data.noTeamCount).toBe(6);
		});

		it("reads teams from current members' memberships, with the primary team first", async () => {
			const data = await unwrap(getOrgExplorerData());
			const teams = new Map(data.teams.map((entry) => [entry.teamId, entry]));
			const adaRecord = data.people.find(
				(entry) => entry.employeeId === ada.employeeId,
			);

			expect(data.teams.map((entry) => entry.name)).toEqual(["Ops", "Sales"]);
			expect(teams.get(ops)).toMatchObject({
				memberCount: 2,
				leadEmployeeId: ceo.employeeId,
				description: "Ops description",
			});
			expect(teams.get(sales)?.memberCount).toBe(1);
			expect(adaRecord?.primaryTeamId).toBe(sales);
			expect(adaRecord?.teamIds).toEqual([sales, ops]);
		});

		it("loads people by id, with their path to the top when asked, inside the organization", async () => {
			const people = await unwrap(
				getOrgExplorerPeople([
					cat.employeeId,
					gone.employeeId,
					outsider.employeeId,
				]),
			);
			expect(people.map((entry) => entry.employeeId)).toEqual([cat.employeeId]);

			const withPath = await unwrap(
				getOrgExplorerPeople([cat.employeeId], { withPaths: true }),
			);
			expect(withPath.map((entry) => entry.employeeId).toSorted()).toEqual(
				[
					cat.employeeId,
					bob.employeeId,
					vp.employeeId,
					ceo.employeeId,
				].toSorted(),
			);
		});

		it("loads a team's current members with their paths", async () => {
			const page = await unwrap(getOrgExplorerTeamMembers(ops));
			const ids = page.people.map((entry) => entry.employeeId);

			expect(page.nextOffset).toBeNull();
			expect(ids.toSorted()).toEqual(
				[
					ada.employeeId,
					bob.employeeId,
					vp.employeeId,
					ceo.employeeId,
				].toSorted(),
			);
		});

		it("loads no members of another organization's team", async () => {
			const page = await unwrap(getOrgExplorerTeamMembers(outsideTeam));

			expect(page).toEqual({ people: [], nextOffset: null });
		});

		it("pages a team's members by name until all are loaded", async () => {
			const first = await loadCurrentTeamMemberIds(
				db,
				fixture.organizationId,
				ops,
				{ offset: 0, limit: 1 },
			);
			const second = await loadCurrentTeamMemberIds(
				db,
				fixture.organizationId,
				ops,
				{ offset: first.nextOffset ?? -1, limit: 1 },
			);

			expect(first).toEqual({ ids: [ada.employeeId], nextOffset: 1 });
			expect(second).toEqual({ ids: [bob.employeeId], nextOffset: null });
		});

		it("pages a group until everyone in it is loaded", async () => {
			const whole = await loadUnplacedPeopleIds(
				db,
				fixture.organizationId,
				"noTeam",
				{ offset: 0, limit: 50 },
			);
			const first = await loadUnplacedPeopleIds(
				db,
				fixture.organizationId,
				"noTeam",
				{ offset: 0, limit: 4 },
			);
			const second = await loadUnplacedPeopleIds(
				db,
				fixture.organizationId,
				"noTeam",
				{ offset: first.nextOffset ?? -1, limit: 4 },
			);

			expect(whole.ids).toHaveLength(6);
			expect(whole.nextOffset).toBeNull();
			expect(first.nextOffset).toBe(4);
			expect(second.nextOffset).toBeNull();
			expect([...first.ids, ...second.ids]).toEqual(whole.ids);
		});

		it("loads the people without a reporting line or without a team", async () => {
			const noReportingLine = await unwrap(
				getOrgExplorerGroup("noReportingLine"),
			);
			const noTeamPage = await unwrap(getOrgExplorerGroup("noTeam"));
			const noTeam = noTeamPage.people;

			expect(noReportingLine).toEqual({
				people: [expect.objectContaining({ employeeId: lou.employeeId })],
				nextOffset: null,
			});
			const withoutTeam = noTeam.filter((entry) => entry.teamIds.length === 0);
			expect(withoutTeam.map((entry) => entry.employeeId).toSorted()).toEqual(
				[
					fixture.ownerEmployeeId,
					fixture.employeeId,
					ceo.employeeId,
					vp.employeeId,
					cat.employeeId,
					lou.employeeId,
				].toSorted(),
			);
			// Cat has no team but a reporting line, so the path to the top comes along.
			expect(noTeam.map((entry) => entry.employeeId)).toContain(bob.employeeId);
		});

		it("searches the current roster of the active organization only", async () => {
			const results = await unwrap(searchOrgEmployees("Ada"));

			expect(results.map((entry) => entry.employeeId)).toEqual([
				ada.employeeId,
			]);
			expect(await unwrap(searchOrgEmployees("Gus"))).toEqual([]);
		});

		it("follows the active organization", async () => {
			harness.userId = outsider.userId;
			harness.organizationId = organizationB;

			const data = await unwrap(getOrgExplorerData());

			expect(data.people.map((entry) => entry.employeeId)).toEqual([
				outsider.employeeId,
			]);
			expect(data.teams.map((entry) => entry.teamId)).toEqual([outsideTeam]);
		});

		it("refuses a viewer who is a former employee", async () => {
			harness.userId = departed.userId;

			const result = await getOrgExplorerData();

			expect(result.success).toBe(false);
		});
	});

	describe("someone whose reports all report along another line", () => {
		let organizationId: string;
		let kim: SeededEmployee;
		let max: SeededEmployee;

		beforeAll(async () => {
			organizationId = await fixture.createOrganization();
			kim = await seed("Kim Lead", { organizationId });
			max = await seed("Max Matrix", { organizationId });
			const bob = await seed("Bob Report", { organizationId });
			await manage(bob, kim);
			await manage(bob, max, false);
		});

		beforeEach(() => {
			harness.userId = kim.userId;
			harness.organizationId = organizationId;
		});

		it("has no reporting line: they are not on top", async () => {
			const data = await unwrap(getOrgExplorerData());
			const group = await unwrap(getOrgExplorerGroup("noReportingLine"));

			expect(data.rootIds).toEqual([kim.employeeId]);
			expect(data.noReportingLineCount).toBe(1);
			expect(group.people.map((entry) => entry.employeeId)).toEqual([
				max.employeeId,
			]);
		});
	});

	describe("a large organization", () => {
		let organizationId: string;
		let viewer: SeededEmployee;
		let root: SeededEmployee;
		let lead: SeededEmployee;
		let deepOffPath: SeededEmployee;
		let sideManager: SeededEmployee;
		const loaded: SeededEmployee[] = [];
		const fillers: SeededEmployee[] = [];

		beforeAll(async () => {
			organizationId = await fixture.createOrganization();
			const inLarge = { organizationId };
			root = await seed("Root", inLarge);
			// No manager, and their only report reports along another line.
			sideManager = await seed("S Side", inLarge);
			const m1 = await seed("M One", inLarge);
			const m2 = await seed("M Two", inLarge);
			const a1 = await seed("A One", inLarge);
			const a2 = await seed("A Two", inLarge);
			const d1 = await seed("D One", inLarge);
			viewer = await seed("Viewer", inLarge);
			deepOffPath = await seed("D Two", inLarge);
			await manage(m1, root);
			await manage(m2, root);
			await manage(a1, m1);
			await manage(a2, m2);
			await manage(d1, a1);
			await manage(viewer, d1);
			await manage(deepOffPath, a2);
			await manage(a1, sideManager, false);
			loaded.push(root, m1, m2, a1, a2, d1, viewer);

			while (
				loaded.length + fillers.length + 2 <
				SMALL_ORG_EMPLOYEE_LIMIT + 5
			) {
				fillers.push(await seed(`Filler ${fillers.length}`, inLarge));
			}
			lead = fillers[0] as SeededEmployee;
			await createTeam(organizationId, "Leads", lead);
		});

		beforeEach(() => {
			harness.userId = viewer.userId;
			harness.organizationId = organizationId;
		});

		it("loads the top two levels, the viewer's path and team leads, not the whole organization", async () => {
			const data = await unwrap(getOrgExplorerData());
			const ids = data.people.map((entry) => entry.employeeId);

			expect(data.complete).toBe(false);
			expect(data.employeeCount).toBe(SMALL_ORG_EMPLOYEE_LIMIT + 5);
			expect(ids.toSorted()).toEqual(
				[
					...loaded.map((entry) => entry.employeeId),
					lead.employeeId,
				].toSorted(),
			);
			expect(data.rootIds).toEqual([root.employeeId]);
			expect(data.noReportingLineCount).toBe(fillers.length + 1);
		});

		it("loads deeper reports and the unplaced people on demand", async () => {
			const deeper = await unwrap(
				getOrgExplorerPeople([deepOffPath.employeeId]),
			);
			const unplaced = await unwrap(getOrgExplorerGroup("noReportingLine"));

			expect(deeper.map((entry) => entry.employeeId)).toEqual([
				deepOffPath.employeeId,
			]);
			expect(unplaced.nextOffset).toBeNull();
			expect(
				unplaced.people.map((entry) => entry.employeeId).toSorted(),
			).toEqual(
				[...fillers, sideManager].map((entry) => entry.employeeId).toSorted(),
			);
		});
	});
});
