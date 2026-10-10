/**
 * #1017 (spec #802, Approvals ADR 0002): approval cards for the covering
 * deputy. While Y covers for the absent approver X, a new approval assigned to
 * X also sends Y a card on Y's own channel, bound to Y and to X's assignment.
 * Y's card decides as a deputy decision while Y covers, refuses with "No
 * longer covering for X" once Y no longer does, and the delivery owner retires
 * Y's open cards when cover ends.
 *
 * A real absence submission commits its lifecycle intents; the real delivery
 * owner plans, sends and refreshes the cards; real Telegram webhook presses
 * decide through the real owners. Only the request/session, billing guard,
 * e-mail and notification fan-out, calendar queue, the vault, the post-commit
 * fast path and the Telegram HTTP transport (fetch) are replaced.
 */

import { Temporal } from "temporal-polyfill";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { integrationAdminPool } from "@/test/integration-database";

const harness = vi.hoisted(() => ({
	userId: null as string | null,
	organizationId: null as string | null,
	kicks: [] as Array<{ organizationId: string; workflowId?: string | null }>,
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
	getOrganizationBaseUrl: async () => "https://t1017.example.test",
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

vi.mock("@/lib/vault", async (importOriginal) =>
	(await import("@/test/integration-harness")).vault(
		importOriginal,
		async () => "101710171:AAT1017-deputy_cards_test",
	),
);

vi.mock("@/lib/approvals/delivery/kick", async () =>
	(await import("@/test/integration-harness")).deliveryKick(harness.kicks),
);

const BOT_TOKEN = "101710171:AAT1017-deputy_cards_test";

const { requestAbsenceEffect } = await import(
	"@/app/[locale]/(app)/absences/request-absence-effect"
);
const { approveAbsenceEffect } = await import("@/lib/approvals/server/absence-approvals");
const { processApprovalDeliveries } = await import("./owner");
const { handleTelegramUpdate } = await import("@/lib/telegram/bot-handler");
const { processDueEscalations } = await import("@/lib/approvals/escalation/transfer");
const { processEscalationReplacementDeliveries } = await import(
	"@/lib/approvals/escalation/replacement-delivery"
);

const APPROVER_TELEGRAM_ID = 10_171;
const APPROVER_CHAT_ID = 1_017_001;
const DEPUTY_TELEGRAM_ID = 10_172;
const DEPUTY_CHAT_ID = 1_017_002;
// Pinned pass time; it must lie after the real time the test runs at, and
// inside X's absence (which runs from two days ago into 2030).
const T0 = Temporal.Instant.from("2030-01-07T10:00:00Z");
const ABSENCE_END = "2030-01-31";

const ids = {
	organization: "t1017-deputy-cards-org",
	requesterUser: "t1017-requester-user",
	approverUser: "t1017-approver-user",
	deputyUser: "t1017-deputy-user",
	otherDeputyUser: "t1017-other-deputy-user",
	requester: "e1017000-0000-4000-8000-000000000001",
	approver: "e1017000-0000-4000-8000-000000000002",
	deputy: "e1017000-0000-4000-8000-000000000003",
	otherDeputy: "e1017000-0000-4000-8000-000000000004",
	managerLink: "e1017100-0000-4000-8000-000000000001",
	backupLink: "e1017100-0000-4000-8000-000000000002",
	vacation: "e1017200-0000-4000-8000-000000000001",
	away: "e1017200-0000-4000-8000-000000000002",
	coveringAbsence: "e1017300-0000-4000-8000-000000000001",
} as const;

interface TelegramCall {
	method: string;
	body: Record<string, unknown>;
}

function only<T>(rows: readonly T[]): T {
	const [row] = rows;
	if (rows.length !== 1 || row === undefined) {
		throw new Error(`Expected exactly one row, received ${rows.length}`);
	}
	return row;
}

function minutes(count: number) {
	return T0.add({ minutes: count });
}

/** A UTC calendar day relative to the real today, as `YYYY-MM-DD`. */
function utcDay(offset: number): string {
	return Temporal.Now.instant()
		.toZonedDateTimeISO("UTC")
		.toPlainDate()
		.add({ days: offset })
		.toString();
}

describe("Deputy approval cards (PostgreSQL)", () => {
	const admin = integrationAdminPool();
	const calls: TelegramCall[] = [];
	let nextMessageId = 17_100;
	const originalFetch = globalThis.fetch;

	function actAs(userId: string) {
		harness.userId = userId;
		harness.organizationId = ids.organization;
	}

	function installTelegramTransport() {
		globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
			const url = String(input);
			const match = /^https:\/\/api\.telegram\.org\/bot[^/]+\/(\w+)$/.exec(url);
			if (!match) throw new Error(`Unexpected fetch in test: ${url}`);
			const method = match[1] ?? "";
			const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
			calls.push({ method, body });
			const result =
				method === "sendMessage"
					? {
							message_id: nextMessageId++,
							date: 1_790_000_000,
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
		await admin.query("delete from organization where id = $1", [ids.organization]);
		await admin.query('delete from "user" where id = any($1::text[])', [
			[ids.requesterUser, ids.approverUser, ids.deputyUser, ids.otherDeputyUser],
		]);
	}

	async function seed(
		options: {
			mode?: "canonical" | "legacy";
			absenceStart?: string;
			absenceEnd?: string;
			/** Escalation on, with Z as the requester's next manager (the backup). */
			escalation?: boolean;
		} = {},
	) {
		await cleanup();
		const timestamp = new Date("2026-07-01T00:00:00Z");
		const mode = options.mode ?? "canonical";
		await admin.query(
			`insert into organization (id, name, slug, created_at) values ($1, 'T1017 deputy cards', $1, $2)`,
			[ids.organization, timestamp],
		);
		await admin.query(
			`insert into approval_workflow_rollout
			 (organization_id, workflow_type, lifecycle_mode, side_effect_mode, created_at, updated_at)
			 values ($1, 'absence', $2, $3, $4, $4)`,
			[ids.organization, mode, mode, timestamp],
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
			[ids.organization, timestamp],
		);
		await admin.query(
			`insert into "user" (id, name, email, created_at, updated_at) values
			 ($1, 'Avery Requester', 't1017-requester@example.test', $5, $5),
			 ($2, 'Morgan Manager', 't1017-approver@example.test', $5, $5),
			 ($3, 'Dana Deputy', 't1017-deputy@example.test', $5, $5),
			 ($4, 'Zoe Other', 't1017-other@example.test', $5, $5)`,
			[ids.requesterUser, ids.approverUser, ids.deputyUser, ids.otherDeputyUser, timestamp],
		);
		await admin.query(
			`insert into user_settings (user_id, locale, timezone, time_format, updated_at)
			 select user_id, 'en', 'Europe/Berlin', '24h', $2 from unnest($1::text[]) as user_id`,
			[[ids.approverUser, ids.deputyUser], timestamp],
		);
		await admin.query(
			`insert into member (id, organization_id, user_id, role, status, created_at)
			 select 't1017-member-' || user_id, $1, user_id, 'member', 'approved', $2
			 from unnest($3::text[]) as user_id`,
			[
				ids.organization,
				timestamp,
				[ids.requesterUser, ids.approverUser, ids.deputyUser, ids.otherDeputyUser],
			],
		);
		await admin.query(
			`insert into employee (id, user_id, organization_id, role, updated_at) values
			 ($1, $2, $9, 'employee', $10), ($3, $4, $9, 'manager', $10),
			 ($5, $6, $9, 'manager', $10), ($7, $8, $9, 'manager', $10)`,
			[
				ids.requester,
				ids.requesterUser,
				ids.approver,
				ids.approverUser,
				ids.deputy,
				ids.deputyUser,
				ids.otherDeputy,
				ids.otherDeputyUser,
				ids.organization,
				timestamp,
			],
		);
		await admin.query(
			`insert into employee_managers
			 (id, employee_id, manager_id, is_primary, assigned_by, assigned_at, created_at)
			 values ($1, $2, $3, true, $4, $5, $5)`,
			[ids.managerLink, ids.requester, ids.approver, ids.approverUser, timestamp],
		);
		if (options.escalation) {
			await admin.query(
				`insert into employee_managers
				 (id, employee_id, manager_id, is_primary, assigned_by, assigned_at, created_at)
				 values ($1, $2, $3, false, $4, $5, $5)`,
				[ids.backupLink, ids.requester, ids.otherDeputy, ids.approverUser, timestamp],
			);
			await admin.query(
				`insert into approval_escalation_control
				 (organization_id, owner, automation_paused, escalation_owned_since)
				 values ($1, 'escalation', false, $2)`,
				[ids.organization, timestamp],
			);
			await admin.query(
				`insert into approval_escalation_policy
				 (organization_id, enabled, response_window_hours, revision, migration_provenance)
				 values ($1, true, 1, 1, '{"source":"t1017"}'::jsonb)`,
				[ids.organization],
			);
		}
		await admin.query(
			`insert into absence_category
			 (id, organization_id, type, name, requires_approval, requires_work_time,
			  counts_against_vacation, is_active, updated_at)
			 values ($1, $3, 'vacation', 'Vacation', true, false, true, true, $4),
			        ($2, $3, 'vacation', 'Away', true, false, false, true, $4)`,
			[ids.vacation, ids.away, ids.organization, timestamp],
		);
		// X is away from two days ago into 2030 and names Y as deputy.
		await admin.query(
			`insert into absence_entry
			 (id, employee_id, category_id, start_date, end_date, status, organization_id,
			  deputy_employee_id, updated_at)
			 values ($1, $2, $3, $4, $5, 'approved', $6, $7, $8)`,
			[
				ids.coveringAbsence,
				ids.approver,
				ids.away,
				options.absenceStart ?? utcDay(-2),
				options.absenceEnd ?? ABSENCE_END,
				ids.organization,
				ids.deputy,
				timestamp,
			],
		);
		await admin.query(
			`insert into telegram_bot_config
			 (organization_id, bot_token, bot_username, webhook_secret, setup_status,
			  enable_approvals, enable_escalations, updated_at)
			 values ($1, 'vault:managed', 't1017_bot', 't1017-secret', 'active', true, false, $2)`,
			[ids.organization, timestamp],
		);
		await admin.query(
			`insert into telegram_user_mapping
			 (user_id, organization_id, telegram_user_id, is_active, updated_at)
			 values ($1, $3, $4, true, $5), ($2, $3, $6, true, $5)`,
			[
				ids.approverUser,
				ids.deputyUser,
				ids.organization,
				String(APPROVER_TELEGRAM_ID),
				timestamp,
				String(DEPUTY_TELEGRAM_ID),
			],
		);
		await admin.query(
			`insert into telegram_conversation
			 (organization_id, user_id, chat_id, chat_type, is_active, updated_at)
			 values ($1, $2, $3, 'private', true, $6), ($1, $4, $5, 'private', true, $6)`,
			[
				ids.organization,
				ids.approverUser,
				String(APPROVER_CHAT_ID),
				ids.deputyUser,
				String(DEPUTY_CHAT_ID),
				timestamp,
			],
		);
	}

	async function submit(): Promise<{ absenceId: string; requestId: string }> {
		actAs(ids.requesterUser);
		const result = await requestAbsenceEffect({
			categoryId: ids.vacation,
			startDate: "2026-10-05",
			endDate: "2026-10-06",
			startPeriod: "full_day",
			endPeriod: "full_day",
			durationKind: "full_day",
			notes: null,
		});
		harness.userId = null;
		if (!result.success) throw new Error(`Submission failed: ${result.error}`);
		const { rows } = await admin.query<{ id: string }>(
			`select id from approval_request
			 where organization_id = $1 and entity_id = $2 and status = 'pending'`,
			[ids.organization, result.data.absenceId],
		);
		return { absenceId: result.data.absenceId, requestId: only(rows).id };
	}

	function deliver(now: Temporal.Instant = T0) {
		return processApprovalDeliveries({ organizationId: ids.organization, now });
	}

	async function approveOnWeb(submitted: { absenceId: string; requestId: string }) {
		actAs(ids.approverUser);
		const result = await approveAbsenceEffect(submitted.absenceId, {
			approvalRequestId: submitted.requestId,
		});
		harness.userId = null;
		if (!result.success) throw new Error(`Web approval failed: ${result.error}`);
	}

	async function messages() {
		const { rows } = await admin.query<{
			id: string;
			assignment_id: string | null;
			legacy_approval_request_id: string | null;
			recipient_employee_id: string;
			acting_for_employee_id: string | null;
			destination_id: string;
			remote_message_id: string;
			binding_id: string | null;
			controls: string;
			state: string;
		}>(
			`select * from approval_delivery_message where organization_id = $1
			 order by remote_message_id`,
			[ids.organization],
		);
		return rows;
	}

	async function deputyMessage() {
		return only((await messages()).filter((row) => row.recipient_employee_id === ids.deputy));
	}

	async function approverMessage() {
		return only((await messages()).filter((row) => row.recipient_employee_id === ids.approver));
	}

	const sends = () => calls.filter((call) => call.method === "sendMessage");
	const edits = () => calls.filter((call) => call.method === "editMessageText");
	const sendsTo = (chatId: number) =>
		sends().filter((call) => call.body.chat_id === String(chatId));
	const editsOf = (message: { remote_message_id: string }) =>
		edits().filter((call) => call.body.message_id === Number(message.remote_message_id));
	const answers = () => calls.filter((call) => call.method === "answerCallbackQuery");
	const buttonsOf = (call: TelegramCall) =>
		(
			call.body.reply_markup as {
				inline_keyboard: Array<Array<{ callback_data?: string; url?: string }>>;
			}
		).inline_keyboard.flat();

	function botConfig() {
		return {
			organizationId: ids.organization,
			botToken: BOT_TOKEN,
			botUsername: "t1017_bot",
			webhookSecret: "t1017-secret",
			setupStatus: "active",
			enableApprovals: true,
			enableCommands: true,
			enableDailyDigest: false,
			enableEscalations: false,
			digestTime: "09:00",
			digestTimezone: "UTC",
			escalationTimeoutHours: 24,
		};
	}

	/** Y presses approve on Y's own card. */
	async function deputyPressesApprove(queryId: string) {
		const card = only(sendsTo(DEPUTY_CHAT_ID));
		const message = await deputyMessage();
		const data =
			buttonsOf(card).find((button) => button.callback_data?.includes('"ba"'))?.callback_data ?? "";
		await handleTelegramUpdate(
			{
				update_id: 7000 + calls.length,
				callback_query: {
					id: queryId,
					from: { id: DEPUTY_TELEGRAM_ID, is_bot: false, first_name: "Dana" },
					message: {
						message_id: Number(message.remote_message_id),
						date: 1_790_000_000,
						chat: { id: DEPUTY_CHAT_ID, type: "private" as const },
					},
					data,
				},
			},
			botConfig(),
		);
	}

	async function requestStatus(requestId: string) {
		const { rows } = await admin.query<{ status: string }>(
			"select status from approval_request where id = $1",
			[requestId],
		);
		return only(rows).status;
	}

	beforeEach(() => {
		harness.userId = null;
		harness.organizationId = null;
		harness.kicks.length = 0;
		calls.length = 0;
		installTelegramTransport();
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	afterAll(async () => {
		await cleanup();
	});

	it("sends the covering deputy one card bound to the deputy and X's assignment, besides X's own", async () => {
		await seed();
		await submit();

		await deliver();
		expect(sendsTo(APPROVER_CHAT_ID)).toHaveLength(1);
		const card = only(sendsTo(DEPUTY_CHAT_ID));
		expect(String(card.body.text)).toContain("Absence approval request");
		expect(String(card.body.text)).toContain("Covering for: Morgan Manager");
		expect(buttonsOf(card).filter((button) => button.callback_data)).toHaveLength(2);
		expect(String(only(sendsTo(APPROVER_CHAT_ID)).body.text)).not.toContain("Covering for");

		const own = await approverMessage();
		const deputy = await deputyMessage();
		expect(own.acting_for_employee_id).toBeNull();
		expect(deputy).toMatchObject({
			assignment_id: own.assignment_id,
			acting_for_employee_id: ids.approver,
			destination_id: String(DEPUTY_CHAT_ID),
			controls: "actionable",
			state: "current",
		});
		const { rows: bindings } = await admin.query<{
			recipient_employee_id: string;
			assignment_id: string;
			acting_for_employee_id: string | null;
		}>(
			"select recipient_employee_id, assignment_id, acting_for_employee_id from approval_review_binding where id = $1",
			[deputy.binding_id],
		);
		expect(only(bindings)).toEqual({
			recipient_employee_id: ids.deputy,
			assignment_id: own.assignment_id,
			acting_for_employee_id: ids.approver,
		});

		// A later pass never sends either card again.
		await deliver(minutes(60));
		expect(sends()).toHaveLength(2);
	});

	it("sends no deputy card for an approval assigned to X before cover started", async () => {
		await seed({ absenceStart: utcDay(-1) });
		await submit();
		// The assignment became X's three days ago, before X's absence began.
		await admin.query(
			`update approval_stage_assignment set assigned_at = now() - interval '3 days'
			 where organization_id = $1`,
			[ids.organization],
		);
		await admin.query(
			`update approval_workflow_stage set activated_at = now() - interval '3 days'
			 where organization_id = $1`,
			[ids.organization],
		);

		await deliver();
		expect(sendsTo(APPROVER_CHAT_ID)).toHaveLength(1);
		expect(sendsTo(DEPUTY_CHAT_ID)).toHaveLength(0);
	});

	it("sends a replacement deputy no card for an approval already waiting when they were named", async () => {
		await seed();
		await admin.query(
			"update absence_entry set deputy_employee_id = $2, deputy_assigned_at = now() where id = $1",
			[ids.coveringAbsence, ids.otherDeputy],
		);
		await submit();
		// Y replaces Z after the approval became X's.
		await admin.query(
			`update absence_entry set deputy_employee_id = $2,
				deputy_assigned_at = now() + interval '1 second' where id = $1`,
			[ids.coveringAbsence, ids.deputy],
		);

		await deliver();
		expect(sendsTo(APPROVER_CHAT_ID)).toHaveLength(1);
		expect(sendsTo(DEPUTY_CHAT_ID)).toHaveLength(0);
	});

	it("sends no deputy card for an approval already waiting when X's absence was approved", async () => {
		await seed();
		await admin.query("update absence_entry set status = 'pending' where id = $1", [
			ids.coveringAbsence,
		]);
		await submit();
		await admin.query(
			`update absence_entry set status = 'approved',
				approved_at = (now() at time zone 'UTC') + interval '1 second' where id = $1`,
			[ids.coveringAbsence],
		);

		await deliver();
		expect(sendsTo(APPROVER_CHAT_ID)).toHaveLength(1);
		expect(sendsTo(DEPUTY_CHAT_ID)).toHaveLength(0);
	});

	it("sends no deputy card once cover has ended", async () => {
		await seed({ absenceStart: utcDay(-10), absenceEnd: utcDay(-2) });
		await submit();

		await deliver();
		expect(sendsTo(APPROVER_CHAT_ID)).toHaveLength(1);
		expect(sendsTo(DEPUTY_CHAT_ID)).toHaveLength(0);
	});

	it("decides from the deputy's card as a deputy decision for X, then refreshes both cards", async () => {
		await seed();
		const submitted = await submit();
		await deliver();

		await deputyPressesApprove("t1017-q-approve");
		expect(await requestStatus(submitted.requestId)).toBe("approved");
		expect(only(answers()).body.text).toBe("Request approved");
		const { rows: actingFor } = await admin.query<{
			deputy_employee_id: string;
			acting_for_employee_id: string;
			absence_id: string;
			decision: string;
		}>(
			`select deputy_employee_id, acting_for_employee_id, absence_id, decision
			 from approval_deputy_decision where organization_id = $1`,
			[ids.organization],
		);
		expect(only(actingFor)).toEqual({
			deputy_employee_id: ids.deputy,
			acting_for_employee_id: ids.approver,
			absence_id: ids.coveringAbsence,
			decision: "approved",
		});

		await deliver(minutes(1));
		for (const message of [await approverMessage(), await deputyMessage()]) {
			expect(String(only(editsOf(message)).body.text)).toContain("Request approved");
			expect(message).toMatchObject({ controls: "none", state: "retired" });
		}
	});

	it.each([
		[
			"cover ended",
			async () => {
				await admin.query("update absence_entry set end_date = $2 where id = $1", [
					ids.coveringAbsence,
					utcDay(-1),
				]);
			},
		],
		[
			"the deputy changed",
			async () => {
				await admin.query("update absence_entry set deputy_employee_id = $2 where id = $1", [
					ids.coveringAbsence,
					ids.otherDeputy,
				]);
			},
		],
		[
			"deputy decisions are switched off",
			async () => {
				await admin.query(
					`insert into approval_setting (organization_id, deputy_decisions_enabled)
					 values ($1, false)`,
					[ids.organization],
				);
			},
		],
	])(
		"refuses a press on the deputy's card after %s, with No longer covering for X",
		async (_case, endCover) => {
			await seed();
			const submitted = await submit();
			await deliver();
			await endCover();

			await deputyPressesApprove("t1017-q-refused");
			expect(await requestStatus(submitted.requestId)).toBe("pending");
			expect(only(answers()).body.text).toBe("No longer covering for Morgan Manager");
			const deputy = await deputyMessage();
			const edit = only(editsOf(deputy));
			expect(String(edit.body.text)).toContain("No longer covering for Morgan Manager");
			expect(buttonsOf(edit).every((button) => !button.callback_data)).toBe(true);
			expect(deputy.controls).toBe("none");
			expect(await approverMessage()).toMatchObject({ controls: "actionable", state: "current" });
			const { rows } = await admin.query(
				"select 1 from approval_deputy_decision where organization_id = $1",
				[ids.organization],
			);
			expect(rows).toHaveLength(0);
		},
	);

	it("retires the deputy's open card when the deputy changes; a later decision shows its outcome", async () => {
		await seed();
		const submitted = await submit();
		await deliver();
		await admin.query("update absence_entry set deputy_employee_id = $2 where id = $1", [
			ids.coveringAbsence,
			ids.otherDeputy,
		]);

		await deliver(minutes(1));
		const deputy = await deputyMessage();
		const retired = only(editsOf(deputy));
		expect(String(retired.body.text)).toContain("No longer covering for Morgan Manager");
		expect(buttonsOf(retired).every((button) => !button.callback_data)).toBe(true);
		expect(deputy).toMatchObject({ controls: "none", state: "retired" });
		const own = await approverMessage();
		expect(own).toMatchObject({ controls: "actionable", state: "current" });
		expect(editsOf(own)).toHaveLength(0);

		// Nothing more to retire.
		await deliver(minutes(2));
		expect(edits()).toHaveLength(1);

		// Decided by anyone: the retired deputy card shows the outcome (decision 11).
		await approveOnWeb(submitted);
		await deliver(minutes(3));
		expect(String(only(editsOf(own)).body.text)).toContain("Request approved");
		const outcome = editsOf(deputy);
		expect(outcome).toHaveLength(2);
		expect(String(outcome[1]?.body.text)).toContain("Request approved");
	});

	it("retires the deputy's open card when cover ends", async () => {
		await seed();
		await submit();
		await deliver();
		await admin.query("update absence_entry set end_date = $2 where id = $1", [
			ids.coveringAbsence,
			utcDay(-1),
		]);

		await deliver(minutes(1));
		const deputy = await deputyMessage();
		expect(String(only(editsOf(deputy)).body.text)).toContain(
			"No longer covering for Morgan Manager",
		);
		expect(deputy).toMatchObject({ controls: "none", state: "retired" });
	});

	it.each(["canonical", "legacy"] as const)(
		"refuses the deputy's card after an escalation transfer and retires it as reassigned (%s)",
		async (mode) => {
			await seed({ mode, escalation: true });
			const submitted = await submit();
			await deliver();
			expect(sendsTo(DEPUTY_CHAT_ID)).toHaveLength(1);
			const escalated = await processDueEscalations({ organizationId: ids.organization, now: T0 });
			expect(escalated.transferred).toBe(1);

			await deputyPressesApprove("t1017-q-escalated");
			expect(only(answers()).body.text).toBe("Reassigned");
			const { rows } = await admin.query(
				"select 1 from approval_deputy_decision where organization_id = $1",
				[ids.organization],
			);
			expect(rows).toHaveLength(0);
			const { rows: decided } = await admin.query<{ status: string }>(
				"select status from absence_entry where id = $1",
				[submitted.absenceId],
			);
			expect(only(decided).status).toBe("pending");

			await processEscalationReplacementDeliveries({
				organizationId: ids.organization,
				now: minutes(1),
			});
			await deliver(minutes(1));
			const deputy = await deputyMessage();
			expect(deputy.controls).toBe("none");
			const retired = editsOf(deputy).at(-1);
			expect(String(retired?.body.text)).toContain("Reassigned");
		},
	);

	describe("under legacy absence authority", () => {
		it("issues a legacy deputy card and decides from it as a deputy decision for X", async () => {
			await seed({ mode: "legacy" });
			const submitted = await submit();
			await deliver();
			const card = only(sendsTo(DEPUTY_CHAT_ID));
			expect(String(card.body.text)).toContain("Covering for: Morgan Manager");
			const deputy = await deputyMessage();
			expect(deputy).toMatchObject({
				legacy_approval_request_id: submitted.requestId,
				acting_for_employee_id: ids.approver,
				controls: "actionable",
			});
			const { rows: bindings } = await admin.query<{
				recipient_employee_id: string;
				legacy_approval_request_id: string;
				acting_for_employee_id: string | null;
			}>(
				`select recipient_employee_id, legacy_approval_request_id, acting_for_employee_id
				 from approval_review_binding where id = $1`,
				[deputy.binding_id],
			);
			expect(only(bindings)).toEqual({
				recipient_employee_id: ids.deputy,
				legacy_approval_request_id: submitted.requestId,
				acting_for_employee_id: ids.approver,
			});

			await deputyPressesApprove("t1017-legacy-approve");
			expect(await requestStatus(submitted.requestId)).toBe("approved");
			const { rows: actingFor } = await admin.query<{
				authority: string;
				acting_for_employee_id: string;
			}>(
				`select authority, acting_for_employee_id from approval_deputy_decision
				 where organization_id = $1`,
				[ids.organization],
			);
			expect(only(actingFor)).toEqual({
				authority: "legacy",
				acting_for_employee_id: ids.approver,
			});
		});

		it("refuses a press on the legacy deputy card after the deputy changed", async () => {
			await seed({ mode: "legacy" });
			const submitted = await submit();
			await deliver();
			await admin.query("update absence_entry set deputy_employee_id = $2 where id = $1", [
				ids.coveringAbsence,
				ids.otherDeputy,
			]);

			await deputyPressesApprove("t1017-legacy-refused");
			expect(await requestStatus(submitted.requestId)).toBe("pending");
			expect(only(answers()).body.text).toBe("No longer covering for Morgan Manager");
			expect((await deputyMessage()).controls).toBe("none");
		});
	});
});
