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
		input: { orgId?: string; revoked?: boolean } = {},
	): Promise<string> {
		const token = `z8k_t862-${randomUUID()}`;
		await fixture.pool.query(
			`insert into kiosk (organization_id, location_id, name, timezone, token_hash, paired_at,
			                    revoked_at, created_by)
			 values ($1, $2, 'Front door', 'Europe/Berlin', $3, now(), $4, $5)`,
			[
				input.orgId ?? organizationId,
				locationId,
				hashKioskSecret(token),
				input.revoked ? new Date() : null,
				fixture.ownerUserId,
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
