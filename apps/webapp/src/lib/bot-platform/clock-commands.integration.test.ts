/**
 * #277 / T13 runtime evidence: clocking through all four bot adapters.
 *
 * Local contract: pnpm --filter webapp test:approval-workflow-repository:integration
 * The runner creates, migrates, verifies, and removes a label-owned PostgreSQL 16 database.
 *
 * The real Slack, Telegram, Discord and Teams handlers run the shared command
 * registry, the shared bot clock commands and the shared live clock core against
 * that database, including real provider-user resolution and translations. Only
 * the provider HTTP transport, conversation bookkeeping, the Teams tenant lookup,
 * billing provisioning, the Next request/cache boundaries and the clock are
 * replaced. Adoption is enabled per organization by inserting its append control
 * row directly: production has no activation setter.
 */

import type { TurnContext } from "botbuilder";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
	resolveApprovalWorkflowRepositoryTestConfiguration,
	verifyApprovalWorkflowRepositoryTestDatabase,
} from "@/lib/approvals/workflow/repository-integration-harness";
import type { Instant } from "@/lib/datetime/temporal-core";

const harness = vi.hoisted(() => ({
	now: null as Instant | null,
	telegram: [] as string[],
	discord: [] as unknown[],
	discordFailures: 0,
}));

vi.mock("@/db", async () => {
	const { Pool } = await import("pg");
	const { drizzle } = await import("drizzle-orm/node-postgres");
	const authSchema = await import("@/db/auth-schema");
	const schema = await import("@/db/schema");
	const { configurePostgresUtcTypes, withUtcPostgresSession } = await import("@/db/postgres-utc");
	configurePostgresUtcTypes();
	const pool = new Pool(
		withUtcPostgresSession({
			connectionString:
				process.env.APPROVAL_WORKFLOW_REPOSITORY_TEST_DATABASE_URL ??
				"postgresql://unconfigured@127.0.0.1:1/unconfigured",
			max: 8,
		}),
	);
	const db = drizzle({ client: pool, schema: { ...authSchema, ...schema } });
	return { ...authSchema, ...schema, db, pool };
});

vi.mock("@/lib/datetime/temporal-core", async (importOriginal) => {
	const original = await importOriginal<typeof import("@/lib/datetime/temporal-core")>();
	return {
		...original,
		systemClock: Object.freeze({
			nowInstant: () => harness.now ?? original.systemClock.nowInstant(),
		}),
	};
});

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

vi.mock("next/cache", async (importOriginal) => ({
	...(await importOriginal<typeof import("next/cache")>()),
	revalidatePath: vi.fn(),
	revalidateTag: vi.fn(),
}));

// Bots never read a web session.
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: async () => null } } }));

vi.mock("@/lib/billing/guard", () => ({
	requireBillingForMutation: async () => ({ canAccess: true }),
	isBillingMutationAllowed: (access: { canAccess: boolean }) => access.canAccess,
}));

vi.mock("@/lib/telegram/api", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/telegram/api")>()),
	sendMessage: async (_token: string, message: { text: string }) => {
		harness.telegram.push(message.text);
		return { message_id: harness.telegram.length };
	},
}));
vi.mock("@/lib/discord/api", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/discord/api")>()),
	createInteractionResponse: async () => undefined,
	createFollowupMessage: async (
		_token: string,
		_app: string,
		_interaction: string,
		body: unknown,
	) => {
		if (harness.discordFailures > 0) {
			harness.discordFailures -= 1;
			throw new Error("Discord follow-up unavailable");
		}
		harness.discord.push(body);
		return {};
	},
}));
vi.mock("@/lib/slack/conversation-manager", () => ({ saveConversation: async () => undefined }));
vi.mock("@/lib/telegram/conversation-manager", () => ({ saveConversation: async () => undefined }));
vi.mock("@/lib/discord/conversation-manager", () => ({ saveConversation: async () => undefined }));
vi.mock("@/lib/teams/conversation-manager", () => ({
	saveConversationReference: async () => undefined,
	deactivateConversation: async () => undefined,
}));
vi.mock("@/lib/teams/tenant-resolver", () => ({
	resolveTenant: async (tenantId: string) => ({
		status: "configured",
		tenant: { tenantId, organizationId: ids.organization, ...botSettings },
	}),
	updateTenantServiceUrl: async () => undefined,
}));

