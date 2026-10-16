/**
 * #862: what the kiosk home screen reads on PostgreSQL, through the kiosk
 * endpoints with a kiosk device token: the employees who may clock at the
 * kiosk's location, and the language the kiosk opens in. No user session.
 */

import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
	createLifecycleDatabaseFixture,
	type LifecycleDatabaseFixture,
	type SeededEmployee,
} from "@/lib/employee-lifecycle/testing/database.test.fixture";
import { hashKioskSecret } from "@/lib/time-tracking/kiosk/credentials";

vi.mock("next/headers", async () => (await import("@/test/integration-harness")).nextHeaders());
vi.mock("next/server", async (importOriginal) =>
	(await import("@/test/integration-harness")).nextServer(importOriginal),
);
vi.mock("next/cache", async (importOriginal) =>
	(await import("@/test/integration-harness")).nextCache(importOriginal),
);

const { GET: getKioskEmployees } = await import("@/app/api/kiosk/employees/route");
const { GET: getKioskSession } = await import("@/app/api/kiosk/session/route");

describe("kiosk home screen on PostgreSQL", () => {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

	let fixture: LifecycleDatabaseFixture;
	let organizationId: string;
	let otherOrganizationId: string;
	let store: string;
	let warehouse: string;
	let closedStore: string;
	let foreignStore: string;
	let anna: SeededEmployee;
	let ben: SeededEmployee;

	async function createLocation(name: string, orgId = organizationId, isActive = true) {
		const id = randomUUID();
		await fixture.pool.query(
			`insert into location (id, organization_id, name, is_active, created_by, updated_at)
			 values ($1, $2, $3, $4, $5, now())`,
			[id, orgId, name, isActive, fixture.ownerUserId],
		);
		return id;
	}

	async function employeeNamed(
		firstName: string | null,
		lastName: string | null,
		name: string,
		input: { orgId?: string; isActive?: boolean } = {},
	): Promise<SeededEmployee> {
		const seeded = await fixture.seedEmployee({
			organizationId: input.orgId ?? organizationId,
			isActive: input.isActive ?? true,
		});
		await fixture.pool.query(
			`update "user" set first_name = $2, last_name = $3, name = $4 where id = $1`,
			[seeded.userId, firstName, lastName, name],
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

	async function kioskToken(
		locationId: string,
		input: { orgId?: string; revoked?: boolean; offlineMode?: boolean } = {},
	): Promise<string> {
		const token = `z8k_t862-${randomUUID()}`;
		await fixture.pool.query(
			`insert into kiosk (organization_id, location_id, name, timezone, token_hash, paired_at,
			                    revoked_at, created_by, offline_mode_enabled)
			 values ($1, $2, 'Front door', 'Europe/Berlin', $3, now(), $4, $5, $6)`,
			[
				input.orgId ?? organizationId,
				locationId,
				hashKioskSecret(token),
				input.revoked ? new Date() : null,
				fixture.ownerUserId,
				input.offlineMode ?? false,
			],
		);
		return token;
	}

	async function readEmployees(token: string | null) {
		const response = await getKioskEmployees(
			new Request("http://localhost/api/kiosk/employees", {
				headers: token ? { "x-kiosk-token": token } : {},
			}),
		);
		return {
			status: response.status,
			cacheControl: response.headers.get("cache-control"),
			body: await response.json(),
		};
	}

	beforeAll(async () => {
		fixture = await createLifecycleDatabaseFixture();
		organizationId = fixture.organizationId;
		otherOrganizationId = await fixture.createOrganization();
		store = await createLocation("Store");
		warehouse = await createLocation("Warehouse");
		closedStore = await createLocation("Closed store", organizationId, false);
		foreignStore = await createLocation("Foreign store", otherOrganizationId);

		anna = await employeeNamed("Anna", "Berger", "Anna Berger");
		ben = await employeeNamed(null, null, "ben.kiosk");
		const cleo = await employeeNamed("Cleo", "Schmidt", "Cleo Schmidt", { isActive: false });
		const dora = await employeeNamed("Dora", "Weber", "Dora Weber");
		const finn = await employeeNamed("Finn", "Fremd", "Finn Fremd", { orgId: otherOrganizationId });
		await employeeNamed("Uwe", "Unassigned", "Uwe Unassigned");

		await assign(anna, store);
		await assign(ben, store);
		await assign(cleo, store);
		await assign(dora, warehouse);
		await assign(dora, closedStore);
		await assign(finn, foreignStore, otherOrganizationId);
	});

	afterAll(async () => {
		await fixture?.close();
	});

	it("lists only the active employees assigned to the kiosk's location, with id and name only", async () => {
		const { status, cacheControl, body } = await readEmployees(await kioskToken(store));

		expect(status).toBe(200);
		expect(cacheControl).toBe("no-store");
		expect(body).toEqual({
			employees: [
				{ id: anna.employeeId, name: "Anna Berger" },
				{ id: ben.employeeId, name: "ben.kiosk" },
			],
		});
	});

	it("keeps each kiosk to its own location and organization", async () => {
		expect((await readEmployees(await kioskToken(warehouse))).body).toEqual({
			employees: [{ id: expect.any(String), name: "Dora Weber" }],
		});
		expect((await readEmployees(await kioskToken(closedStore))).body).toEqual({ employees: [] });
		expect(
			(await readEmployees(await kioskToken(foreignStore, { orgId: otherOrganizationId }))).body,
		).toEqual({ employees: [{ id: expect.any(String), name: "Finn Fremd" }] });
	});

	it("opens the kiosk in its organization's default language, English when none is set", async () => {
		async function sessionLanguage(token: string) {
			const response = await getKioskSession(
				new Request("http://localhost/api/kiosk/session", { headers: { "x-kiosk-token": token } }),
			);
			return ((await response.json()) as { kiosk: { language: string } }).kiosk.language;
		}
		await fixture.pool.query(
			`insert into organization_notification_settings (organization_id, default_language)
			 values ($1, 'de')`,
			[organizationId],
		);

		expect(await sessionLanguage(await kioskToken(store))).toBe("de");
		expect(
			await sessionLanguage(await kioskToken(foreignStore, { orgId: otherOrganizationId })),
		).toBe("en");
	});

	describe("offline mode (#1291)", () => {
		async function liveWork(
			person: SeededEmployee,
			startedAt: string,
			orgId = organizationId,
			breakSince: string | null = null,
		) {
			const clockInId = randomUUID();
			const workPeriodId = randomUUID();
			await fixture.pool.query(
				`insert into time_entry (id, employee_id, organization_id, type, timestamp, utc_offset_minutes,
				   timezone, timezone_source, hash, created_by, created_at)
				 values ($1, $2, $3, 'clock_in', $4, 120, 'Europe/Berlin', 'backfill', $5, $6, $4)`,
				[
					clockInId,
					person.employeeId,
					orgId,
					new Date(startedAt),
					`hash-${clockInId}`,
					person.userId,
				],
			);
			await fixture.pool.query(
				`insert into work_period (id, employee_id, organization_id, clock_in_id, start_time, is_active,
				   break_started_at, break_started_zone, break_started_operation_id, updated_at)
				 values ($1, $2, $3, $4, $5, true, $6, $7, $8, now())`,
				[
					workPeriodId,
					person.employeeId,
					orgId,
					clockInId,
					new Date(startedAt),
					breakSince ? new Date(breakSince) : null,
					breakSince ? "Europe/Lisbon" : null,
					breakSince ? randomUUID() : null,
				],
			);
			return workPeriodId;
		}

		let annaWork: string;
		let benWork: string;

		beforeAll(async () => {
			await fixture.pool.query(
				`insert into time_entry_append_control (organization_id, mode) values ($1, 'active')
				 on conflict (organization_id) do update set mode = excluded.mode`,
				[organizationId],
			);
			annaWork = await liveWork(anna, "2026-10-16T06:30:00Z");
			benWork = await liveWork(ben, "2026-10-16T05:00:00Z", organizationId, "2026-10-16T09:15:00Z");
		});

		it("adds each listed employee's current state and when the server read it", async () => {
			const before = Date.now();
			const { status, body } = await readEmployees(await kioskToken(store, { offlineMode: true }));
			const after = Date.now();

			expect(status).toBe(200);
			expect(body.employees).toEqual([
				{ id: anna.employeeId, name: "Anna Berger" },
				{ id: ben.employeeId, name: "ben.kiosk" },
			]);
			expect(body.offline.states).toEqual({
				[anna.employeeId]: {
					status: "clocked_in",
					workPeriodId: annaWork,
					since: "2026-10-16T06:30:00Z",
				},
				[ben.employeeId]: {
					status: "on_break",
					workPeriodId: benWork,
					since: "2026-10-16T05:00:00Z",
					breakSince: "2026-10-16T09:15:00Z",
					breakZone: "Europe/Lisbon",
				},
			});
			const learnedAt = Date.parse(body.offline.learnedAt);
			expect(learnedAt).toBeGreaterThanOrEqual(before - 1000);
			expect(learnedAt).toBeLessThanOrEqual(after + 1000);
			// Never a day total: the kiosk shows it only after a live PIN check.
			expect(JSON.stringify(body)).not.toContain("minutes");
		});

		it("says a clocked-out employee is clocked out", async () => {
			const { body } = await readEmployees(await kioskToken(warehouse, { offlineMode: true }));

			expect(Object.values(body.offline.states)).toEqual([{ status: "clocked_out" }]);
		});

		it("adds the vehicle use each employee is asked, so the vehicle step works offline (#1292)", async () => {
			const offKiosk = await kioskToken(store, { offlineMode: true });
			expect((await readEmployees(offKiosk)).body.offline).not.toHaveProperty("vehicleUse");

			await fixture.pool.query(
				`insert into vehicle_use_setting (organization_id, enabled) values ($1, true)
				 on conflict (organization_id) do update set enabled = excluded.enabled`,
				[organizationId],
			);
			await fixture.pool.query(
				`insert into vehicle_use_assignment (organization_id, assignment_type, priority, mode, created_by)
				 values ($1, 'organization', 0, 'asked', $2)`,
				[organizationId, fixture.ownerUserId],
			);
			try {
				const { body } = await readEmployees(await kioskToken(store, { offlineMode: true }));
				const asked = {
					mode: "asked",
					vehicles: [],
					suggestedVehicleIds: [],
					lastEndKmByVehicleId: {},
					vehiclesOnOtherLiveWork: [],
					live: null,
				};
				expect(body.offline.vehicleUse).toEqual({
					[anna.employeeId]: asked,
					[ben.employeeId]: asked,
				});
				// Kiosks without offline mode never get it without a PIN.
				expect((await readEmployees(await kioskToken(store))).body).not.toHaveProperty("offline");
			} finally {
				await fixture.pool.query("delete from vehicle_use_assignment where organization_id = $1", [
					organizationId,
				]);
				await fixture.pool.query("delete from vehicle_use_setting where organization_id = $1", [
					organizationId,
				]);
			}
		});

		it("adds no state while the switch is off or the organization is not adopted", async () => {
			const off = await readEmployees(await kioskToken(store));
			const legacy = await readEmployees(
				await kioskToken(foreignStore, { orgId: otherOrganizationId, offlineMode: true }),
			);

			expect(off.body).toEqual({
				employees: [
					{ id: anna.employeeId, name: "Anna Berger" },
					{ id: ben.employeeId, name: "ben.kiosk" },
				],
			});
			expect(legacy.body).toEqual({ employees: [{ id: expect.any(String), name: "Finn Fremd" }] });
		});
	});

	it("refuses a missing, unknown or revoked kiosk token without listing anyone", async () => {
		expect(await readEmployees(null)).toMatchObject({
			status: 401,
			body: { code: "kiosk_unknown" },
		});
		expect(await readEmployees("z8k_not-a-kiosk")).toMatchObject({
			status: 401,
			body: { code: "kiosk_unknown" },
		});
		const revoked = await readEmployees(await kioskToken(store, { revoked: true }));
		expect(revoked).toMatchObject({ status: 401, body: { code: "kiosk_revoked" } });
		expect(JSON.stringify(revoked.body)).not.toContain("Anna");
	});
});
