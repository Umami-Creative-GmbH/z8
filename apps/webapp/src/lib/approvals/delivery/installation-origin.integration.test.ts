/**
 * #2043 runtime evidence: Approval card origin preservation, retiring-installation
 * servicing & refresh, current decision authority under races, cross-switch
 * worker-crash quarantine, confirmed-unsent reroute, 7-day unknown closure, and
 * origin-scoped card/work counting on PostgreSQL 16.
 *
 * Local contract: pnpm --filter webapp test:integration -- src/lib/approvals/delivery/installation-origin.integration.test.ts
 */

import { Temporal } from "temporal-polyfill";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { integrationAdminPool } from "@/test/integration-database";

const TOKEN_A = "204301:AAT2043-legacy_bot_a_secret";
const TOKEN_B = "204302:AAT2043-org_owned_bot_b_secret";

const harness = vi.hoisted(() => ({
	userId: null as string | null,
	organizationId: null as string | null,
	kicks: [] as Array<{ organizationId: string; workflowId?: string | null }>,
	secrets: new Map<string, string>(),
}));

vi.mock("next/server", async (importOriginal) =>
	(await import("@/test/integration-harness")).nextServer(importOriginal),
);

vi.mock("next/headers", async () => (await import("@/test/integration-harness")).nextHeaders());

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
								id: `session-${harness.userId}`,
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

vi.mock("@/lib/app-url", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/app-url")>()),
	getOrganizationBaseUrl: async () => "https://t2043.example.test",
}));

vi.mock("@/lib/email/email-service", async () =>
	(await import("@/test/integration-harness")).emailService(),
);

vi.mock("@/lib/email/render", async (importOriginal) =>
	(await import("@/test/integration-harness")).absenceEmailRender(importOriginal),
);

vi.mock("@/lib/notifications/triggers", async (importOriginal) =>
	(await import("@/test/integration-harness")).notificationTriggers(importOriginal, [
		"onAbsenceRequestSubmitted",
		"onAbsenceRequestPendingApproval",
		"onAbsenceRequestApproved",
		"onAbsenceRequestRejected",
		"onApprovedAbsenceCancelledByEmployee",
	]),
);

vi.mock("@/lib/queue", async (importOriginal) =>
	(await import("@/test/integration-harness")).calendarSyncQueue(importOriginal),
);

vi.mock("@/lib/work-balance/service", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/work-balance/service")>()),
	markEmployeeWorkBalanceDirty: async () => undefined,
}));

vi.mock("@/lib/vault", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/vault")>()),
	getOrgSecret: async (organizationId: string, key: string) =>
		harness.secrets.get(`${organizationId}:${key}`) ?? null,
}));

vi.mock("@/lib/approvals/delivery/kick", async () =>
	(await import("@/test/integration-harness")).deliveryKick(harness.kicks),
);

const { requestAbsenceEffect } =
	await import("@/app/[locale]/(app)/absences/request-absence-effect");
const { approveAbsenceEffect } = await import("@/lib/approvals/server/absence-approvals");
const { processApprovalDeliveries } = await import("./owner");
const {
	claimApprovalDeliveryWork,
	expandApprovalDeliveryIntents,
	recordApprovalDeliveryDispatchIntent,
} = await import("./store");
const {
	closeExpiredUncertainApprovalDeliveries,
	countOutstandingApprovalWorkByInstallation,
	listUncertainApprovalDeliveriesForOperations,
	resolveCardOriginInstallation,
} = await import("./installation-origin");
const { rearmApprovalDeliveryForRepairedDestination } = await import("./recovery");
const { handleTelegramUpdate } = await import("@/lib/telegram/bot-handler");
const { encodeBoundApprovalCallback } = await import("@/lib/telegram/bound-approval");

const T0 = Temporal.Instant.from("2030-06-10T10:00:00Z");

const ids = {
	organization: "t2043-origin-org",
	otherOrganization: "t2043-other-org",
	requesterUser: "t2043-requester-user",
	managerUser: "t2043-manager-user",
	deputyUser: "t2043-deputy-user",
	requester: "e2043000-0000-4000-8000-000000000001",
	manager: "e2043000-0000-4000-8000-000000000002",
	deputy: "e2043000-0000-4000-8000-000000000003",
	category: "e2043100-0000-4000-8000-000000000001",
	legacyBotConfig: "e2043200-0000-4000-8000-000000000001",
	instA: "e2043300-0000-4000-8000-000000000001",
	instB: "e2043300-0000-4000-8000-000000000002",
	revB: "e2043400-0000-4000-8000-000000000002",
	slackInst1: "e2043300-0000-4000-8000-000000000011",
	slackInst2: "e2043300-0000-4000-8000-000000000012",
} as const;

const MANAGER_TELEGRAM_ID = 204_301;
const MANAGER_CHAT_A = 204_351;
const MANAGER_CHAT_B = 204_352;
const DEPUTY_TELEGRAM_ID = 204_302;
const DEPUTY_CHAT_A = 204_361;

interface TelegramTransportCall {
	token: string;
	method: string;
	body: Record<string, unknown>;
}