const { parseInstant } = await import("@/lib/datetime/temporal-core");
const { handleSlashCommand } = await import("@/lib/slack/bot-handler");
const { handleTelegramUpdate } = await import("@/lib/telegram/bot-handler");
const { handleDiscordInteraction } = await import("@/lib/discord/bot-handler");
const { InteractionType } = await import("@/lib/discord/types");
const { handleBotActivity } = await import("@/lib/teams/bot-handler");

const databaseUrl = process.env.APPROVAL_WORKFLOW_REPOSITORY_TEST_DATABASE_URL;
const testSentinel = process.env.APPROVAL_WORKFLOW_REPOSITORY_TEST_SENTINEL;
const integrationRequired = process.env.APPROVAL_WORKFLOW_REPOSITORY_TEST_REQUIRED === "1";
const integrationConfiguration = resolveApprovalWorkflowRepositoryTestConfiguration({
	databaseUrl,
	required: integrationRequired,
	sentinel: testSentinel,
});
if (integrationConfiguration.status === "error") {
	throw new Error(
		`Invalid approval workflow repository test configuration: ${integrationConfiguration.reason}`,
	);
}
const describeIntegration =
	integrationConfiguration.status === "enabled" ? describe : describe.skip;
if (integrationConfiguration.status === "unavailable") {
	describe.skip(`bot clocking PostgreSQL unavailable: ${integrationConfiguration.reason}`, () => {
		it("requires the label-owned disposable PostgreSQL runner", () => {});
	});
}

const ids = {
	organization: "t277-bot-clock-org",
	otherOrganization: "t277-bot-clock-other-org",
	user: "t277-requester-user",
	requester: "e7700000-0000-4000-8000-000000000001",
	requesterElsewhere: "e7700000-0000-4000-8000-000000000002",
	slackTeam: "T277",
	teamsTenant: "t277-tenant",
	platformUser: "277001",
	project: "e7700000-0000-4000-8000-000000000010",
	changePolicy: "e7700000-0000-4000-8000-000000000020",
	changePolicyAssignment: "e7700000-0000-4000-8000-000000000021",
} as const;

const botSettings = {
	enableApprovals: true,
	enableCommands: true,
	enableDailyDigest: false,
	enableEscalations: false,
	digestTime: "08:00",
	digestTimezone: "UTC",
	escalationTimeoutHours: 24,
};

const platforms = ["slack", "telegram", "discord", "teams"] as const;
type Platform = (typeof platforms)[number];

const clockInAt = parseInstant("2026-07-22T08:00:00Z");
const unconfirmedClockOut =
	"Your clock-out could not be confirmed. Check your status before trying again.";
const unconfirmedClockIn =
	"Your clock-in could not be confirmed. Check your status before trying again.";

const modes = [
	["adopted", "active"],
	["pre-adoption", "inactive"],
] as const;
type AdmissionMode = (typeof modes)[number][1];

/** Every write the closure makes in its transaction, per admission mode. */
const closureWrites: Record<AdmissionMode, readonly (readonly [string, string])[]> = {
	active: [
		["time_record", "insert"],
		["time_record_work", "insert"],
		["time_record_allocation", "insert"],
		["time_entry", "insert"],
		["time_entry_append_position", "update"],
		// Also advances the graph revision.
		["work_period", "update"],
		["employee_work_balance", "insert"],
		["completed_work_operation", "insert"],
	],
	// Before adoption the balance refresh is post-commit and omission clears the
	// project, so there is no allocation, position or receipt write.
	inactive: [
		["time_record", "insert"],
		["time_record_work", "insert"],
		["time_entry", "insert"],
		["work_period", "update"],
	],
};

/** Every write a clock-in makes in its transaction, per admission mode. */
const startWrites: Record<AdmissionMode, readonly (readonly [string, string])[]> = {
	active: [
		["time_entry", "insert"],
		["time_entry_append_position", "insert"],
		["work_period", "insert"],
	],
	inactive: [
		["time_entry", "insert"],
		["work_period", "insert"],
	],
};

function only<T>(rows: readonly T[]): T {
	const [row] = rows;
	if (rows.length !== 1 || row === undefined) {
		throw new Error(`Expected exactly one row, received ${rows.length}`);
	}
	return row;
}

