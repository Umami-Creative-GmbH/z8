/**
 * Vehicle use through the Teams bot (#1125, spec #807; ADR 0009) on PostgreSQL.
 *
 * The real Teams handler runs the shared bot clock commands and the shared live
 * clock core. A clock command commits first; while vehicle use is asked or
 * expected its reply carries a card that asks the vehicle and readings, with the
 * assigned vehicle suggested and the start reading pre-filled. Saving the card
 * records vehicle use on the work the command started (a live attribution
 * change) or closed (a completion of the clock-out); skipping leaves the clock
 * command without vehicle use. Nothing is asked while vehicle use is off.
 *
 * Only the Teams transport, conversation bookkeeping, the tenant lookup,
 * billing, the Next request/cache boundaries and the clock are replaced.
 */

import type { TurnContext } from "botbuilder";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Instant } from "@/lib/datetime/temporal-core";
import { integrationAdminPool } from "@/test/integration-database";

const harness = vi.hoisted(() => ({ now: null as Instant | null }));

vi.mock("@/lib/datetime/temporal-core", async (importOriginal) => {
	const original = await importOriginal<typeof import("@/lib/datetime/temporal-core")>();
	return {
		...original,
		systemClock: Object.freeze({
			nowInstant: () => harness.now ?? original.systemClock.nowInstant(),
		}),
	};
});
vi.mock("next/server", async (importOriginal) =>
	(await import("@/test/integration-harness")).nextServer(importOriginal),
);
vi.mock("next/headers", async () => (await import("@/test/integration-harness")).nextHeaders());
vi.mock("next/cache", async (importOriginal) =>
	(await import("@/test/integration-harness")).nextCache(importOriginal),
);
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: async () => null } } }));
vi.mock("@/lib/billing/guard", async () =>
	(await import("@/test/integration-harness")).billingGuard(),
);
vi.mock("@/lib/teams/conversation-manager", () => ({
	saveConversationReference: async () => undefined,
	deactivateConversation: async () => undefined,
}));
vi.mock("@/lib/teams/tenant-resolver", () => ({
	resolveTenant: async (tenantId: string) => ({
		status: "configured",
		tenant: {
			tenantId,
			organizationId: ids.organization,
			enableApprovals: true,
			enableCommands: true,
			enableDailyDigest: false,
			enableEscalations: false,
			digestTime: "08:00",
			digestTimezone: "UTC",
			escalationTimeoutHours: 24,
		},
	}),
	updateTenantServiceUrl: async () => undefined,
}));

const { parseInstant } = await import("@/lib/datetime/temporal-core");
const { handleBotActivity } = await import("@/lib/teams/bot-handler");
const { TEAMS_VEHICLE_USE_VERBS } = await import("@/lib/teams/vehicle-use-card");

const ids = {
	organization: "t1125-teams-org",
	user: "t1125-driver-user",
	employee: "f1125000-0000-4000-8000-000000000001",
	van: "f1125000-0000-4000-8000-0000000000a1",
	truck: "f1125000-0000-4000-8000-0000000000a2",
	tenant: "t1125-tenant",
	platformUser: "t1125-aad-user",
	unknownWork: "f1125000-0000-4000-8000-0000000000ff",
} as const;

const clockInAt = parseInstant("2026-09-21T07:00:00Z");

type Activity = Record<string, unknown>;
type Card = {
	body: Record<string, unknown>[];
	actions: { verb: string; data: Record<string, unknown> }[];
};

let invocation = 0;

/** Sends a message through the Teams handler; returns every activity it sent. */
async function message(text: string, at: Instant): Promise<unknown[]> {
	harness.now = at;
	const sent: unknown[] = [];
	await handleBotActivity({
		activity: {
			type: "message",
			id: `activity-${++invocation}`,
			text,
			conversation: { id: "a:t1125-conversation", tenantId: ids.tenant },
			from: { aadObjectId: ids.platformUser, name: "Driver" },
		},
		sendActivity: async (activity: unknown) => {
			sent.push(activity);
		},
	} as unknown as TurnContext);
	return sent;
}