describe("Approval delivery installation origin preservation (PostgreSQL)", () => {
	const admin = integrationAdminPool();
	const calls: TelegramTransportCall[] = [];
	const originalFetch = globalThis.fetch;
	let nextMessageId = 43_000;
	let nextAbsenceDay = 1;

	function actAs(userId: string) {
		harness.userId = userId;
		harness.organizationId = ids.organization;
	}

	function installTelegramTransport() {
		globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
			const url = String(input);
			const match = /^https:\/\/api\.telegram\.org\/bot([^/]+)\/(\w+)$/.exec(url);
			if (!match) throw new Error(`Unexpected fetch in test: ${url}`);
			const token = match[1] ?? "";
			const method = match[2] ?? "";
			const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
			calls.push({ token, method, body });
			const result =
				method === "sendMessage"
					? {
							message_id: nextMessageId++,
							date: 1_900_000_000,
							chat: { id: Number(body.chat_id), type: "private" },
							text: body.text,
						}
					: true;
			return new Response(JSON.stringify({ ok: true, result }), {
				status: 200,
				headers: { "content-type": "application/json" },
			});
		}) as typeof fetch;
	}

	async function cleanup() {
		await admin.query("delete from organization where id = any($1::text[])", [
			[ids.organization, ids.otherOrganization],
		]);
		await admin.query('delete from "user" where id = any($1::text[])', [
			[ids.requesterUser, ids.managerUser, ids.deputyUser],
		]);
	}

	async function seed(options: { includeManagerChatA?: boolean } = {}) {
		await cleanup();
		harness.secrets.clear();
		harness.secrets.set(`${ids.organization}:telegram/bot_token`, TOKEN_A);
		harness.secrets.set(`${ids.organization}:chat/telegram/${ids.instB}/rev-1/bot_token`, TOKEN_B);

		const ts = new Date("2026-07-01T00:00:00Z");
		await admin.query(
			`insert into organization (id, name, slug, created_at) values ($1, 'T2043 Org', $1, $2)`,
			[ids.organization, ts],
		);
		await admin.query(
			`insert into approval_workflow_rollout
			 (organization_id, workflow_type, lifecycle_mode, side_effect_mode, created_at, updated_at)
			 values ($1, 'absence', 'canonical', 'canonical', $2, $2)`,
			[ids.organization, ts],
		);
		await admin.query(
			`insert into approval_evidence_control (organization_id, workflow_type, mode)
			 values ($1, 'absence', 'capture')`,
			[ids.organization],
		);
		await admin.query(
			`insert into approval_presentation_control
			 (organization_id, workflow_type, provider, mode) values ($1, 'absence', 'telegram', 'actionable')`,
			[ids.organization],
		);
		await admin.query(
			`insert into approval_delivery_control (organization_id, workflow_type, provider, activated_at)
			 values ($1, 'absence', 'telegram', $2)`,
			[ids.organization, ts],
		);

		for (const [id, email, name] of [
			[ids.requesterUser, "req-2043@example.test", "Req User"],
			[ids.managerUser, "mgr-2043@example.test", "Mgr User"],
			[ids.deputyUser, "dep-2043@example.test", "Dep User"],
		] as const) {
			await admin.query(
				`insert into "user" (id, name, email, email_verified, created_at, updated_at)
				 values ($1, $2, $3, true, $4, $4)`,
				[id, name, email, ts],
			);
			await admin.query(
				`insert into member (id, organization_id, user_id, role, status, created_at)
				 values ($1, $2, $3, 'member', 'approved', $4)`,
				[`member-${id}`, ids.organization, id, ts],
			);
		}

		await admin.query(
			`insert into employee (id, user_id, organization_id, first_name, last_name, role, is_active, created_at, updated_at)
			 values
			 ($1, $2, $3, 'Req', 'Employee', 'employee', true, $4, $4),
			 ($5, $6, $3, 'Mgr', 'Approver', 'manager', true, $4, $4),
			 ($7, $8, $3, 'Dep', 'Cover', 'manager', true, $4, $4)`,
			[
				ids.requester,
				ids.requesterUser,
				ids.organization,
				ts,
				ids.manager,
				ids.managerUser,
				ids.deputy,
				ids.deputyUser,
			],
		);

		await admin.query(
			`insert into employee_managers (id, employee_id, manager_id, is_primary, assigned_by, assigned_at, created_at)
			 values (gen_random_uuid(), $1, $2, true, $3, $4, $4)`,
			[ids.requester, ids.manager, ids.managerUser, ts],
		);

		await admin.query(
			`insert into user_settings (user_id, locale, timezone, time_format, updated_at)
			 select user_id, 'en', 'Europe/Berlin', '24h', $2 from unnest($1::text[]) as user_id`,
			[[ids.managerUser, ids.deputyUser], ts],
		);

		await admin.query(
			`insert into absence_category (id, organization_id, name, type, counts_against_vacation, requires_approval, requires_work_time, is_active, created_at, updated_at)
			 values ($1, $2, 'Vacation', 'vacation', false, true, false, true, $3, $3)`,
			[ids.category, ids.organization, ts],
		);

		await admin.query(
			`insert into telegram_bot_config
			 (id, organization_id, bot_token, bot_username, webhook_secret, webhook_registered, setup_status,
			  enable_approvals, enable_commands, enable_daily_digest, enable_escalations, created_at, updated_at)
			 values ($1, $2, 'vault:managed', 'z8_old_bot', 't2043-webhook-a', true, 'active', true, true, true, true, $3, $3)`,
			[ids.legacyBotConfig, ids.organization, ts],
		);

		await admin.query(
			`insert into telegram_user_mapping
			 (id, user_id, organization_id, telegram_user_id, telegram_username, is_active, created_at, updated_at)
			 values
			 (gen_random_uuid(), $1, $2, $3, 'mgr_tg', true, $4, $4),
			 (gen_random_uuid(), $5, $2, $6, 'dep_tg', true, $4, $4)`,
			[
				ids.managerUser,
				ids.organization,
				String(MANAGER_TELEGRAM_ID),
				ts,
				ids.deputyUser,
				String(DEPUTY_TELEGRAM_ID),
			],
		);

		if (options.includeManagerChatA ?? true) {
			await admin.query(
				`insert into telegram_conversation
				 (id, organization_id, user_id, chat_id, chat_type, is_active, created_at, updated_at)
				 values ($1, $2, $3, $4, 'private', true, $5, $5)`,
				[
					"e2043500-0000-4000-8000-000000000001",
					ids.organization,
					ids.managerUser,
					String(MANAGER_CHAT_A),
					ts,
				],
			);
		}

		// Seed Installation A (backfilled legacy_active Telegram bot)
		await admin.query(
			`insert into chat_installation
			 (id, organization_id, provider, credential_source, status, route_id, external_bot_id,
			  receiver_scope, legacy_table, legacy_record_id, legacy_status, verification_state, created_at, updated_at)
			 values ($1, $2, 'telegram', 'deployment_managed', 'legacy_active', 'route-tg-a', '204301',
			  'telegram-bot:204301', 'telegram_bot_config', $3, 'active', 'verified', $4, $4)`,
			[ids.instA, ids.organization, ids.legacyBotConfig, ts],
		);
	}

	async function switchTelegramToInstallationB(
		options: {
			retirementDeadlineAt?: Date;
			includeManagerConversationB?: boolean;
		} = {},
	) {
		const deadline = options.retirementDeadlineAt ?? new Date("2030-07-10T10:00:00Z");
		const ts = new Date("2030-06-10T10:01:00Z");

		// Retire Installation A
		await admin.query(
			`update chat_installation
			 set status = 'retiring', retirement_deadline_at = $2, updated_at = $3
			 where id = $1`,
			[ids.instA, deadline, ts],
		);

		// Create & activate org-owned Installation B with immutable credential revision
		await admin.query(
			`insert into chat_installation
			 (id, organization_id, provider, credential_source, status, route_id, external_bot_id,
			  receiver_scope, verification_state, created_at, updated_at)
			 values ($1, $2, 'telegram', 'organization_owned', 'active', 'route-tg-b', '204302',
			  'telegram-bot:204302', 'verified', $3, $3)`,
			[ids.instB, ids.organization, ts],
		);
		await admin.query(
			`insert into chat_installation_credential_revision
			 (id, installation_id, organization_id, revision_number, secret_store_provider,
			  secret_key_prefix, secret_keys, status, verified_at, created_at)
			 values ($1, $2, $3, 1, 'vault', $4, '["bot_token"]'::jsonb, 'active', $5, $5)`,
			[ids.revB, ids.instB, ids.organization, `chat/telegram/${ids.instB}/rev-1`, ts],
		);
		await admin.query(
			`update chat_installation set active_credential_revision_id = $2 where id = $1`,
			[ids.instB, ids.revB],
		);
		await admin.query(
			`insert into chat_provider_settings
			 (organization_id, provider, is_authoritative, active_installation_id,
			  enable_approvals, enable_commands, enable_daily_digest, enable_escalations, created_at, updated_at)
			 values ($1, 'telegram', true, $2, true, true, true, true, $3, $3)
			 on conflict (organization_id, provider) do update
			 set is_authoritative = true, active_installation_id = excluded.active_installation_id, updated_at = excluded.updated_at`,
			[ids.organization, ids.instB, ts],
		);

		if (options.includeManagerConversationB ?? true) {
			await admin.query(
				`insert into chat_installation_conversation
				 (organization_id, installation_id, user_id, employee_id, external_user_id,
				  external_conversation_id, conversation_type, reachability_status, is_active, created_at, updated_at)
				 values ($1, $2, $3, $4, $5, $6, 'private', 'reachable', true, $7, $7)`,
				[
					ids.organization,
					ids.instB,
					ids.managerUser,
					ids.manager,
					String(MANAGER_TELEGRAM_ID),
					String(MANAGER_CHAT_B),
					ts,
				],
			);
		}
	}

	async function submitAbsence() {
		actAs(ids.requesterUser);
		const day = String(nextAbsenceDay++).padStart(2, "0");
		const result = await requestAbsenceEffect({
			categoryId: ids.category,
			startDate: `2030-08-${day}`,
			startPeriod: "full_day",
			endDate: `2030-08-${day}`,
			endPeriod: "full_day",
			notes: `Origin test absence ${day}`,
		});
		if (!result.success) {
			throw new Error(`requestAbsenceEffect failed: ${result.error}`);
		}
		const { rows } = await admin.query<{
			absence_id: string;
			workflow_id: string;
			approval_request_id: string;
		}>(
			`select a.id as absence_id, a.approval_workflow_id as workflow_id, r.id as approval_request_id
			 from absence_entry a
			 join approval_request r on r.entity_id = a.id and r.organization_id = a.organization_id
			 where a.id = $1`,
			[result.data.absenceId],
		);
		harness.userId = null;
		return rows[0]!;
	}

	async function approveOnWeb(submitted: { absence_id: string; approval_request_id: string }) {
		actAs(ids.managerUser);
		const res = await approveAbsenceEffect(submitted.absence_id, {
			approvalRequestId: submitted.approval_request_id,
		});
		harness.userId = null;
		return res;
	}

	function makeBotA() {
		return {
			organizationId: ids.organization,
			installationId: ids.instA,
			botToken: TOKEN_A,
			botUsername: "z8_old_bot",
			webhookSecret: "t2043-webhook-a",
			setupStatus: "active",
			enableApprovals: true,
			enableCommands: true,
			enableDailyDigest: true,
			enableEscalations: true,
			digestTime: "08:00",
			digestTimezone: "UTC",
			escalationTimeoutHours: 24,
		};
	}

	beforeEach(async () => {
		calls.length = 0;
		harness.kicks.length = 0;
		nextMessageId = 43_000;
		nextAbsenceDay = 1;
		installTelegramTransport();
		await seed();
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	afterAll(async () => {
		globalThis.fetch = originalFetch;
		await cleanup();
	});

	it("preserves prior card origin across a switch while new sends select the active installation and retiring origin refreshes old cards", async () => {
		const first = await submitAbsence();
		const pass1 = await processApprovalDeliveries({ organizationId: ids.organization, now: T0 });
		expect(pass1.outcomes.delivered).toBe(1);
		expect(calls).toHaveLength(1);
		expect(calls[0]?.token).toBe(TOKEN_A);

		const msg1Rows = await admin.query<{
			id: string;
			installation_id: string | null;
			receiver_scope: string;
			destination_id: string;
			remote_message_id: string;
			binding_id: string;
			state: string;
		}>(
			`select id, installation_id, receiver_scope, destination_id, remote_message_id, binding_id, state
			 from approval_delivery_message where workflow_id = $1`,
			[first.workflow_id],
		);
		const msg1 = msg1Rows.rows[0]!;
		expect(msg1.installation_id).toBe(ids.instA);
		expect(msg1.receiver_scope).toBe("telegram-bot:204301");

		const work1Rows = await admin.query<{
			installation_id: string | null;
			dispatch_intent_at: Date | null;
			dispatch_attempt_state: string | null;
		}>(
			`select installation_id, dispatch_intent_at, dispatch_attempt_state
			 from approval_delivery_work where workflow_id = $1 and effect = 'initial'`,
			[first.workflow_id],
		);
		expect(work1Rows.rows[0]?.installation_id).toBe(ids.instA);
		expect(work1Rows.rows[0]?.dispatch_intent_at).not.toBeNull();
		expect(work1Rows.rows[0]?.dispatch_attempt_state).toBe("sent");

		// Switch organization to Installation B (Installation A becomes retiring)
		await switchTelegramToInstallationB();

		// New submission goes to active Installation B with credential revision B
		const second = await submitAbsence();
		const pass2 = await processApprovalDeliveries({
			organizationId: ids.organization,
			now: T0.add({ minutes: 2 }),
		});
		expect(pass2.outcomes.delivered).toBe(1);
		expect(calls).toHaveLength(2);
		expect(calls[1]?.token).toBe(TOKEN_B);
		expect(String(calls[1]?.body.chat_id)).toBe(String(MANAGER_CHAT_B));

		const msg2Rows = await admin.query<{
			installation_id: string | null;
			credential_revision_id: string | null;
			receiver_scope: string;
		}>(
			`select installation_id, credential_revision_id, receiver_scope
			 from approval_delivery_message where workflow_id = $1`,
			[second.workflow_id],
		);
		expect(msg2Rows.rows[0]).toEqual({
			installation_id: ids.instB,
			credential_revision_id: ids.revB,
			receiver_scope: "telegram-bot:204302",
		});

		// Late button press on OLD card M1 via retiring Installation A approves Absence 1
		await handleTelegramUpdate(
			{
				update_id: 90_001,
				callback_query: {
					id: "cbq-old-card-1",
					from: { id: MANAGER_TELEGRAM_ID, is_bot: false, first_name: "Mgr" },
					message: {
						message_id: Number(msg1.remote_message_id),
						chat: { id: MANAGER_CHAT_A, type: "private" },
						date: 1_900_000_000,
					},
					data: encodeBoundApprovalCallback("approve", msg1.binding_id),
				},
			},
			makeBotA(),
		);

		const absence1After = await admin.query<{ status: string }>(
			`select status from absence_entry where id = $1`,
			[first.absence_id],
		);
		expect(absence1After.rows[0]?.status).toBe("approved");

		// Refresh of OLD card M1 routes to retiring Installation A (TOKEN_A), NOT Installation B!
		const callsBeforeRefresh = calls.length;
		const pass3 = await processApprovalDeliveries({
			organizationId: ids.organization,
			now: T0.add({ minutes: 3 }),
		});
		expect(pass3.outcomes.delivered).toBe(1);
		const editCalls = calls.slice(callsBeforeRefresh).filter((c) => c.method === "editMessageText");
		expect(editCalls).toHaveLength(1);
		expect(editCalls[0]?.token).toBe(TOKEN_A);

		const msg1After = await admin.query<{ state: string; controls: string }>(
			`select state, controls from approval_delivery_message where id = $1`,
			[msg1.id],
		);
		expect(msg1After.rows[0]).toEqual({ state: "retired", controls: "none" });
	});

	it("enforces current membership authorization on old-card presses after switch and keeps pending work in Z8", async () => {
		const submitted = await submitAbsence();
		await processApprovalDeliveries({ organizationId: ids.organization, now: T0 });
		const msg1 = (
			await admin.query<{ remote_message_id: string; binding_id: string }>(
				`select remote_message_id, binding_id from approval_delivery_message where workflow_id = $1`,
				[submitted.workflow_id],
			)
		).rows[0]!;

		await switchTelegramToInstallationB();

		// Deactivate manager after card was issued
		await admin.query(`update employee set is_active = false where id = $1`, [ids.manager]);

		await handleTelegramUpdate(
			{
				update_id: 90_010,
				callback_query: {
					id: "cbq-deactivated-mgr",
					from: { id: MANAGER_TELEGRAM_ID, is_bot: false, first_name: "Mgr" },
					message: {
						message_id: Number(msg1.remote_message_id),
						chat: { id: MANAGER_CHAT_A, type: "private" },
						date: 1_900_000_000,
					},
					data: encodeBoundApprovalCallback("approve", msg1.binding_id),
				},
			},
			makeBotA(),
		);

		const absenceStatus = (
			await admin.query<{ status: string }>(`select status from absence_entry where id = $1`, [
				submitted.absence_id,
			])
		).rows[0]?.status;
		expect(absenceStatus).toBe("pending");
	});

	it("enforces current delegation authority on old deputy cards after switch", async () => {
		const ts = new Date("2026-07-01T00:00:00Z");
		const coverAbsenceId = "e2043800-0000-4000-8000-000000000001";
		const today = Temporal.Now.instant().toZonedDateTimeISO("UTC").toPlainDate();
		await admin.query(
			`insert into telegram_conversation
			 (id, organization_id, user_id, chat_id, chat_type, is_active, created_at, updated_at)
			 values ($1, $2, $3, $4, 'private', true, $5, $5)`,
			[
				"e2043500-0000-4000-8000-000000000002",
				ids.organization,
				ids.deputyUser,
				String(DEPUTY_CHAT_A),
				ts,
			],
		);
		await admin.query(
			`insert into absence_entry
			 (id, employee_id, category_id, start_date, end_date, status, organization_id, deputy_employee_id, updated_at)
			 values ($1, $2, $3, $4, '2030-12-31', 'approved', $5, $6, $7)`,
			[
				coverAbsenceId,
				ids.manager,
				ids.category,
				today.subtract({ days: 2 }).toString(),
				ids.organization,
				ids.deputy,
				ts,
			],
		);

		const submitted = await submitAbsence();
		await processApprovalDeliveries({ organizationId: ids.organization, now: T0 });

		const deputyMsg = (
			await admin.query<{ remote_message_id: string; binding_id: string }>(
				`select remote_message_id, binding_id
				 from approval_delivery_message
				 where workflow_id = $1 and recipient_employee_id = $2 and acting_for_employee_id = $3`,
				[submitted.workflow_id, ids.deputy, ids.manager],
			)
		).rows[0]!;
		expect(deputyMsg).toBeDefined();

		await switchTelegramToInstallationB();

		// End delegation (clear deputy on covering absence) after card was issued
		await admin.query(`update absence_entry set deputy_employee_id = null where id = $1`, [
			coverAbsenceId,
		]);

		await handleTelegramUpdate(
			{
				update_id: 90_015,
				callback_query: {
					id: "cbq-ended-delegation",
					from: { id: DEPUTY_TELEGRAM_ID, is_bot: false, first_name: "Dep" },
					message: {
						message_id: Number(deputyMsg.remote_message_id),
						chat: { id: DEPUTY_CHAT_A, type: "private" },
						date: 1_900_000_000,
					},
					data: encodeBoundApprovalCallback("approve", deputyMsg.binding_id),
				},
			},
			makeBotA(),
		);

		const absenceStatus = (
			await admin.query<{ status: string }>(`select status from absence_entry where id = $1`, [
				submitted.absence_id,
			])
		).rows[0]?.status;
		expect(absenceStatus).toBe("pending");
	});

	it("refuses old-card action and refresh once retirement deadline expires while pending work stays decidable in Z8 inbox", async () => {
		const submitted = await submitAbsence();
		await processApprovalDeliveries({ organizationId: ids.organization, now: T0 });
		const msg1 = (
			await admin.query<{ id: string; remote_message_id: string; binding_id: string }>(
				`select id, remote_message_id, binding_id from approval_delivery_message where workflow_id = $1`,
				[submitted.workflow_id],
			)
		).rows[0]!;

		// Set retirement deadline already in the past relative to systemClock.nowInstant()
		await switchTelegramToInstallationB({
			retirementDeadlineAt: new Date("2020-01-01T00:00:00Z"),
		});

		const callsBeforePress = calls.length;
		await handleTelegramUpdate(
			{
				update_id: 90_035,
				callback_query: {
					id: "cbq-expired-retirement",
					from: { id: MANAGER_TELEGRAM_ID, is_bot: false, first_name: "Mgr" },
					message: {
						message_id: Number(msg1.remote_message_id),
						chat: { id: MANAGER_CHAT_A, type: "private" },
						date: 1_900_000_000,
					},
					data: encodeBoundApprovalCallback("approve", msg1.binding_id),
				},
			},
			makeBotA(),
		);

		expect(
			calls.slice(callsBeforePress).filter((c) => c.method === "editMessageText"),
		).toHaveLength(0);
		expect(
			(
				await admin.query<{ status: string }>(`select status from absence_entry where id = $1`, [
					submitted.absence_id,
				])
			).rows[0]?.status,
		).toBe("pending");

		// Still decidable in Z8 inbox
		const webDecision = await approveOnWeb(submitted);
		expect(webDecision.success).toBe(true);

		// Refresh marks the expired-retirement card `gone` without calling either bot
		const callsBeforeRefresh = calls.length;
		await processApprovalDeliveries({
			organizationId: ids.organization,
			now: T0.add({ minutes: 10 }),
		});
		expect(calls.slice(callsBeforeRefresh)).toHaveLength(0);
		expect(
			(
				await admin.query<{ state: string }>(
					`select state from approval_delivery_message where id = $1`,
					[msg1.id],
				)
			).rows[0]?.state,
		).toBe("gone");
	});

	it("commits only one authorized decision under concurrent old-card press and web approval races", async () => {
		const submitted = await submitAbsence();
		await processApprovalDeliveries({ organizationId: ids.organization, now: T0 });
		const msg1 = (
			await admin.query<{ remote_message_id: string; binding_id: string }>(
				`select remote_message_id, binding_id from approval_delivery_message where workflow_id = $1`,
				[submitted.workflow_id],
			)
		).rows[0]!;

		await switchTelegramToInstallationB();

		actAs(ids.managerUser);
		await Promise.all([
			handleTelegramUpdate(
				{
					update_id: 90_020,
					callback_query: {
						id: "cbq-race-1",
						from: { id: MANAGER_TELEGRAM_ID, is_bot: false, first_name: "Mgr" },
						message: {
							message_id: Number(msg1.remote_message_id),
							chat: { id: MANAGER_CHAT_A, type: "private" },
							date: 1_900_000_000,
						},
						data: encodeBoundApprovalCallback("approve", msg1.binding_id),
					},
				},
				makeBotA(),
			),
			handleTelegramUpdate(
				{
					update_id: 90_021,
					callback_query: {
						id: "cbq-race-2",
						from: { id: MANAGER_TELEGRAM_ID, is_bot: false, first_name: "Mgr" },
						message: {
							message_id: Number(msg1.remote_message_id),
							chat: { id: MANAGER_CHAT_A, type: "private" },
							date: 1_900_000_000,
						},
						data: encodeBoundApprovalCallback("approve", msg1.binding_id),
					},
				},
				makeBotA(),
			),
			approveOnWeb(submitted).catch(() => null),
		]);

		const evidenceCount = (
			await admin.query<{ cnt: number }>(
				`select count(*)::int as cnt from approval_decision_evidence where workflow_id = $1`,
				[submitted.workflow_id],
			)
		).rows[0]?.cnt;
		expect(evidenceCount).toBe(1);

		const absenceStatus = (
			await admin.query<{ status: string }>(`select status from absence_entry where id = $1`, [
				submitted.absence_id,
			])
		).rows[0]?.status;
		expect(absenceStatus).toBe("approved");
	});

	it("refuses old-card action and refresh after origin revocation while pending approval remains decidable in Z8 inbox", async () => {
		const submitted = await submitAbsence();
		await processApprovalDeliveries({ organizationId: ids.organization, now: T0 });
		const msg1 = (
			await admin.query<{ id: string; remote_message_id: string; binding_id: string }>(
				`select id, remote_message_id, binding_id from approval_delivery_message where workflow_id = $1`,
				[submitted.workflow_id],
			)
		).rows[0]!;

		await switchTelegramToInstallationB();
		await admin.query(
			`update chat_installation set status = 'revoked', revoked_at = $2 where id = $1`,
			[ids.instA, new Date("2030-06-10T10:05:00Z")],
		);

		const callsBeforePress = calls.length;
		await handleTelegramUpdate(
			{
				update_id: 90_030,
				callback_query: {
					id: "cbq-revoked-origin",
					from: { id: MANAGER_TELEGRAM_ID, is_bot: false, first_name: "Mgr" },
					message: {
						message_id: Number(msg1.remote_message_id),
						chat: { id: MANAGER_CHAT_A, type: "private" },
						date: 1_900_000_000,
					},
					data: encodeBoundApprovalCallback("approve", msg1.binding_id),
				},
			},
			makeBotA(),
		);

		// Press did not decide and did not edit message via revoked bot
		const editCallsAfterRevokedPress = calls
			.slice(callsBeforePress)
			.filter((c) => c.method === "editMessageText");
		expect(editCallsAfterRevokedPress).toHaveLength(0);
		expect(
			(
				await admin.query<{ status: string }>(`select status from absence_entry where id = $1`, [
					submitted.absence_id,
				])
			).rows[0]?.status,
		).toBe("pending");

		// Pending approval stays reachable and decidable in Z8 web inbox!
		const webDecision = await approveOnWeb(submitted);
		expect(webDecision.success).toBe(true);

		// Refresh marks the revoked-origin card `gone` without calling either bot
		const callsBeforeRefresh = calls.length;
		await processApprovalDeliveries({
			organizationId: ids.organization,
			now: T0.add({ minutes: 10 }),
		});
		expect(calls.slice(callsBeforeRefresh)).toHaveLength(0);
		const msg1After = (
			await admin.query<{ state: string }>(
				`select state from approval_delivery_message where id = $1`,
				[msg1.id],
			)
		).rows[0];
		expect(msg1After?.state).toBe("gone");
	});

	it("quarantines a crashed worker across a switch out of retry and destination repair, exposes redacted operator context, and closes as unknown after 7 days", async () => {
		const submitted = await submitAbsence();
		await expandApprovalDeliveryIntents({
			organizationId: ids.organization,
			limit: 10,
			now: T0,
		});

		// Simulate Worker 1 claiming, recording dispatch intent on Installation A,
		// provider accepting the send, and Worker 1 crashing BEFORE recording locally.
		const claimed = await claimApprovalDeliveryWork({
			organizationId: ids.organization,
			owner: "delivery",
			limit: 10,
			now: T0,
		});
		expect(claimed).toHaveLength(1);
		const work = claimed[0]!;
		const intentRecorded = await recordApprovalDeliveryDispatchIntent({
			work,
			installationId: ids.instA,
			credentialRevisionId: null,
			now: T0,
		});
		expect(intentRecorded).toBe(true);

		// Org switches to Installation B while Worker 1 is dead (before lease expires)
		await switchTelegramToInstallationB();

		// Lease expires after 2 minutes; Worker 2 runs at T0 + 3m
		const passAfterCrash = await processApprovalDeliveries({
			organizationId: ids.organization,
			now: T0.add({ minutes: 3 }),
		});
		expect(passAfterCrash.outcomes.uncertain_across_switch).toBe(1);
		// Neither Installation A nor Installation B was dispatched!
		expect(calls).toHaveLength(0);

		const workAfterQuarantine = (
			await admin.query<{
				status: string;
				installation_id: string | null;
				dispatch_attempt_state: string | null;
				last_outcome: string | null;
				reconciliation_required_at: Date | null;
				reconciliation_context: Record<string, unknown> | null;
				unknown_closed_at: Date | null;
			}>(
				`select status, installation_id, dispatch_attempt_state, last_outcome,
				        reconciliation_required_at, reconciliation_context, unknown_closed_at
				 from approval_delivery_work where id = $1`,
				[work.id],
			)
		).rows[0]!;
		expect(workAfterQuarantine.status).toBe("failed");
		expect(workAfterQuarantine.installation_id).toBe(ids.instA);
		expect(workAfterQuarantine.dispatch_attempt_state).toBe("uncertain_across_switch");
		expect(workAfterQuarantine.last_outcome).toBe("uncertain_across_switch");
		expect(workAfterQuarantine.reconciliation_required_at).not.toBeNull();
		expect(workAfterQuarantine.unknown_closed_at).toBeNull();
		// Context is redacted (contains no bot tokens)
		const serializedCtx = JSON.stringify(workAfterQuarantine.reconciliation_context);
		expect(serializedCtx).not.toContain(TOKEN_A);
		expect(serializedCtx).not.toContain(TOKEN_B);
		expect(workAfterQuarantine.reconciliation_context?.attemptedInstallationId).toBe(ids.instA);
		expect(workAfterQuarantine.reconciliation_context?.activeInstallationId).toBe(ids.instB);
		expect(workAfterQuarantine.reconciliation_context?.fallback).toBe("z8_inbox");

		// Automatic retry pass does nothing
		const retryPass = await processApprovalDeliveries({
			organizationId: ids.organization,
			now: T0.add({ minutes: 10 }),
		});
		expect(retryPass.claimed).toBe(0);
		expect(calls).toHaveLength(0);

		// Destination repair does NOT re-arm quarantined work
		await rearmApprovalDeliveryForRepairedDestination({
			organizationId: ids.organization,
			userId: ids.managerUser,
			provider: "telegram",
			now: T0.add({ minutes: 11 }),
		});
		const afterRepairPass = await processApprovalDeliveries({
			organizationId: ids.organization,
			now: T0.add({ minutes: 12 }),
		});
		expect(afterRepairPass.claimed).toBe(0);
		expect(calls).toHaveLength(0);

		// Operations can inspect uncertain work with redacted context
		const opsItems = await listUncertainApprovalDeliveriesForOperations({
			organizationId: ids.organization,
		});
		expect(opsItems).toHaveLength(1);
		expect(opsItems[0]?.workId).toBe(work.id);
		expect(opsItems[0]?.dispatchAttemptState).toBe("uncertain_across_switch");
		expect(opsItems[0]?.fallback).toBe("z8_inbox");

		// Before 7 days: stays open for reconciliation
		const earlyClose = await closeExpiredUncertainApprovalDeliveries({
			organizationId: ids.organization,
			now: T0.add({ hours: 7 * 24 }), // 3 minutes short of 7d from T0+3m
		});
		expect(earlyClose.closedCount).toBe(0);

		// At/after 7 days from reconciliation_required_at (T0+3m): closes as explicit unknown
		const expiredClose = await closeExpiredUncertainApprovalDeliveries({
			organizationId: ids.organization,
			now: T0.add({ hours: 7 * 24, minutes: 3 }),
		});
		expect(expiredClose.closedCount).toBe(1);
		expect(expiredClose.closedWork[0]?.id).toBe(work.id);

		const workAfterClose = (
			await admin.query<{
				dispatch_attempt_state: string | null;
				last_outcome: string | null;
				unknown_closed_at: Date | null;
			}>(
				`select dispatch_attempt_state, last_outcome, unknown_closed_at
				 from approval_delivery_work where id = $1`,
				[work.id],
			)
		).rows[0]!;
		expect(workAfterClose.dispatch_attempt_state).toBe("closed_unknown");
		expect(workAfterClose.last_outcome).toBe("unknown_closed");
		expect(workAfterClose.unknown_closed_at).not.toBeNull();

		// Pending approval remains reachable and decidable in Z8 inbox!
		const webApproval = await approveOnWeb(submitted);
		expect(webApproval.success).toBe(true);
	});

	it("reroutes confirmed_unsent work safely to the new active installation under existing deduplication", async () => {
		// Re-seed without manager's chat on Installation A so first attempt is confirmed unsent
		await seed({ includeManagerChatA: false });
		const submitted = await submitAbsence();

		const pass1 = await processApprovalDeliveries({ organizationId: ids.organization, now: T0 });
		expect(pass1.outcomes.awaiting_repair).toBe(1);
		expect(calls).toHaveLength(0);

		const workBefore = (
			await admin.query<{ id: string; dedupe_key: string; dispatch_attempt_state: string | null }>(
				`select id, dedupe_key, dispatch_attempt_state from approval_delivery_work where workflow_id = $1`,
				[submitted.workflow_id],
			)
		).rows[0]!;
		expect(workBefore.dispatch_attempt_state).toBe("confirmed_unsent");

		// Switch to Installation B where manager has a verified conversation
		await switchTelegramToInstallationB({ includeManagerConversationB: true });

		// Destination repair re-arms the confirmed_unsent work row
		await rearmApprovalDeliveryForRepairedDestination({
			organizationId: ids.organization,
			userId: ids.managerUser,
			provider: "telegram",
			now: T0.add({ minutes: 2 }),
		});

		const pass2 = await processApprovalDeliveries({
			organizationId: ids.organization,
			now: T0.add({ minutes: 3 }),
		});
		expect(pass2.outcomes.delivered).toBe(1);
		expect(calls).toHaveLength(1);
		expect(calls[0]?.token).toBe(TOKEN_B);
		expect(String(calls[0]?.body.chat_id)).toBe(String(MANAGER_CHAT_B));

		// Same work row / dedupe_key was reused; message recorded under Installation B
		const workCount = (
			await admin.query<{ cnt: number }>(
				`select count(*)::int as cnt from approval_delivery_work where workflow_id = $1 and effect = 'initial'`,
				[submitted.workflow_id],
			)
		).rows[0]?.cnt;
		expect(workCount).toBe(1);

		const deliveredMsg = (
			await admin.query<{ installation_id: string | null; credential_revision_id: string | null }>(
				`select installation_id, credential_revision_id from approval_delivery_message where workflow_id = $1`,
				[submitted.workflow_id],
			)
		).rows[0]!;
		expect(deliveredMsg).toEqual({
			installation_id: ids.instB,
			credential_revision_id: ids.revB,
		});
	});

	it("counts canonical messages and outstanding work by origin and counts legacy cards only while underlying approval is pending", async () => {
		// 1 canonical card delivered on Installation A
		await submitAbsence();
		await processApprovalDeliveries({ organizationId: ids.organization, now: T0 });

		// 2 legacy approval_request rows + legacy telegram_approval_message rows both with status = 'sent':
		// one pending, one already approved!
		const ts = new Date("2030-06-10T09:00:00Z");
		const pendingReqId = "e2043900-0000-4000-8000-000000000001";
		const approvedReqId = "e2043900-0000-4000-8000-000000000002";
		await admin.query(
			`insert into approval_request
			 (id, organization_id, entity_type, entity_id, requested_by, approver_id, status, created_at, updated_at)
			 values
			 ($1, $3, 'absence_entry', gen_random_uuid(), $4, $5, 'pending', $6, $6),
			 ($2, $3, 'absence_entry', gen_random_uuid(), $4, $5, 'approved', $6, $6)`,
			[pendingReqId, approvedReqId, ids.organization, ids.requester, ids.manager, ts],
		);
		await admin.query(
			`insert into telegram_approval_message
			 (organization_id, approval_request_id, chat_id, message_id, recipient_user_id, status, created_at, updated_at)
			 values
			 ($1, $2, '204351', '88001', $4, 'sent', $5, $5),
			 ($1, $3, '204351', '88002', $4, 'sent', $5, $5)`,
			[ids.organization, pendingReqId, approvedReqId, ids.managerUser, ts],
		);

		const countsA = await countOutstandingApprovalWorkByInstallation(ids.organization, ids.instA);
		expect(countsA.provider).toBe("telegram");
		expect(countsA.openCanonicalMessages).toBe(1);
		expect(countsA.pendingLegacyCards).toBe(1); // Only the pending request, NOT the approved one!
		expect(countsA.totalOutstanding).toBe(2);

		// After switch to Installation B, Installation B has 0 outstanding items
		await switchTelegramToInstallationB();
		const countsB = await countOutstandingApprovalWorkByInstallation(ids.organization, ids.instB);
		expect(countsB.openCanonicalMessages).toBe(0);
		expect(countsB.pendingLegacyCards).toBe(0);
		expect(countsB.totalOutstanding).toBe(0);

		// Tenant isolation: another org sees zeros
		const crossOrgCounts = await countOutstandingApprovalWorkByInstallation(
			ids.otherOrganization,
			ids.instA,
		);
		expect(crossOrgCounts.totalOutstanding).toBe(0);

		// Ambiguous historical origin across two Slack installations with identical workspace scope
		await admin.query(
			`insert into chat_installation
			 (id, organization_id, provider, credential_source, status, route_id, external_space_id,
			  receiver_scope, verification_state, created_at, updated_at)
			 values
			 ($1, $3, 'slack', 'deployment_managed', 'retiring', 'route-slack-1', 'T2043', 'slack-team:T2043', 'verified', $4, $4),
			 ($2, $3, 'slack', 'organization_owned', 'active', 'route-slack-2', 'T2043', 'slack-team:T2043', 'verified', $4, $4)`,
			[ids.slackInst1, ids.slackInst2, ids.organization, ts],
		);
		const ambiguousOrigin = await resolveCardOriginInstallation({
			organizationId: ids.organization,
			provider: "slack",
			installationId: null,
			receiverScope: "slack-team:T2043",
			now: T0,
		});
		expect(ambiguousOrigin).toEqual({
			kind: "ambiguous_inbox_fallback",
			reason: "multiple_matching_installations",
			fallback: "z8_inbox",
		});
	});
});