/** Sends one command through the real adapter and returns the reply it delivered. */
async function send(platform: Platform, command: "clockin" | "clockout", at: Instant) {
	harness.now = at;
	switch (platform) {
		case "slack": {
			const reply = await handleSlashCommand(
				{
					text: command,
					user_id: ids.platformUser,
					user_name: "requester",
					channel_id: "D277",
					team_id: ids.slackTeam,
				} as never,
				{
					organizationId: ids.organization,
					botAccessToken: "slack-token",
					slackTeamId: ids.slackTeam,
					slackTeamName: "T277",
					botUserId: "B277",
					setupStatus: "active",
					...botSettings,
				},
			);
			return reply.text;
		}
		case "telegram": {
			const before = harness.telegram.length;
			await handleTelegramUpdate(
				{
					update_id: 1,
					message: {
						message_id: 1,
						date: 0,
						text: `/${command}`,
						chat: { id: 277, type: "private" },
						from: { id: Number(ids.platformUser), is_bot: false, first_name: "Requester" },
					},
				} as never,
				{
					organizationId: ids.organization,
					botToken: "telegram-token",
					botUsername: "z8_bot",
					webhookSecret: "secret",
					setupStatus: "active",
					...botSettings,
				},
			);
			return harness.telegram.slice(before).join("\n");
		}
		case "discord": {
			const before = harness.discord.length;
			await handleDiscordInteraction(
				{
					id: "interaction-277",
					token: "interaction-token",
					type: InteractionType.APPLICATION_COMMAND,
					data: { name: command },
					user: { id: ids.platformUser, username: "requester" },
					channel_id: "channel-277",
				} as never,
				{
					organizationId: ids.organization,
					botToken: "discord-token",
					applicationId: "application-277",
					publicKey: "key",
					webhookSecret: "secret",
					setupStatus: "active",
					...botSettings,
				},
			);
			return JSON.stringify(harness.discord.slice(before));
		}
		case "teams": {
			const replies: string[] = [];
			await handleBotActivity({
				activity: {
					type: "message",
					text: command,
					conversation: { tenantId: ids.teamsTenant },
					from: { aadObjectId: ids.platformUser, name: "Requester" },
				},
				sendActivity: async (message: unknown) => {
					replies.push(String(message));
				},
			} as unknown as TurnContext);
			return replies.join("\n");
		}
	}
}