/** Presses a card action; returns the invoke response. */
async function press(
	verb: string,
	data: Record<string, unknown>,
	at: Instant,
): Promise<{ status: number; body: Record<string, unknown> }> {
	harness.now = at;
	const sent: Activity[] = [];
	await handleBotActivity({
		activity: {
			type: "invoke",
			name: "adaptiveCard/action",
			id: `invoke-${++invocation}`,
			channelId: "msteams",
			replyToId: "card-activity",
			conversation: {
				id: "a:t1125-conversation",
				tenantId: ids.tenant,
				conversationType: "personal",
			},
			from: { aadObjectId: ids.platformUser, name: "Driver" },
			value: { action: { type: "Action.Execute", verb, data }, trigger: "manual" },
		},
		sendActivity: async (activity: Activity) => {
			sent.push(activity);
		},
	} as unknown as TurnContext);
	const [response] = sent.filter((activity) => activity.type === "invokeResponse");
	if (sent.length !== 1 || !response) throw new Error("Expected exactly one invoke response");
	return response.value as { status: number; body: Record<string, unknown> };
}

/** The one reply's text and vehicle use card, or a plain text reply. */
function reply(sent: unknown[]): { text: string; card: Card | null } {
	expect(sent).toHaveLength(1);
	const [only] = sent;
	if (typeof only === "string") return { text: only, card: null };
	const activity = only as { text: string; attachments: { content: Card }[] };
	return { text: activity.text, card: activity.attachments[0]?.content ?? null };
}

function inputs(card: Card | null) {
	return (card?.body ?? []).filter((element) => String(element.type).startsWith("Input."));
}

function saveData(card: Card | null): Record<string, unknown> {
	const save = card?.actions.find((action) => action.verb === TEAMS_VEHICLE_USE_VERBS.save);
	if (!save) throw new Error("No save action");
	return save.data;
}

function outcome(response: { body: Record<string, unknown> }): string {
	expect(response.body).toMatchObject({
		statusCode: 200,
		type: "application/vnd.microsoft.card.adaptive",
	});
	const card = response.body.value as { body: { text: string }[]; actions?: unknown };
	expect(card.actions).toBeUndefined();
	return card.body.map((block) => block.text).join(" ");
}

