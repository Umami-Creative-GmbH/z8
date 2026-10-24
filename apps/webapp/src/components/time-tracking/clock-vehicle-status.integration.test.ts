import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import {
	createLifecycleDatabaseFixture,
	type LifecycleDatabaseFixture,
} from "@/lib/employee-lifecycle/testing/database.test.fixture";

const actor = vi.hoisted(() => ({
	userId: null as string | null,
	organizationId: null as string | null,
	queries: [] as string[],
	mfaRequired: false,
	ssoRequired: false,
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
				actor.userId
					? {
							mfaRequired: actor.mfaRequired,
							ssoRequired: actor.ssoRequired,
							user: { id: actor.userId, role: "user" },
							session: {
								id: `t1469-${actor.userId}`,
								userId: actor.userId,
								activeOrganizationId: actor.organizationId,
							},
						}
					: null,
		},
	},
}));
vi.mock("@/lib/billing/guard", async () =>
	(await import("@/test/integration-harness")).billingGuard(),
);
vi.mock("@/db", async () =>
	(await import("@/test/integration-database")).integrationDbModule({
		logQuery: (query) => actor.queries.push(query),
	}),
);

import { organizationVehicle, vehicleUseAssignment, vehicleUseSetting } from "@/db/schema";

const { getClockVehicleUseStatus, getClockVehicleUseContext } = await import(
	"@/app/[locale]/(app)/time-tracking/actions/clock-vehicle-use"
);
let fixture: LifecycleDatabaseFixture;
let foreignOrganization: string;
const periodId = randomUUID();
beforeAll(async () => {
	fixture = await createLifecycleDatabaseFixture();
	foreignOrganization = await fixture.createOrganization();
	await fixture.db.insert(vehicleUseSetting).values({
		organizationId: fixture.organizationId,
		enabled: true,
		updatedBy: fixture.ownerUserId,
	});
	await fixture.db.insert(vehicleUseAssignment).values({
		organizationId: fixture.organizationId,
		assignmentType: "organization",
		priority: 0,
		mode: "expected",
		createdBy: fixture.ownerUserId,
	});
	await fixture.db.insert(organizationVehicle).values([
		{
			organizationId: fixture.organizationId,
			name: "Own organization van",
			licencePlate: "T1469 A",
			createdBy: fixture.ownerUserId,
		},
		{
			organizationId: foreignOrganization,
			name: "Foreign van",
			licencePlate: "T1469 B",
			createdBy: fixture.ownerUserId,
		},
	]);
	const entryId = randomUUID();
	await fixture.pool.query(
		`insert into time_entry (id,employee_id,organization_id,type,timestamp,utc_offset_minutes,timezone,timezone_source,hash,created_by) values ($1::uuid,$2,$3,'clock_in','2026-10-24T08:00:00Z',0,'UTC','backfill',$1::text,$4)`,
		[entryId, fixture.employeeId, fixture.organizationId, fixture.ownerUserId],
	);
	await fixture.pool.query(
		`insert into work_period (id,employee_id,organization_id,clock_in_id,start_time,work_location_type,vehicle_kind,odometer_start_km,updated_at) values ($1,$2,$3,$4,'2026-10-24T08:00:00Z','office','own',100,now())`,
		[periodId, fixture.employeeId, fixture.organizationId, entryId],
	);
});
beforeEach(async () => {
	actor.userId = (
		await fixture.pool.query<{ user_id: string }>("select user_id from employee where id=$1", [
			fixture.employeeId,
		])
	).rows[0].user_id;
	actor.organizationId = fixture.organizationId;
	actor.mfaRequired = false;
	actor.ssoRequired = false;
	actor.queries = [];
});
afterAll(async () => fixture?.close());
it("reads fresh operational expectations and live attribution without optional vehicle choices or reading history", async () => {
	const result = await getClockVehicleUseStatus();
	expect(result).toEqual({
		success: true,
		data: {
			mode: "expected",
			live: {
				workPeriodId: periodId,
				vehicleUse: { vehicle: { kind: "own" }, startKm: 100, endKm: null, distanceKm: null },
			},
		},
	});
	expect(actor.queries.some((query) => /organization_vehicle|array_agg/i.test(query))).toBe(false);
	expect(await Response.json(result).json()).toEqual(result);
});
it("keeps the full context reader available on demand with only this organization's choices", async () => {
	const result = await getClockVehicleUseContext();
	expect(result.success && result.data.vehicles.map((vehicle) => vehicle.name)).toEqual([
		"Own organization van",
	]);
	expect(actor.queries.some((query) => /organization_vehicle/.test(query))).toBe(true);
});
it("checks authentication and active-organization membership again for each read", async () => {
	actor.userId = null;
	expect(await getClockVehicleUseStatus()).toMatchObject({
		success: false,
		error: "Not authenticated",
	});
	expect(actor.queries).toEqual([]);
	actor.userId = fixture.ownerUserId;
	actor.organizationId = foreignOrganization;
	expect(await getClockVehicleUseStatus()).toMatchObject({
		success: false,
		error: "Employee profile not found",
	});
});
it("observes disabled vehicle use immediately without losing already recorded live attribution", async () => {
	await fixture.pool.query(
		"update vehicle_use_setting set enabled=false where organization_id=$1",
		[fixture.organizationId],
	);
	try {
		expect(await getClockVehicleUseStatus()).toMatchObject({
			success: true,
			data: {
				mode: "off",
				live: { workPeriodId: periodId, vehicleUse: { vehicle: { kind: "own" }, startKm: 100 } },
			},
		});
	} finally {
		await fixture.pool.query(
			"update vehicle_use_setting set enabled=true where organization_id=$1",
			[fixture.organizationId],
		);
	}
});
it("excludes deleted live work without loading optional choices", async () => {
	await fixture.pool.query("update work_period set deleted_at=now() where id=$1", [periodId]);
	try {
		expect(await getClockVehicleUseStatus()).toEqual({
			success: true,
			data: { mode: "expected", live: null },
		});
		expect(actor.queries.some((query) => /organization_vehicle|array_agg/i.test(query))).toBe(
			false,
		);
	} finally {
		await fixture.pool.query("update work_period set deleted_at=null where id=$1", [periodId]);
	}
});