describeIntegration("bot clocking through the shared clock commands on PostgreSQL", () => {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
	const admin = new Pool({ connectionString: databaseUrl, max: 4 });

	async function setAdmission(mode: "active" | "inactive") {
		await admin.query(
			`insert into time_entry_append_control (organization_id, mode) values ($1, $2)
			 on conflict (organization_id) do update set mode = excluded.mode, updated_at = now()`,
			[ids.organization, mode],
		);
	}

	/** Every row a clock command can write, in both organizations. */
	async function snapshot() {
		const { rows } = await admin.query(
			`select
			   (select json_agg(row_to_json(t) order by t.id) from work_period t where organization_id = any($1)) as periods,
			   (select json_agg(row_to_json(t) order by t.id) from time_entry t where organization_id = any($1)) as entries,
			   (select json_agg(row_to_json(t) order by t.id) from time_record t where organization_id = any($1)) as records,
			   (select json_agg(row_to_json(t) order by t.record_id) from time_record_work t where organization_id = any($1)) as works,
			   (select json_agg(row_to_json(t) order by t.id) from time_record_allocation t where organization_id = any($1)) as allocations,
			   (select json_agg(row_to_json(t) order by t.employee_id) from time_entry_append_position t where organization_id = any($1)) as positions,
			   (select json_agg(row_to_json(t) order by t.employee_id) from employee_work_balance t where organization_id = any($1)) as balances,
			   (select json_agg(row_to_json(t) order by t.id) from completed_work_operation t where organization_id = any($1)) as receipts,
			   (select count(*)::int from approval_request where organization_id = any($1)) as approval_requests`,
			[[ids.organization, ids.otherOrganization]],
		);
		return only(rows);
	}

	async function activePeriod() {
		const { rows } = await admin.query<{ id: string; clock_in_id: string }>(
			"select id, clock_in_id from work_period where employee_id = $1 and end_time is null",
			[ids.requester],
		);
		return only(rows);
	}

	async function closedGraph(periodId: string) {
		const { rows } = await admin.query(
			`select wp.is_active, wp.end_time, wp.duration_minutes, wp.clock_out_id, wp.approval_status,
			        wp.graph_revision, tr.duration_minutes as record_duration, tr.approval_state as record_state,
			        tr.origin as record_origin, tr.created_by as record_created_by,
			        tr.start_at as record_start, tr.end_at as record_end, w.work_location_type,
			        out.device_info, out.ip_address, out.created_by as entry_created_by,
			        out.previous_entry_id, out.timezone_source
			 from work_period wp
			 join time_record tr on tr.id = wp.canonical_record_id and tr.organization_id = wp.organization_id
			 join time_record_work w on w.record_id = tr.id
			 join time_entry out on out.id = wp.clock_out_id
			 where wp.id = $1`,
			[periodId],
		);
		return only(rows);
	}

	async function receipts() {
		const { rows } = await admin.query(
			`select id, writer, writer_version, append_admission, actor_kind, actor_user_id, work_period_id,
			        command, result -> 'segment' as segment
			 from completed_work_operation where organization_id = $1`,
			[ids.organization],
		);
		return rows;
	}

	async function cleanup() {
		await admin.query("drop function if exists t277_fail() cascade");
		await admin.query("delete from organization where id = any($1)", [
			[ids.organization, ids.otherOrganization],
		]);
		await admin.query('delete from "user" where id = $1', [ids.user]);
	}

	async function seed() {
		await cleanup();
		const timestamp = new Date("2026-07-01T00:00:00Z");
		await admin.query(
			`insert into organization (id, name, slug, created_at)
			 values ($1, 'T277 bots', $1, $3), ($2, 'T277 other', $2, $3)`,
			[ids.organization, ids.otherOrganization, timestamp],
		);
		await admin.query(
			`insert into approval_workflow_rollout
			 (organization_id, workflow_type, lifecycle_mode, side_effect_mode, created_at, updated_at)
			 values ($1, 'policy_clock_out', 'legacy', 'legacy', $2, $2)`,
			[ids.organization, timestamp],
		);
		await admin.query(
			`insert into "user" (id, name, email, created_at, updated_at)
			 values ($1, 'Requester', 't277-requester@example.test', $2, $2)`,
			[ids.user, timestamp],
		);
		// The same person is an approved member and active employee of both organizations.
		await admin.query(
			`insert into member (id, organization_id, user_id, role, status, created_at)
			 values ('t277-member-1', $1, $3, 'member', 'approved', $4),
			        ('t277-member-2', $2, $3, 'member', 'approved', $4)`,
			[ids.organization, ids.otherOrganization, ids.user, timestamp],
		);
		await admin.query(
			`insert into employee (id, user_id, organization_id, role, updated_at)
			 values ($1, $3, $4, 'employee', $6), ($2, $3, $5, 'employee', $6)`,
			[
				ids.requester,
				ids.requesterElsewhere,
				ids.user,
				ids.organization,
				ids.otherOrganization,
				timestamp,
			],
		);
		await admin.query(
			"insert into user_settings (user_id, timezone, updated_at) values ($1, 'UTC', $2)",
			[ids.user, timestamp],
		);
		await admin.query(
			`insert into project (id, organization_id, name, status, is_active, created_by, updated_at)
			 values ($1, $2, 'T277 project', 'active', true, $3, $4)`,
			[ids.project, ids.organization, ids.user, timestamp],
		);
		await admin.query(
			`insert into slack_user_mapping (user_id, organization_id, slack_user_id, slack_team_id, updated_at)
			 values ($1, $2, $3, $4, now())`,
			[ids.user, ids.organization, ids.platformUser, ids.slackTeam],
		);
		await admin.query(
			`insert into telegram_user_mapping (user_id, organization_id, telegram_user_id, updated_at)
			 values ($1, $2, $3, now())`,
			[ids.user, ids.organization, ids.platformUser],
		);
		await admin.query(
			`insert into discord_user_mapping (user_id, organization_id, discord_user_id, updated_at)
			 values ($1, $2, $3, now())`,
			[ids.user, ids.organization, ids.platformUser],
		);
		await admin.query(
			`insert into teams_user_mapping (user_id, organization_id, teams_user_id, teams_email, teams_tenant_id, updated_at)
			 values ($1, $2, $3, 't277-requester@example.test', $4, now())`,
			[ids.user, ids.organization, ids.platformUser, ids.teamsTenant],
		);
		await setAdmission("active");
	}

	beforeAll(async () => {
		const enabled = await verifyApprovalWorkflowRepositoryTestDatabase({
			databaseUrl,
			required: integrationRequired,
			sentinel: testSentinel,
			currentDatabase: async () => {
				const result = await admin.query<{ database_name: string }>(
					"select current_database() as database_name",
				);
				return result.rows[0]?.database_name ?? "";
			},
		});
		if (enabled.status !== "enabled") {
			throw new Error("Bot clocking PostgreSQL is disabled");
		}
	});

	beforeEach(async () => {
		harness.telegram.length = 0;
		harness.discord.length = 0;
		harness.discordFailures = 0;
		await seed();
	});

	afterAll(async () => {
		await cleanup();
		await admin.end();
		const { pool } = (await import("@/db")) as unknown as { pool: Pool };
		await pool.end();
	});

	it.each(platforms)(
		"%s closes adopted work through the completed-work operation",
		async (platform) => {
			await expect(send(platform, "clockin", clockInAt)).resolves.toContain("Clocked in at 08:00.");
			const period = await activePeriod();

			const reply = await send(platform, "clockout", clockInAt.add({ minutes: 60, seconds: 40 }));

			expect(reply).toContain("Clocked out at 09:00. Duration: 1h 1m.");
			const graph = await closedGraph(period.id);
			expect(graph).toEqual({
				is_active: false,
				end_time: new Date("2026-07-22T09:00:40Z"),
				// 60m40s rounds half up to 61 in both representations.
				duration_minutes: 61,
				clock_out_id: expect.any(String),
				approval_status: "approved",
				graph_revision: 1,
				record_duration: 61,
				record_state: "approved",
				record_origin: "clock",
				record_created_by: ids.user,
				record_start: new Date("2026-07-22T08:00:00Z"),
				record_end: new Date("2026-07-22T09:00:40Z"),
				work_location_type: "office",
				device_info: `${platform}-bot`,
				ip_address: "bot",
				entry_created_by: ids.user,
				// The append collaborator linked the exact admitted predecessor.
				previous_entry_id: period.clock_in_id,
				timezone_source: "user_setting",
			});
			const { rows: positions } = await admin.query(
				`select tip_entry_id, version, last_operation from time_entry_append_position
				 where employee_id = $1`,
				[ids.requester],
			);
			expect(only(positions)).toEqual({
				tip_entry_id: graph.clock_out_id,
				version: 2,
				last_operation: "live_clock_out",
			});
			const { rows: balances } = await admin.query(
				"select is_dirty, dirty_from_date::text from employee_work_balance where employee_id = $1",
				[ids.requester],
			);
			expect(only(balances)).toEqual({ is_dirty: true, dirty_from_date: "2026-07-22" });
			expect(await receipts()).toEqual([
				{
					id: graph.clock_out_id,
					writer: "bot_clock_out",
					writer_version: 1,
					append_admission: "append",
					actor_kind: "human",
					actor_user_id: ids.user,
					work_period_id: period.id,
					command: {
						version: 1,
						operationId: graph.clock_out_id,
						project: { kind: "preserve" },
						workCategory: { kind: "preserve" },
						// The server sampled the instant; bots supply no client instant or zone.
						requestedInstant: null,
						browserTimezone: null,
						deviceInfo: `${platform}-bot`,
					},
					segment: {
						startAt: "2026-07-22T08:00:00Z",
						endAt: "2026-07-22T09:00:40Z",
						durationMinutes: 61,
						startUtcOffsetMinutes: 0,
						endUtcOffsetMinutes: 0,
						endTimezone: "UTC",
						endTimezoneSource: "user_setting",
					},
				},
			]);
		},
	);

	it.each(platforms)(
		"%s keeps the complete work invariant before the organization adopts",
		async (platform) => {
			await setAdmission("inactive");
			await send(platform, "clockin", clockInAt);
			const period = await activePeriod();

			const reply = await send(platform, "clockout", clockInAt.add({ minutes: 60, seconds: 40 }));

			expect(reply).toContain("Clocked out at 09:00. Duration: 1h 1m.");
			// The coordinated legacy closure writes the canonical record with the
			// period's one derived duration; no receipt or revision before adoption.
			expect(await closedGraph(period.id)).toMatchObject({
				duration_minutes: 61,
				record_duration: 61,
				record_state: "approved",
				record_created_by: ids.user,
				record_end: new Date("2026-07-22T09:00:40Z"),
				graph_revision: 0,
				device_info: `${platform}-bot`,
				previous_entry_id: null,
			});
			expect(await receipts()).toEqual([]);
		},
	);

	/** Moves the platform's user mapping into the other organization. */
	async function mapOutsideOrganization(platform: Platform) {
		await admin.query(
			`update ${platform}_user_mapping set organization_id = $1 where user_id = $2`,
			[ids.otherOrganization, ids.user],
		);
	}

	async function withFailingWrite<T>(table: string, event: string, run: () => Promise<T>) {
		await admin.query(
			`create function t277_fail() returns trigger language plpgsql as $$
			 begin raise exception 't277 injected failure'; end $$`,
		);
		await admin.query(
			`create trigger t277_fail before ${event} on ${table} for each row execute function t277_fail()`,
		);
		try {
			return await run();
		} finally {
			await admin.query("drop function t277_fail() cascade");
		}
	}

	// Slack and Teams resolve the mapping's employee but run in the bot's
	// organization, so the command refuses the foreign employee. Telegram and
	// Discord look the mapping up in the bot's organization and find none.
	const outsideReply: Record<Platform, string> = {
		slack: "Employee profile not found.",
		teams: "Employee profile not found.",
		telegram: "not linked",
		discord: "not linked",
	};

	describe.each(modes)("%s organization", (_label, mode) => {
		beforeEach(async () => {
			await setAdmission(mode);
		});

		it.each(platforms)(
			"%s refuses a clock-out resolved outside the bot's organization",
			async (platform) => {
				await send(platform, "clockin", clockInAt);
				await mapOutsideOrganization(platform);
				const before = await snapshot();

				const reply = await send(platform, "clockout", clockInAt.add({ minutes: 30 }));

				expect(reply).toContain(outsideReply[platform]);
				expect(reply).not.toContain("Clocked out");
				expect(await snapshot()).toEqual(before);
			},
		);

		it.each(platforms)(
			"%s refuses a clock-in resolved outside the bot's organization",
			async (platform) => {
				await mapOutsideOrganization(platform);
				const before = await snapshot();

				const reply = await send(platform, "clockin", clockInAt);

				expect(reply).toContain(outsideReply[platform]);
				expect(reply).not.toContain("Clocked in");
				expect(await snapshot()).toEqual(before);
			},
		);

		it.each(platforms)(
			"%s stores positive partial-minute work with the shared rounding",
			async (platform) => {
				await send(platform, "clockin", clockInAt);
				const first = await activePeriod();
				await expect(send(platform, "clockout", clockInAt.add({ seconds: 29 }))).resolves.toContain(
					"Duration: 0h 0m.",
				);
				await send(platform, "clockin", clockInAt.add({ hours: 1 }));
				const second = await activePeriod();
				await expect(
					send(platform, "clockout", clockInAt.add({ hours: 1, seconds: 30 })),
				).resolves.toContain("Duration: 0h 1m.");

				expect(await closedGraph(first.id)).toMatchObject({
					duration_minutes: 0,
					record_duration: 0,
				});
				expect(await closedGraph(second.id)).toMatchObject({
					duration_minutes: 1,
					record_duration: 1,
				});
			},
		);

		it.each(platforms)(
			"%s treats a repeated unkeyed clock-out as a fresh command",
			async (platform) => {
				await send(platform, "clockin", clockInAt);
				await send(platform, "clockout", clockInAt.add({ hours: 1 }));
				const before = await snapshot();

				await expect(
					send(platform, "clockout", clockInAt.add({ hours: 1, seconds: 5 })),
				).resolves.toContain("You are not currently clocked in.");

				expect(await snapshot()).toEqual(before);
			},
		);

		it.each(
			platforms.flatMap((platform) =>
				closureWrites[mode].map(([table, event]) => [platform, table, event] as const),
			),
		)("%s rolls back the whole closure when the %s %s fails", async (platform, table, event) => {
			await send(platform, "clockin", clockInAt);
			// An attributed period, so the adopted closure also writes its allocation.
			await admin.query("update work_period set project_id = $1 where employee_id = $2", [
				ids.project,
				ids.requester,
			]);
			const before = await snapshot();

			const reply = await withFailingWrite(table, event, () =>
				send(platform, "clockout", clockInAt.add({ hours: 1 })),
			);

			expect(reply).toContain(unconfirmedClockOut);
			expect(await snapshot()).toEqual(before);
		});

		it.each(
			platforms.flatMap((platform) =>
				startWrites[mode].map(([table, event]) => [platform, table, event] as const),
			),
		)("%s rolls back the whole start when the %s %s fails", async (platform, table, event) => {
			const before = await snapshot();

			const reply = await withFailingWrite(table, event, () =>
				send(platform, "clockin", clockInAt),
			);

			expect(reply).toContain(unconfirmedClockIn);
			expect(await snapshot()).toEqual(before);
		});
	});

	it.each(platforms)("%s rejects equal endpoints without writing anything", async (platform) => {
		await send(platform, "clockin", clockInAt);
		const before = await snapshot();

		await expect(send(platform, "clockout", clockInAt)).resolves.toContain(
			"Clock-out must be after clock-in",
		);

		expect(await snapshot()).toEqual(before);
	});

	it("keeps exactly one receipt when an unkeyed clock-out is repeated", async () => {
		await send("slack", "clockin", clockInAt);
		await send("slack", "clockout", clockInAt.add({ hours: 1 }));
		await send("slack", "clockout", clockInAt.add({ hours: 1, seconds: 5 }));

		expect(await receipts()).toHaveLength(1);
	});

	it("never routes a bot clock-out to approval, even under a same-day-only change policy", async () => {
		await admin.query(
			`insert into change_policy
			 (id, organization_id, name, self_service_days, approval_days, no_approval_required,
			  created_by, updated_at)
			 values ($1, $2, 'Same day only', 0, 0, false, $3, now())`,
			[ids.changePolicy, ids.organization, ids.user],
		);
		await admin.query(
			`insert into change_policy_assignment
			 (id, policy_id, organization_id, assignment_type, priority, created_by, updated_at)
			 values ($1, $2, $3, 'organization', 0, $4, now())`,
			[ids.changePolicyAssignment, ids.changePolicy, ids.organization, ids.user],
		);
		await send("slack", "clockin", clockInAt);
		const period = await activePeriod();

		await expect(send("slack", "clockout", clockInAt.add({ hours: 1 }))).resolves.toContain(
			"Clocked out at",
		);

		expect(await closedGraph(period.id)).toMatchObject({
			is_active: false,
			approval_status: "approved",
			record_state: "approved",
		});
		expect((await snapshot()).approval_requests).toBe(0);
	});

	it.each(platforms)(
		"%s holds a clock-out for review when adopted history changed",
		async (platform) => {
			await send(platform, "clockin", clockInAt);
			const period = await activePeriod();
			await admin.query("update time_entry set hash = 'tampered' where id = $1", [
				period.clock_in_id,
			]);
			const before = await snapshot();

			await expect(send(platform, "clockout", clockInAt.add({ hours: 1 }))).resolves.toContain(
				"Your time history needs review before you can clock out.",
			);

			expect(await snapshot()).toEqual(before);
		},
	);

	it.each(platforms)(
		"%s holds a clock-in for review when adopted history changed",
		async (platform) => {
			await send(platform, "clockin", clockInAt);
			await send(platform, "clockout", clockInAt.add({ hours: 1 }));
			await admin.query(
				"update time_entry set hash = 'tampered' where employee_id = $1 and type = 'clock_out'",
				[ids.requester],
			);
			const before = await snapshot();

			await expect(send(platform, "clockin", clockInAt.add({ hours: 2 }))).resolves.toContain(
				"Your time history needs review before you can clock in.",
			);

			expect(await snapshot()).toEqual(before);
		},
	);

	it("keeps a committed clock-out when its Discord reply cannot be delivered", async () => {
		await send("discord", "clockin", clockInAt);
		const period = await activePeriod();
		harness.discordFailures = 1;

		const reply = await send("discord", "clockout", clockInAt.add({ hours: 1 }));

		expect(reply).toContain("Your command was processed, but its reply could not be shown.");
		expect(reply).not.toContain("Please try again");
		expect(await closedGraph(period.id)).toMatchObject({ is_active: false, duration_minutes: 60 });
		expect(await receipts()).toHaveLength(1);
	});
});