describe("vehicle use through the Teams bot on PostgreSQL", () => {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
	const admin = integrationAdminPool();

	async function setAdmission(mode: "active" | "inactive") {
		await admin.query(
			`insert into time_entry_append_control (organization_id, mode) values ($1, $2)
			 on conflict (organization_id) do update set mode = excluded.mode, updated_at = now()`,
			[ids.organization, mode],
		);
	}

	async function setVehicleUse(mode: "off" | "asked" | "expected") {
		await admin.query(
			`insert into vehicle_use_setting (organization_id, enabled) values ($1, true)
			 on conflict (organization_id) do update set enabled = excluded.enabled`,
			[ids.organization],
		);
		await admin.query("delete from vehicle_use_assignment where organization_id = $1", [
			ids.organization,
		]);
		await admin.query(
			`insert into vehicle_use_assignment (organization_id, assignment_type, priority, mode, created_by)
			 values ($1, 'organization', 0, $2, $3)`,
			[ids.organization, mode, ids.user],
		);
	}

	/** Each work period's vehicle columns, oldest first, with its canonical record's. */
	async function periods() {
		const { rows } = await admin.query(
			`select p.id, p.is_active as active, p.vehicle_kind, p.vehicle_id, p.odometer_start_km,
			        p.odometer_end_km, p.driven_distance_km,
			        case when w.record_id is null then null else json_build_object(
			          'vehicle_kind', w.vehicle_kind, 'vehicle_id', w.vehicle_id,
			          'odometer_start_km', w.odometer_start_km, 'odometer_end_km', w.odometer_end_km,
			          'driven_distance_km', w.driven_distance_km) end as record
			   from work_period p
			   left join time_record_work w on w.record_id = p.canonical_record_id
			  where p.organization_id = $1 and p.deleted_at is null
			  order by p.start_time`,
			[ids.organization],
		);
		return rows;
	}

	async function cleanup() {
		await admin.query("delete from organization where id = $1", [ids.organization]);
		await admin.query('delete from "user" where id = $1', [ids.user]);
	}

	beforeEach(async () => {
		await cleanup();
		const timestamp = new Date("2026-07-01T00:00:00Z");
		await admin.query(
			"insert into organization (id, name, slug, created_at) values ($1, $1, $1, $2)",
			[ids.organization, timestamp],
		);
		await admin.query(
			`insert into approval_workflow_rollout
			 (organization_id, workflow_type, lifecycle_mode, side_effect_mode, created_at, updated_at)
			 values ($1, 'policy_clock_out', 'legacy', 'legacy', $2, $2)`,
			[ids.organization, timestamp],
		);
		await admin.query(
			`insert into "user" (id, name, email, created_at, updated_at)
			 values ($1, 'Driver', 't1125-driver@example.test', $2, $2)`,
			[ids.user, timestamp],
		);
		await admin.query(
			`insert into member (id, organization_id, user_id, role, status, created_at)
			 values ('t1125-member', $1, $2, 'member', 'approved', $3)`,
			[ids.organization, ids.user, timestamp],
		);
		await admin.query(
			`insert into employee (id, user_id, organization_id, role, updated_at)
			 values ($1, $2, $3, 'employee', $4)`,
			[ids.employee, ids.user, ids.organization, timestamp],
		);
		await admin.query(
			"insert into user_settings (user_id, timezone, updated_at) values ($1, 'UTC', $2)",
			[ids.user, timestamp],
		);
		await admin.query(
			`insert into teams_user_mapping (user_id, organization_id, teams_user_id, teams_email, teams_tenant_id, updated_at)
			 values ($1, $2, $3, 't1125-driver@example.test', $4, now())`,
			[ids.user, ids.organization, ids.platformUser, ids.tenant],
		);
		await admin.query(
			`insert into organization_vehicle (id, organization_id, name, licence_plate) values
			 ($1, $3, 'Van', 'M-VW 1'), ($2, $3, 'Truck', 'M-TR 2')`,
			[ids.van, ids.truck, ids.organization],
		);
		// The van is the employee's assigned vehicle.
		await admin.query(
			`insert into organization_vehicle_driver (organization_id, vehicle_id, employee_id)
			 values ($1, $2, $3)`,
			[ids.organization, ids.van, ids.employee],
		);
		await setVehicleUse("asked");
		await setAdmission("active");
	});

	afterAll(async () => {
		await cleanup();
	});

	it.each(["active", "inactive"] as const)(
		"asks clock-in and clock-out for vehicle use and records what is saved (admission %s)",
		async (admission) => {
			await setAdmission(admission);

			// Clock-in commits first; the card asks the vehicle, the assigned van suggested.
			const clockedIn = reply(await message("clockin", clockInAt));
			expect(clockedIn.text).toBe("Clocked in at 07:00.");
			expect(inputs(clockedIn.card)).toEqual([
				expect.objectContaining({ id: "vehicle", value: ids.van }),
				expect.objectContaining({ id: "startKm" }),
			]);
			// No earlier reading to pre-fill.
			expect(inputs(clockedIn.card)[1]).not.toHaveProperty("value");
			expect((await periods())[0]).toMatchObject({ active: true, vehicle_kind: null });

			const saved = await press(
				TEAMS_VEHICLE_USE_VERBS.save,
				{ ...saveData(clockedIn.card), vehicle: ids.van, startKm: "12000" },
				clockInAt.add({ minutes: 1 }),
			);
			expect(outcome(saved)).toContain("Vehicle use saved");
			expect(await periods()).toEqual([
				expect.objectContaining({
					active: true,
					vehicle_kind: "organization",
					vehicle_id: ids.van,
					odometer_start_km: 12_000,
					odometer_end_km: null,
				}),
			]);

			// Clock-out commits first; the card asks the end reading of the van's drive.
			const clockedOut = reply(await message("clockout", clockInAt.add({ hours: 4 })));
			expect(clockedOut.text).toContain("Clocked out at 11:00.");
			expect(inputs(clockedOut.card)).toEqual([
				expect.objectContaining({ id: "endKm", min: 12_000 }),
			]);
			const ended = await press(
				TEAMS_VEHICLE_USE_VERBS.save,
				{ ...saveData(clockedOut.card), endKm: "12085" },
				clockInAt.add({ hours: 4, minutes: 1 }),
			);
			expect(outcome(ended)).toContain("Vehicle use saved");
			const van = {
				vehicle_kind: "organization",
				vehicle_id: ids.van,
				odometer_start_km: 12_000,
				odometer_end_km: 12_085,
				driven_distance_km: 85,
			};
			expect(await periods()).toEqual([
				expect.objectContaining({ active: false, ...van, record: van }),
			]);

			// The next clock-in pre-fills the van's last end reading.
			const next = reply(await message("clockin", clockInAt.add({ hours: 5 })));
			expect(inputs(next.card)).toEqual([
				expect.objectContaining({ id: "vehicle", value: ids.van }),
				expect.objectContaining({ id: "startKm", value: 12_085 }),
			]);
		},
	);

	it("skipping records the clock commands without vehicle use", async () => {
		await setVehicleUse("expected");
		const clockedIn = reply(await message("clockin", clockInAt));
		expect(clockedIn.card).not.toBeNull();
		const skipped = await press(
			TEAMS_VEHICLE_USE_VERBS.skip,
			{ s: "clock_in", w: saveData(clockedIn.card).w },
			clockInAt.add({ minutes: 1 }),
		);
		expect(outcome(skipped)).toContain("No vehicle use recorded");

		// Without a vehicle, clock-out asks the vehicle and both readings.
		const clockedOut = reply(await message("clockout", clockInAt.add({ hours: 4 })));
		expect(inputs(clockedOut.card).map((input) => input.id)).toEqual([
			"vehicle",
			"startKm",
			"endKm",
		]);
		await press(
			TEAMS_VEHICLE_USE_VERBS.skip,
			{ s: "clock_out", w: saveData(clockedOut.card).w },
			clockInAt.add({ hours: 4, minutes: 1 }),
		);

		expect(await periods()).toEqual([
			expect.objectContaining({
				active: false,
				vehicle_kind: null,
				record: expect.objectContaining({ vehicle_kind: null }),
			}),
		]);
	});

	it("records vehicle and readings on closed work that recorded no vehicle", async () => {
		reply(await message("clockin", clockInAt));
		const clockedOut = reply(await message("clockout", clockInAt.add({ hours: 4 })));

		const saved = await press(
			TEAMS_VEHICLE_USE_VERBS.save,
			{ ...saveData(clockedOut.card), vehicle: ids.truck, startKm: "500", endKm: "530" },
			clockInAt.add({ hours: 4, minutes: 2 }),
		);

		expect(outcome(saved)).toContain("Vehicle use saved");
		const truck = {
			vehicle_kind: "organization",
			vehicle_id: ids.truck,
			odometer_start_km: 500,
			odometer_end_km: 530,
			driven_distance_km: 30,
		};
		expect(await periods()).toEqual([expect.objectContaining({ ...truck, record: truck })]);
	});

	it("asks nothing while vehicle use is off", async () => {
		await setVehicleUse("off");

		expect(reply(await message("clockin", clockInAt))).toEqual({
			text: "Clocked in at 07:00.",
			card: null,
		});
		expect(reply(await message("clockout", clockInAt.add({ hours: 1 })))).toEqual({
			text: "Clocked out at 08:00. Duration: 1h 0m.",
			card: null,
		});
	});

	it("keeps the card for an entry that cannot be read, and changes nothing", async () => {
		const clockedIn = reply(await message("clockin", clockInAt));

		const response = await press(
			TEAMS_VEHICLE_USE_VERBS.save,
			{ ...saveData(clockedIn.card), vehicle: ids.van, startKm: "12.5" },
			clockInAt.add({ minutes: 1 }),
		);

		expect(response.body).toMatchObject({
			statusCode: 400,
			type: "application/vnd.microsoft.error",
			value: { message: "Readings must be whole kilometres." },
		});
		expect((await periods())[0]).toMatchObject({ vehicle_kind: null });
	});

	it("records nothing on work that is not the pressing employee's", async () => {
		const response = await press(
			TEAMS_VEHICLE_USE_VERBS.save,
			{ s: "clock_in", w: ids.unknownWork, vehicle: ids.van, startKm: "1" },
			clockInAt,
		);

		expect(outcome(response)).toContain("no longer clocked in");
		expect(await periods()).toEqual([]);
	});

	it("no longer completes a clock-out the next day", async () => {
		reply(await message("clockin", clockInAt));
		const clockedOut = reply(await message("clockout", clockInAt.add({ hours: 4 })));

		const response = await press(
			TEAMS_VEHICLE_USE_VERBS.save,
			{ ...saveData(clockedOut.card), vehicle: ids.van, endKm: "100" },
			clockInAt.add({ hours: 4 + 13 }),
		);

		expect(outcome(response)).toContain("Add vehicle use to this work in Z8");
		expect((await periods())[0]).toMatchObject({ vehicle_kind: null });
	});
});
