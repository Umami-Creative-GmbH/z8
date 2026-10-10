/**
 * #863: the who-is-in board on PostgreSQL, through the kiosk board endpoint
 * (kiosk token) and the manager view's data loader (session). Live work and
 * breaks are written by the real Clocking module; only the session, billing and
 * the Next request/cache boundaries are replaced.
 */

import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { type Instant, parseInstant } from "@/lib/datetime/temporal-core";
import {
	createLifecycleDatabaseFixture,
	type LifecycleDatabaseFixture,
	type SeededEmployee,
} from "@/lib/employee-lifecycle/testing/database.test.fixture";
import { hashKioskSecret } from "@/lib/kiosk/credentials";

const harness = vi.hoisted(() => ({
	userId: null as string | null,
	organizationId: null as string | null,
}));

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
								id: `t863-session-${harness.userId}`,
								userId: harness.userId,
								activeOrganizationId: harness.organizationId,
							},
						}
					: null,
		},
	},
}));
vi.mock("@/lib/billing/guard", () => ({
	requireBillingForMutation: async () => ({ canAccess: true }),
	isBillingMutationAllowed: (access: { canAccess: boolean }) => access.canAccess,
}));

const { createClocking } = await import("@/lib/time-tracking/clocking/clocking");
const { recordingFollowUps } = await import("@/lib/time-tracking/clocking/follow-ups");
const { coordinatedTransactions } = await import("@/lib/time-tracking/clocking/transactions");
const { GET: getKioskBoard } = await import("@/app/api/kiosk/board/route");
const { getLocationPresence, getWhoIsInLocations } = await import(
	"@/app/[locale]/(app)/team/presence/presence-data"
);

const workStart = parseInstant("2026-10-10T06:30:00Z");
const breakStart = parseInstant("2026-10-10T09:45:00Z");
const clockOutAt = parseInstant("2026-10-10T10:00:00Z");