it.each(["mfa", "sso"])(
	"denies a public operational read while %s admission is required",
	async (required) => {
		actor.mfaRequired = required === "mfa";
		actor.ssoRequired = required === "sso";
		expect(await getClockVehicleUseStatus()).toMatchObject({ success: false });
		expect(await getClockVehicleUseContext()).toMatchObject({ success: false });
		expect(
			actor.queries.some((query) =>
				/work_period|vehicle_use_setting|organization_vehicle/.test(query),
			),
		).toBe(false);
	},
);

it.each(["inactive", "unapproved"])(
	"denies %s employees before returning operational data",
	async (denied) => {
		if (denied === "inactive")
			await fixture.pool.query("update employee set is_active=false where id=$1", [
				fixture.employeeId,
			]);
		else
			await fixture.pool.query(
				"update member set status='pending' where user_id=$1 and organization_id=$2",
				[actor.userId, fixture.organizationId],
			);
		try {
			expect(await getClockVehicleUseStatus()).toMatchObject({ success: false });
			expect(await getClockVehicleUseContext()).toMatchObject({ success: false });
			expect(
				actor.queries.some((query) => /from "work_period"|from "organization_vehicle"/.test(query)),
			).toBe(false);
		} finally {
			await fixture.pool.query("update employee set is_active=true where id=$1", [
				fixture.employeeId,
			]);
			await fixture.pool.query(
				"update member set status='approved' where user_id=$1 and organization_id=$2",
				[actor.userId, fixture.organizationId],
			);
		}
	},
);