describe("who-is-in board on PostgreSQL", () => {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

	let fixture: LifecycleDatabaseFixture;
	let organizationId: string;
	let otherOrganizationId: string;
	let store: string;
	let warehouse: string;
	let foreignStore: string;
	let manager: SeededEmployee;
	let member: SeededEmployee;
	let foreignOwner: SeededEmployee;
	let anna: SeededEmployee;
	let ben: SeededEmployee;
	let cleo: SeededEmployee;
	let dora: SeededEmployee;
	let foreignWorker: SeededEmployee;

	function actAs(userId: string, activeOrganizationId: string = organizationId) {
		harness.userId = userId;
		harness.organizationId = activeOrganizationId;
	}

	async function createLocation(name: string, orgId = organizationId): Promise<string> {
		const id = randomUUID();
		await fixture.pool.query(
			`insert into location (id, organization_id, name, is_active, created_by, updated_at)
			 values ($1, $2, $3, true, $4, now())`,
			[id, orgId, name, fixture.ownerUserId],
		);
		return id;
	}

	async function employeeNamed(
		firstName: string,
		lastName: string,
		orgId = organizationId,
	): Promise<SeededEmployee> {
		const seeded = await fixture.seedEmployee({ organizationId: orgId });
		await fixture.pool.query(
			`update "user" set first_name = $2, last_name = $3, name = $4 where id = $1`,
			[seeded.userId, firstName, lastName, `${firstName} ${lastName}`],
		);
		await fixture.pool.query(
			`insert into user_settings (user_id, timezone, updated_at) values ($1, 'Europe/Berlin', now())
			 on conflict (user_id) do nothing`,
			[seeded.userId],
		);
		return seeded;
	}

	async function assign(person: SeededEmployee, locationId: string, orgId = organizationId) {
		await fixture.pool.query(
			`insert into employee_assigned_location (organization_id, employee_id, location_id)
			 values ($1, $2, $3)`,
			[orgId, person.employeeId, locationId],
		);
	}

	function command(person: SeededEmployee, orgId: string) {
		return {
			organizationId: orgId,
			principal: { kind: "user" as const, userId: person.userId },
			subject: { employeeId: person.employeeId },
			identity: { origin: "client" as const, id: randomUUID() },
			channel: "web" as const,
			at: { kind: "now" as const },
			zone: { device: "Europe/Berlin", fallback: "UTC" },
		};
	}

	function clockingAt(now: Instant) {
		return createClocking({
			clock: { nowInstant: () => now } as never,
			transactions: coordinatedTransactions(),
			followUps: recordingFollowUps(),
		});
	}

	async function clockIn(person: SeededEmployee, orgId = organizationId) {
		await expect(
			clockingAt(workStart).run({
				...command(person, orgId),
				body: { kind: "clock_in", workLocationType: "office" },
			}),
		).resolves.toMatchObject({ outcome: "executed" });
	}

	async function kioskToken(
		locationId: string,
		input: { boardEnabled: boolean; orgId?: string; revoked?: boolean },
	): Promise<string> {
		const token = `z8k_t863-${randomUUID()}`;
		await fixture.pool.query(
			`insert into kiosk (organization_id, location_id, name, timezone, board_enabled, token_hash,
			                    paired_at, revoked_at, created_by)
			 values ($1, $2, 'Front door', 'Europe/Berlin', $3, $4, now(), $5, $6)`,
			[
				input.orgId ?? organizationId,
				locationId,
				input.boardEnabled,
				hashKioskSecret(token),
				input.revoked ? new Date() : null,
				fixture.ownerUserId,
			],
		);
		return token;
	}

	async function readBoard(token: string | null) {
		const response = await getKioskBoard(
			new Request("http://localhost/api/kiosk/board", {
				headers: token ? { "x-kiosk-token": token } : {},
			}),
		);
		return { status: response.status, body: await response.json() };
	}

	beforeAll(async () => {
		fixture = await createLifecycleDatabaseFixture();
		organizationId = fixture.organizationId;
		otherOrganizationId = await fixture.createOrganization();
		for (const orgId of [organizationId, otherOrganizationId]) {
			await fixture.pool.query(
				`insert into approval_workflow_rollout
				 (organization_id, workflow_type, lifecycle_mode, side_effect_mode, created_at, updated_at)
				 values ($1, 'policy_clock_out', 'legacy', 'legacy', now(), now())`,
				[orgId],
			);
		}
		store = await createLocation("Store");
		warehouse = await createLocation("Warehouse");
		foreignStore = await createLocation("Foreign store", otherOrganizationId);

		manager = await employeeNamed("Mia", "Manager");
		await fixture.pool.query(`update employee set role = 'manager' where id = $1`, [
			manager.employeeId,
		]);
		member = await employeeNamed("Max", "Member");
		foreignOwner = await fixture.seedEmployee({
			organizationId: otherOrganizationId,
			role: "owner",
		});

		anna = await employeeNamed("Anna", "Berger");
		ben = await employeeNamed("Ben", "Özdemir");
		cleo = await employeeNamed("Cleo", "Schmidt");
		dora = await employeeNamed("Dora", "Weber");
		foreignWorker = await employeeNamed("Finn", "Fremd", otherOrganizationId);
		await fixture.pool.query(
			`insert into employee_managers (employee_id, manager_id, is_primary, assigned_by)
			 values ($1, $2, true, $3)`,
			[anna.employeeId, manager.employeeId, fixture.ownerUserId],
		);

		for (const person of [anna, ben, cleo]) await assign(person, store);
		await assign(dora, warehouse);
		await assign(foreignWorker, foreignStore, otherOrganizationId);

		// Anna is in, Ben is on a break in progress, Cleo has clocked out,
		// Dora is in at another location, Finn is in at another organization.
		for (const person of [anna, ben, cleo, dora]) await clockIn(person);
		await clockIn(foreignWorker, otherOrganizationId);
		await expect(
			clockingAt(breakStart).startBreak(command(ben, organizationId)),
		).resolves.toMatchObject({ outcome: "executed" });
		await expect(
			clockingAt(clockOutAt).run({
				...command(cleo, organizationId),
				body: {
					kind: "clock_out",
					project: { kind: "preserve" },
					workCategory: { kind: "preserve" },
				},
			}),
		).resolves.toMatchObject({ outcome: "executed" });
	});

	afterAll(async () => {
		await fixture?.close();
	});

	it("shows the kiosk's location as first name and last initial with the state, nothing more", async () => {
		const token = await kioskToken(store, { boardEnabled: true });

		const { status, body } = await readBoard(token);

		expect(status).toBe(200);
		expect(body).toEqual({
			enabled: true,
			entries: [
				{ name: "Anna B.", state: "in" },
				{ name: "Ben Ö.", state: "on_break" },
			],
		});
		const serialized = JSON.stringify(body);
		for (const leak of ["Berger", "Özdemir", "Cleo", "Dora", "Finn", "2026", anna.employeeId]) {
			expect(serialized).not.toContain(leak);
		}
	});

	it("shows nothing while the kiosk's board is switched off, and refuses unknown or revoked kiosks", async () => {
		expect(await readBoard(await kioskToken(store, { boardEnabled: false }))).toEqual({
			status: 200,
			body: { enabled: false, entries: [] },
		});
		expect(await readBoard(null)).toMatchObject({
			status: 401,
			body: { code: "kiosk_unknown" },
		});
		expect(
			await readBoard(await kioskToken(store, { boardEnabled: true, revoked: true })),
		).toMatchObject({ status: 401, body: { code: "kiosk_revoked" } });
	});

	it("keeps every kiosk board to its own location and organization", async () => {
		expect((await readBoard(await kioskToken(warehouse, { boardEnabled: true }))).body).toEqual({
			enabled: true,
			entries: [{ name: "Dora W.", state: "in" }],
		});
		expect(
			(
				await readBoard(
					await kioskToken(foreignStore, { boardEnabled: true, orgId: otherOrganizationId }),
				)
			).body,
		).toEqual({ enabled: true, entries: [{ name: "Finn F.", state: "in" }] });
	});

	it("shows owners full names, the state and since when for every assigned employee", async () => {
		actAs(fixture.ownerUserId);

		const result = await getLocationPresence(store);

		expect(result).toMatchObject({ status: "ok", location: { id: store, name: "Store" } });
		expect(result.status === "ok" && result.entries).toEqual([
			{
				employeeId: anna.employeeId,
				name: "Anna Berger",
				state: "clocked_in",
				since: new Date("2026-10-10T06:30:00Z"),
				sinceZone: "+02:00",
			},
			{
				employeeId: ben.employeeId,
				name: "Ben Özdemir",
				state: "on_break",
				since: new Date("2026-10-10T09:45:00Z"),
				sinceZone: "Europe/Berlin",
			},
		]);
		const warehouseResult = await getLocationPresence(warehouse);
		expect(
			warehouseResult.status === "ok" && warehouseResult.entries.map((entry) => entry.name),
		).toEqual(["Dora Weber"]);
		const locations = await getWhoIsInLocations();
		expect(locations.status === "ok" && locations.locations.map((row) => row.name)).toEqual([
			"Store",
			"Warehouse",
		]);
	});

	it("limits managers to the employees they manage and refuses members", async () => {
		actAs(manager.userId);
		const managed = await getLocationPresence(store);
		expect(managed.status === "ok" && managed.entries.map((entry) => entry.name)).toEqual([
			"Anna Berger",
		]);
		const warehouseResult = await getLocationPresence(warehouse);
		expect(warehouseResult.status === "ok" && warehouseResult.entries).toEqual([]);

		actAs(member.userId);
		expect(await getLocationPresence(store)).toEqual({ status: "forbidden" });
		expect(await getWhoIsInLocations()).toEqual({ status: "forbidden" });
	});

	it("never shows another organization's location", async () => {
		actAs(fixture.ownerUserId);
		expect(await getLocationPresence(foreignStore)).toEqual({ status: "not_found" });
		expect(await getLocationPresence("not-a-location")).toEqual({ status: "not_found" });

		actAs(foreignOwner.userId, otherOrganizationId);
		expect(await getLocationPresence(store)).toEqual({ status: "not_found" });
		const foreign = await getLocationPresence(foreignStore);
		expect(foreign.status === "ok" && foreign.entries.map((entry) => entry.name)).toEqual([
			"Finn Fremd",
		]);
	});
});
