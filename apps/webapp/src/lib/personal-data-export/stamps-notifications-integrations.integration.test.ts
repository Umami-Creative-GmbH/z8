/**
 * #1170: the Position stamps, Notifications and Integrations categories of a
 * personal data export against a disposable PostgreSQL database. Exports are
 * built by the worker processor from seeded rows; object storage and
 * notifications are replaced. Ada works in two organizations; only the
 * exported organization's rows may appear, and only Ada's.
 */

import JSZip from "jszip";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { withCanonicalRecords } from "@/lib/time-tracking/work-records/__tests__/historical-work";
import { integrationAdminPool } from "@/test/integration-database";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

vi.mock("@/lib/storage/export-s3-client", () => ({
	uploadPrivateObjectStream: async () => ({ bucket: "unused", versionId: null }),
	deletePrivateObject: async () => undefined,
	deletePrivateObjectVersions: async () => undefined,
}));

const { db } = await import("@/db");
const { processPersonalDataExport } = await import("./processor");
const { positionStampsCollector } = await import("./collectors/position-stamps");

const ORG = "t1170-org";
const OTHER = "t1170-other";

const ids = {
	ada: "11700000-0000-4000-8000-000000000001",
	owner: "11700000-0000-4000-8000-000000000002",
	bob: "11700000-0000-4000-8000-000000000003",
	mia: "11700000-0000-4000-8000-000000000004",
	adaOther: "11700000-0000-4000-8000-000000000005",
	notice1: "11700000-0000-4000-8000-0000000000a1",
	notice2: "11700000-0000-4000-8000-0000000000a2",
	noticeOther: "11700000-0000-4000-8000-0000000000a3",
	consentOld: "11700000-0000-4000-8000-0000000000b1",
	consentNow: "11700000-0000-4000-8000-0000000000b2",
	consentBob: "11700000-0000-4000-8000-0000000000b3",
	consentOther: "11700000-0000-4000-8000-0000000000b4",
	adaIn: "11700000-0000-4000-8000-0000000000c1",
	adaOut: "11700000-0000-4000-8000-0000000000c2",
	bobIn: "11700000-0000-4000-8000-0000000000c3",
	otherIn: "11700000-0000-4000-8000-0000000000c4",
	adaPeriod: "11700000-0000-4000-8000-0000000000d1",
	bobPeriod: "11700000-0000-4000-8000-0000000000d2",
	logDetail: "11700000-0000-4000-8000-0000000000e1",
	logExport: "11700000-0000-4000-8000-0000000000e2",
	logBobOnly: "11700000-0000-4000-8000-0000000000e3",
	logOther: "11700000-0000-4000-8000-0000000000e4",
	notification: "11700000-0000-4000-8000-0000000000f1",
	team: "11700000-0000-4000-8000-0000000000f2",
	store: "11700000-0000-4000-8000-0000000000f3",
	kiosk: "11700000-0000-4000-8000-0000000000f4",
	adaEmployment: "11700000-0000-4000-8000-0000000000f5",
	bobEmployment: "11700000-0000-4000-8000-0000000000f6",
	adaOtherEmployment: "11700000-0000-4000-8000-0000000000f7",
	adaOldFob: "11700000-0000-4000-8000-0000000000f8",
	adaFob: "11700000-0000-4000-8000-0000000000f9",
} as const;

const admin = integrationAdminPool();
const uploads = new Map<string, Uint8Array>();

async function cleanup() {
	await admin.query("delete from audit_log where organization_id = any($1::text[])", [
		[ORG, OTHER],
	]);
	await admin.query("delete from organization where id = any($1::text[])", [[ORG, OTHER]]);
	// Deleted exports leave file cleanup ledger rows; the sweep in sibling suites drains the whole ledger.
	await admin.query(
		"delete from personal_data_export_file_cleanup where organization_id = any($1::text[])",
		[[ORG, OTHER]],
	);
	await admin.query('delete from "user" where id like $1', ["t1170-%"]);
}

async function seedPerson(
	organizationId: string,
	name: string,
	employeeId: string,
	displayName: string,
	role = "member",
) {
	await admin.query(
		`insert into "user" (id, name, email, created_at, updated_at) values ($1, $2, $3, now(), now())
		 on conflict (id) do nothing`,
		[`t1170-${name}`, displayName, `t1170-${name}@example.test`],
	);
	await admin.query(
		"insert into member (id, organization_id, user_id, role, status, created_at) values ($1, $2, $3, $4, 'approved', now())",
		[`t1170-member-${organizationId}-${name}`, organizationId, `t1170-${name}`, role],
	);
	await admin.query(
		`insert into employee (id, user_id, organization_id, role, is_active, updated_at)
		 values ($1, $2, $3, $4, true, now())`,
		[employeeId, `t1170-${name}`, organizationId, role === "member" ? "employee" : "admin"],
	);
}

async function seed() {
	await cleanup();
	await admin.query(
		`insert into organization (id, name, slug, timezone, created_at) values
		 ($1, 'Acme GmbH', $1, 'Europe/Berlin', now()), ($2, 'Other GmbH', $2, 'UTC', now())`,
		[ORG, OTHER],
	);
	await seedPerson(ORG, "ada", ids.ada, "Ada Lovelace");
	await seedPerson(ORG, "owner", ids.owner, "Olga Owner", "owner");
	await seedPerson(ORG, "bob", ids.bob, "Bob Builder");
	await seedPerson(ORG, "mia", ids.mia, "Mia Manager");
	await seedPerson(OTHER, "ada", ids.adaOther, "Ada Lovelace");

	// ---- Position stamps ----
	await admin.query(
		`insert into position_notice (id, organization_id, version, purpose_statement, retention_days, template_revision, created_at) values
		 ($1, $4, 1, 'Proof of on-site work', 90, 1, '2026-01-01T00:00:00Z'),
		 ($2, $4, 2, 'Proof of on-site work at customers', 60, 1, '2026-05-01T00:00:00Z'),
		 ($3, $5, 1, 'Other purpose t1170', 30, 1, '2026-01-01T00:00:00Z')`,
		[ids.notice1, ids.notice2, ids.noticeOther, ORG, OTHER],
	);
	await admin.query(
		`insert into position_notice_decline (organization_id, employee_id, notice_id, declined_at)
		 values ($1, $2, $3, '2026-01-05T08:00:00Z')`,
		[ORG, ids.ada, ids.notice1],
	);
	await admin.query(
		`insert into position_consent (id, organization_id, employee_id, notice_id, granted_at, withdrawn_at) values
		 ($1, $5, $6, $8, '2026-02-01T08:00:00Z', '2026-03-01T08:00:00Z'),
		 ($2, $5, $6, $9, '2026-05-02T08:00:00Z', null),
		 ($3, $5, $7, $9, '2026-05-02T09:00:00Z', null),
		 ($4, $10, $11, $12, '2026-05-02T08:00:00Z', null)`,
		[
			ids.consentOld,
			ids.consentNow,
			ids.consentBob,
			ids.consentOther,
			ORG,
			ids.ada,
			ids.bob,
			ids.notice1,
			ids.notice2,
			OTHER,
			ids.adaOther,
			ids.noticeOther,
		],
	);
	const entries: Array<[string, string, string, string, string]> = [
		[ids.adaIn, ids.ada, ORG, "clock_in", "2026-09-20T06:00:00Z"],
		[ids.adaOut, ids.ada, ORG, "clock_out", "2026-09-20T14:00:00Z"],
		[ids.bobIn, ids.bob, ORG, "clock_in", "2026-09-20T07:00:00Z"],
		[ids.otherIn, ids.adaOther, OTHER, "clock_in", "2026-09-21T07:00:00Z"],
	];
	for (const [id, employeeId, organizationId, type, timestamp] of entries) {
		await admin.query(
			`insert into time_entry (id, employee_id, organization_id, type, timestamp, utc_offset_minutes,
				timezone_source, hash, created_by, created_at)
			 values ($1, $2, $3, $4, $5, 120, 'test', md5(random()::text), 't1170-ada', $5)`,
			[id, employeeId, organizationId, type, new Date(timestamp)],
		);
	}
	await withCanonicalRecords(admin, (client) =>
		client.query(
			`insert into work_period (id, employee_id, organization_id, clock_in_id, clock_out_id, start_time, end_time,
				duration_minutes, is_active, updated_at) values
			 ($1, $3, $5, $6, $7, '2026-09-20T06:00:00Z', '2026-09-20T14:00:00Z', 480, false, now()),
			 ($2, $4, $5, $8, null, '2026-09-20T07:00:00Z', null, null, true, now())`,
			[ids.adaPeriod, ids.bobPeriod, ids.ada, ids.bob, ORG, ids.adaIn, ids.adaOut, ids.bobIn],
		),
	);
	const stamp = `insert into position_stamp (organization_id, employee_id, time_entry_id, consent_id,
		latitude, longitude, accuracy_meters, fixed_at, captured_at, purge_at, created_at)
		values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $9)`;
	await admin.query(stamp, [
		ORG,
		ids.ada,
		ids.adaIn,
		ids.consentNow,
		52.520008,
		13.404954,
		18.5,
		new Date("2026-09-20T05:59:58Z"),
		new Date("2026-09-20T06:00:00Z"),
		new Date("2026-11-19T06:00:00Z"),
	]);
	await admin.query(stamp, [
		ORG,
		ids.bob,
		ids.bobIn,
		ids.consentBob,
		48.111111,
		11.222222,
		7,
		new Date("2026-09-20T06:59:59Z"),
		new Date("2026-09-20T07:00:00Z"),
		new Date("2026-11-19T07:00:00Z"),
	]);
	await admin.query(stamp, [
		OTHER,
		ids.adaOther,
		ids.otherIn,
		ids.consentOther,
		40.333333,
		-3.444444,
		9,
		new Date("2026-09-21T06:59:59Z"),
		new Date("2026-09-21T07:00:00Z"),
		new Date("2026-10-21T07:00:00Z"),
	]);
	// One access-log row covers Ada and Bob: Mia opened both work periods.
	await admin.query(
		`insert into position_stamp_access_log (id, organization_id, viewer_user_id, kind, work_period_ids, export_id, accessed_at) values
		 ($1, $5, 't1170-mia', 'work_period_detail', array[$7::uuid, $8::uuid], null, '2026-09-22T10:00:00Z'),
		 ($2, $5, 't1170-owner', 'data_export', '{}', 'org-export-t1170', '2026-09-23T10:00:00Z'),
		 ($3, $5, 't1170-mia', 'work_period_detail', array[$8::uuid], null, '2026-09-24T10:00:00Z'),
		 ($4, $6, 't1170-ada', 'data_export', '{}', 'other-export-t1170', '2026-09-25T10:00:00Z')`,
		[
			ids.logDetail,
			ids.logExport,
			ids.logBobOnly,
			ids.logOther,
			ORG,
			OTHER,
			ids.adaPeriod,
			ids.bobPeriod,
		],
	);
	await admin.query(
		`insert into position_stamp_access_log_subject (access_log_id, organization_id, employee_id) values
		 ($1, $5, $7), ($1, $5, $8), ($2, $5, $7), ($2, $5, $8), ($3, $5, $8), ($4, $6, $9)`,
		[
			ids.logDetail,
			ids.logExport,
			ids.logBobOnly,
			ids.logOther,
			ORG,
			OTHER,
			ids.ada,
			ids.bob,
			ids.adaOther,
		],
	);

	// ---- Notifications ----
	await admin.query(
		`insert into notification (id, user_id, organization_id, type, title, message, entity_type, entity_id, action_url,
			is_read, read_at, metadata, idempotency_key, created_at) values
		 ($1, 't1170-ada', $2, 'approval_request_submitted', 'Bob Builder requested vacation',
			'Bob Builder asked for 3 days off.', 'absence_entry', $1, '/approvals', true, '2026-09-02T09:00:00Z',
			'{"requester":"Bob Builder"}', 'idem-secret-t1170', '2026-09-01T09:00:00Z'),
		 (gen_random_uuid(), 't1170-ada', $3, 'approval_request_submitted', 'Other org notice t1170', 'm', null, null,
			null, false, null, null, null, '2026-09-01T09:00:00Z'),
		 (gen_random_uuid(), 't1170-bob', $2, 'approval_request_submitted', 'Bobs own notice t1170', 'm', null, null,
			null, false, null, null, null, '2026-09-01T09:00:00Z')`,
		[ids.notification, ORG, OTHER],
	);
	await admin.query(
		`insert into daily_digest_delivery (organization_id, recipient_user_id, platform, type, recipient_local_date, status, last_error)
		 values ($1, 't1170-ada', 'telegram', 'digest', '2026-09-01', 'failed', 'digest-error-t1170')`,
		[ORG],
	);

	// ---- Integrations ----
	await admin.query(
		`insert into calendar_connection (employee_id, organization_id, provider, provider_account_id, access_token,
			refresh_token, expires_at, scope, calendar_id, is_active, push_enabled, conflict_detection_enabled, last_sync_at,
			last_sync_error, consecutive_failures, created_at, updated_at) values
		 ($1, $2, 'google', 'ada@gmail.example', 'vault:managed', 'refresh-secret-t1170', '2026-10-01T00:00:00Z',
			'scope-secret-t1170', 'primary', true, true, false, '2026-09-30T08:00:00Z', 'sync-error-t1170', 2,
			'2026-08-01T08:00:00Z', '2026-09-30T08:00:00Z'),
		 ($3, $4, 'google', 'other-account-t1170', 'vault:managed', null, null, null, 'primary', true, true, true, null,
			null, 0, now(), now())`,
		[ids.ada, ORG, ids.adaOther, OTHER],
	);
	await admin.query(
		"insert into team (id, organization_id, name, updated_at) values ($1, $2, 'Crew', now())",
		[ids.team, ORG],
	);
	await admin.query(
		`insert into ics_feed (organization_id, feed_type, employee_id, team_id, secret_digest, secret_hash_version,
			include_approved, include_pending, revoked_at, last_used_at, created_by, created_at, updated_at) values
		 ($1, 'user', $2, null, 'digest-secret-t1170-a', 'v1', true, false, null, '2026-09-29T08:00:00Z', 't1170-ada',
			'2026-08-02T08:00:00Z', now()),
		 ($1, 'user', $2, null, 'digest-secret-t1170-b', 'v1', true, true, '2026-08-02T07:00:00Z', null, 't1170-ada',
			'2026-07-01T08:00:00Z', now()),
		 ($1, 'team', null, $3, 'digest-secret-t1170-team', 'v1', true, true, null, null, 't1170-owner', now(), now()),
		 ($4, 'user', $5, null, 'digest-secret-t1170-other', 'v1', true, true, null, null, 't1170-ada', now(), now())`,
		[ORG, ids.ada, ids.team, OTHER, ids.adaOther],
	);
	await admin.query(
		`insert into slack_user_mapping (user_id, organization_id, slack_user_id, slack_team_id, slack_username,
			slack_display_name, is_active, created_at, updated_at, last_seen_at) values
		 ('t1170-ada', $1, 'U-ADA', 'T-ACME', 'ada', 'Ada L.', true, '2026-08-03T08:00:00Z', now(), '2026-09-28T08:00:00Z'),
		 ('t1170-ada', $2, 'U-ADA-OTHER-t1170', 'T-OTHER', 'ada', 'Ada', true, now(), now(), null)`,
		[ORG, OTHER],
	);
	await admin.query(
		`insert into slack_link_code (user_id, organization_id, code, expires_at, status)
		 values ('t1170-ada', $1, 'LINKCODE-t1170', now(), 'used')`,
		[ORG],
	);
	await admin.query(
		`insert into teams_user_mapping (user_id, organization_id, teams_user_id, teams_email, teams_tenant_id,
			teams_display_name, teams_user_principal_name, is_active, created_at, updated_at, last_seen_at)
		 values ('t1170-ada', $1, 'aad-ada', 'ada@acme.example', 'tenant-acme', 'Ada Lovelace', 'ada@acme.example', false,
			'2026-08-04T08:00:00Z', now(), null)`,
		[ORG],
	);
	await admin.query(
		`insert into telegram_user_mapping (user_id, organization_id, telegram_user_id, telegram_username,
			telegram_display_name, is_active, created_at, updated_at, last_seen_at)
		 values ('t1170-ada', $1, '424242', 'ada_tg', 'Ada', true, '2026-08-05T08:00:00Z', now(), null)`,
		[ORG],
	);
	await admin.query(
		`insert into telegram_conversation (organization_id, user_id, chat_id, chat_type, created_at, updated_at)
		 values ($1, 't1170-ada', 'chat-secret-t1170', 'private', now(), now())`,
		[ORG],
	);
	await admin.query(
		`insert into discord_user_mapping (user_id, organization_id, discord_user_id, discord_username,
			discord_display_name, is_active, created_at, updated_at, last_seen_at)
		 values ('t1170-ada', $1, '99887766', 'ada_dc', 'Ada', true, '2026-08-06T08:00:00Z', now(), null)`,
		[ORG],
	);
	await admin.query(
		`insert into employee_kiosk_pin (organization_id, employee_id, pin_hash, set_by_user_id,
			created_at, updated_at) values
		 ($1, $2, 'pin-hash-secret-t1170', 't1170-owner', '2026-08-07T08:00:00Z', '2026-08-08T08:00:00Z'),
		 ($3, $4, 'pin-hash-secret-t1170-other', 't1170-ada', now(), now())`,
		[ORG, ids.ada, OTHER, ids.adaOther],
	);
	await admin.query(
		`insert into employee_kiosk_pin_event (organization_id, employee_id, kind, offline, occurred_at) values
		 ($1, $2, 'failure', false, '2026-08-09T07:58:00Z'),
		 ($1, $2, 'success', true, '2026-08-09T07:59:00Z'),
		 ($1, $2, 'cleared', false, '2026-08-08T08:00:00Z'),
		 ($3, $4, 'failure', false, '2026-08-09T07:00:00Z')`,
		[ORG, ids.ada, OTHER, ids.adaOther],
	);
	// Refused offline kiosk clockings (#1290): Ada's own, and Bob's on the same kiosk.
	await admin.query(
		`insert into location (id, organization_id, name, created_by, updated_at)
		 values ($1, $2, 'Store', 't1170-owner', now())`,
		[ids.store, ORG],
	);
	await admin.query(
		`insert into kiosk (id, organization_id, location_id, name, timezone, updated_at)
		 values ($1, $2, $3, 'Front door', 'Europe/Berlin', now())`,
		[ids.kiosk, ORG, ids.store],
	);
	await admin.query(
		`insert into kiosk_frozen_refusal (organization_id, kiosk_id, operation_id, employee_id, action,
			claimed_at, timezone, time_source, reason, command, refused_at) values
		 ($1, $2, gen_random_uuid(), $3, 'clock_in', '2026-08-09T06:00:00Z', 'Europe/Berlin', 'device_clock',
		  'wrong_pin', '{"note":"never-t1170"}', '2026-08-09T09:00:00Z'),
		 ($1, $2, gen_random_uuid(), $4, 'clock_out', '2026-08-09T16:00:00Z', 'Europe/Berlin', 'server_anchor',
		  'kiosk_rotated', '{}', '2026-08-10T09:00:00Z')`,
		[ORG, ids.kiosk, ids.ada, ids.bob],
	);

	// Kiosk fobs (#1509): Ada's replaced and current ones, Bob's, and Ada's in the other organization.
	await admin.query(
		`insert into employee_employment_period (id, organization_id, employee_id, status, started_at, start_provenance)
		 values ($1, $4, $5, 'open', '2026-01-01T00:00:00Z', 'recorded'), ($2, $4, $6, 'open', '2026-01-01T00:00:00Z', 'recorded'),
		  ($3, $7, $8, 'open', '2026-01-01T00:00:00Z', 'recorded')`,
		[
			ids.adaEmployment,
			ids.bobEmployment,
			ids.adaOtherEmployment,
			ORG,
			ids.ada,
			ids.bob,
			OTHER,
			ids.adaOther,
		],
	);
	await admin.query(
		`insert into employee_kiosk_fob (id, organization_id, employee_id, employment_period_id, serial_number,
			registered_at, registered_kiosk_id, ended_at, ended_by_user_id, ended_reason) values
		 ($1, $3, $4, $5, '04A1B2C3D4E5F6', '2026-08-10T08:00:00Z', $6, '2026-08-20T08:00:00Z', 't1170-ada', 'replaced'),
		 ($2, $3, $4, $5, '1A2B3C4D', '2026-08-20T08:00:00Z', null, null, null, null),
		 (gen_random_uuid(), $3, $7, $8, 'B0B0CAFE', '2026-08-11T08:00:00Z', $6, null, null, null),
		 (gen_random_uuid(), $9, $10, $11, '0FF0C0DE', '2026-08-12T08:00:00Z', null, null, null, null)`,
		[
			ids.adaOldFob,
			ids.adaFob,
			ORG,
			ids.ada,
			ids.adaEmployment,
			ids.kiosk,
			ids.bob,
			ids.bobEmployment,
			OTHER,
			ids.adaOther,
			ids.adaOtherEmployment,
		],
	);
	// Their audit rows: Ada's registration, a manager's removal, and an ending at a
	// colleague's registration of the card, whose actor the employee export never names.
	await admin.query(
		`insert into audit_log (organization_id, entity_type, entity_id, action, performed_by, employee_id, metadata,
			timestamp) values
		 ($1, 'kiosk_fob', $2, 'kiosk_fob.registered', 't1170-ada', $4::uuid, $5, '2026-08-10T08:00:00Z'),
		 ($1, 'kiosk_fob', $3, 'kiosk_fob.ended', 't1170-owner', $4::uuid, '{"reason":"removed"}',
		  '2026-08-21T08:00:00Z'),
		 ($1, 'kiosk_fob', $3, 'kiosk_fob.ended', 't1170-bob', $4::uuid,
		  '{"reason":"departure","endedAtRegistrationOnKioskId":"kiosk-t1170"}', '2026-08-22T08:00:00Z')`,
		[ORG, ids.adaOldFob, ids.adaFob, ids.ada, JSON.stringify({ kioskId: ids.kiosk })],
	);
}

/** Queues and builds one export, then returns the ZIP's text files. */
async function buildExport(
	employeeId: string,
	kind: "employee" | "admin",
	requestedBy: string,
): Promise<{ exportId: string; files: Record<string, string> }> {
	const { rows } = await admin.query<{ id: string }>(
		`insert into personal_data_export (organization_id, employee_id, kind, requested_by_user_id, status, expires_at)
		 values ($1, $2, $3, $4, 'pending', now() + interval '7 days') returning id`,
		[ORG, employeeId, kind, requestedBy],
	);
	const exportId = rows[0]?.id as string;
	const outcome = await processPersonalDataExport(
		db,
		{ organizationId: ORG, exportId },
		{
			upload: async (_organizationId, key, body) => {
				uploads.set(key, new Uint8Array(await new Response(body).arrayBuffer()));
				return { bucket: "t1170", versionId: null };
			},
			deleteObject: async () => undefined,
			notify: async () => undefined,
		},
	);
	expect(outcome).toEqual({ status: "completed" });
	const [stored] = (
		await admin.query<{ storage_key: string }>(
			"select storage_key from personal_data_export where id = $1",
			[exportId],
		)
	).rows;
	const zip = await JSZip.loadAsync(uploads.get(stored?.storage_key ?? "") as Uint8Array);
	const files: Record<string, string> = {};
	for (const entry of Object.values(zip.files)) {
		if (!entry.dir) files[entry.name] = await entry.async("string");
	}
	return { exportId, files };
}

function categoryOf(files: Record<string, string>, category: string) {
	const json = files[`${category}.json`];
	expect(json, `${category}.json`).toBeDefined();
	const { _metadata, ...parts } = JSON.parse(json as string);
	return parts;
}

function categoryText(files: Record<string, string>, category: string): string {
	return Object.entries(files)
		.filter(([path]) => path === `${category}.json` || path.startsWith(`${category}/`))
		.map(([, text]) => text)
		.join("\n");
}

/** The access-log rows naming one personal data export (the log is append-only). */
async function accessLogRowsOf(exportId: string) {
	const { rows } = await admin.query<{
		kind: string;
		viewer_user_id: string | null;
		subjects: string[];
	}>(
		`select l.kind, l.viewer_user_id,
			array(select s.employee_id::text from position_stamp_access_log_subject s where s.access_log_id = l.id order by 1) as subjects
		 from position_stamp_access_log l
		 where l.organization_id = $1 and l.export_id = $2`,
		[ORG, exportId],
	);
	return rows;
}

describe("personal data export: position stamps, notifications and integrations (#1170)", () => {
	beforeAll(seed);

	beforeEach(async () => {
		await admin.query("delete from personal_data_export where organization_id = $1", [ORG]);
		uploads.clear();
	});

	afterAll(cleanup);

	it("exports Ada's stamps, consent history and who viewed her positions, nothing of Bob or the other organization", async () => {
		const { exportId, files } = await buildExport(ids.ada, "employee", "t1170-ada");
		const stamps = categoryOf(files, "position_stamps");

		expect(stamps.stamps).toEqual([
			{
				time_entry_id: ids.adaIn,
				clock_event: "clock_in",
				latitude: 52.520008,
				longitude: 13.404954,
				accuracy_meters: 18.5,
				fixed_at: "2026-09-20T05:59:58Z",
				captured_at: "2026-09-20T06:00:00Z",
				utc_offset_minutes: 120,
				purge_at: "2026-11-19T06:00:00Z",
				consent_id: ids.consentNow,
				created_at: "2026-09-20T06:00:00Z",
			},
		]);
		expect(stamps.consents).toEqual([
			{
				consent_id: ids.consentOld,
				notice_version: 1,
				purpose_statement: "Proof of on-site work",
				retention_days: 90,
				granted_at: "2026-02-01T08:00:00Z",
				withdrawn_at: "2026-03-01T08:00:00Z",
			},
			{
				consent_id: ids.consentNow,
				notice_version: 2,
				purpose_statement: "Proof of on-site work at customers",
				retention_days: 60,
				granted_at: "2026-05-02T08:00:00Z",
				withdrawn_at: null,
			},
		]);
		expect(stamps.notice_declines).toEqual([
			{
				notice_version: 1,
				purpose_statement: "Proof of on-site work",
				retention_days: 90,
				declined_at: "2026-01-05T08:00:00Z",
			},
		]);
		// One row per access; Bob's work period and Bob-only accesses are dropped.
		expect(stamps.access_log).toEqual([
			{
				accessed_at: "2026-09-22T10:00:00Z",
				kind: "work_period_detail",
				viewer: "Mia Manager",
				work_period_id: ids.adaPeriod,
				work_period_started_at: "2026-09-20T06:00:00Z",
				work_period_utc_offset_minutes: 120,
				export_id: null,
			},
			{
				accessed_at: "2026-09-23T10:00:00Z",
				kind: "data_export",
				viewer: "Olga Owner",
				work_period_id: null,
				work_period_started_at: null,
				work_period_utc_offset_minutes: null,
				export_id: "org-export-t1170",
			},
		]);
		expect(files["position_stamps/access_log.csv"]?.split("\n")[0]).toBe(
			"accessed_at,kind,viewer,work_period_id,work_period_started_at,work_period_utc_offset_minutes,export_id",
		);

		const text = categoryText(files, "position_stamps");
		for (const leaked of [
			ids.bob,
			ids.bobPeriod,
			ids.bobIn,
			"48.111111",
			"40.333333",
			"Other purpose t1170",
			"other-export-t1170",
			ids.logBobOnly,
		]) {
			expect(text, leaked).not.toContain(leaked);
		}
		// The employee's own export is never logged as an access.
		expect(await accessLogRowsOf(exportId)).toEqual([]);
	});

	it("logs the requesting admin as a viewer when an admin export contains stamps", async () => {
		const { exportId, files } = await buildExport(ids.ada, "admin", "t1170-owner");
		expect(categoryOf(files, "position_stamps").stamps).toHaveLength(1);
		expect(await accessLogRowsOf(exportId)).toEqual([
			{ kind: "data_export", viewer_user_id: "t1170-owner", subjects: [ids.ada] },
		]);

		// The next export shows that access like any other.
		const next = await buildExport(ids.ada, "employee", "t1170-ada");
		expect(categoryOf(next.files, "position_stamps").access_log).toContainEqual(
			expect.objectContaining({ kind: "data_export", viewer: "Olga Owner", export_id: exportId }),
		);

		// A retried build of the same export logs the access once.
		await positionStampsCollector.collect(db, {
			organizationId: ORG,
			employeeId: ids.ada,
			userId: "t1170-ada",
			kind: "admin",
			exportId,
			requestedByUserId: "t1170-owner",
		});
		expect(await accessLogRowsOf(exportId)).toHaveLength(1);

		// An admin export holding no stamps writes no access-log row.
		const mia = await buildExport(ids.mia, "admin", "t1170-owner");
		expect(categoryOf(mia.files, "position_stamps").stamps).toEqual([]);
		expect(await accessLogRowsOf(mia.exportId)).toEqual([]);
	});

	it("exports Ada's received notifications as received, without delivery records or idempotency keys", async () => {
		const { files } = await buildExport(ids.ada, "employee", "t1170-ada");
		expect(categoryOf(files, "notifications")).toEqual({
			notifications: [
				{
					type: "approval_request_submitted",
					title: "Bob Builder requested vacation",
					message: "Bob Builder asked for 3 days off.",
					entity_type: "absence_entry",
					entity_id: ids.notification,
					action_url: "/approvals",
					is_read: true,
					read_at: "2026-09-02T09:00:00Z",
					metadata: '{"requester":"Bob Builder"}',
					created_at: "2026-09-01T09:00:00Z",
				},
			],
		});
		expect(files["notifications/notifications.csv"]).toBeDefined();
		const text = categoryText(files, "notifications");
		for (const leaked of [
			"idem-secret-t1170",
			"Other org notice t1170",
			"Bobs own notice t1170",
			"digest-error-t1170",
		]) {
			expect(text, leaked).not.toContain(leaked);
		}
	});

	it("exports calendar connections, the calendar feed, chat accounts and kiosk PIN status without secrets", async () => {
		const { files } = await buildExport(ids.ada, "employee", "t1170-ada");
		const integrations = categoryOf(files, "integrations");
		expect(integrations.calendar_connections).toEqual([
			{
				provider: "google",
				account: "ada@gmail.example",
				calendar_id: "primary",
				is_active: true,
				push_enabled: true,
				conflict_detection_enabled: false,
				last_sync_at: "2026-09-30T08:00:00Z",
				created_at: "2026-08-01T08:00:00Z",
				updated_at: "2026-09-30T08:00:00Z",
			},
		]);
		expect(integrations.ics_feeds).toEqual([
			{
				is_active: false,
				include_approved: true,
				include_pending: true,
				created_at: "2026-07-01T08:00:00Z",
				last_used_at: null,
				revoked_at: "2026-08-02T07:00:00Z",
			},
			{
				is_active: true,
				include_approved: true,
				include_pending: false,
				created_at: "2026-08-02T08:00:00Z",
				last_used_at: "2026-09-29T08:00:00Z",
				revoked_at: null,
			},
		]);
		expect(integrations.chat_accounts).toEqual([
			{
				platform: "slack",
				account_id: "U-ADA",
				username: "ada",
				display_name: "Ada L.",
				email: null,
				workspace_id: "T-ACME",
				is_active: true,
				linked_at: "2026-08-03T08:00:00Z",
				last_seen_at: "2026-09-28T08:00:00Z",
			},
			{
				platform: "teams",
				account_id: "aad-ada",
				username: "ada@acme.example",
				display_name: "Ada Lovelace",
				email: "ada@acme.example",
				workspace_id: "tenant-acme",
				is_active: false,
				linked_at: "2026-08-04T08:00:00Z",
				last_seen_at: null,
			},
			{
				platform: "telegram",
				account_id: "424242",
				username: "ada_tg",
				display_name: "Ada",
				email: null,
				workspace_id: null,
				is_active: true,
				linked_at: "2026-08-05T08:00:00Z",
				last_seen_at: null,
			},
			{
				platform: "discord",
				account_id: "99887766",
				username: "ada_dc",
				display_name: "Ada",
				email: null,
				workspace_id: null,
				is_active: true,
				linked_at: "2026-08-06T08:00:00Z",
				last_seen_at: null,
			},
		]);
		expect(integrations.kiosk_pin).toEqual({
			pin_set: true,
			set_at: "2026-08-08T08:00:00Z",
			set_by: "Olga Owner",
		});

		const text = categoryText(files, "integrations");
		for (const leaked of [
			"vault:managed",
			"refresh-secret-t1170",
			"scope-secret-t1170",
			"sync-error-t1170",
			"digest-secret-t1170",
			"pin-hash-secret-t1170",
			"LINKCODE-t1170",
			"chat-secret-t1170",
			"other-account-t1170",
			"U-ADA-OTHER-t1170",
		]) {
			expect(text, leaked).not.toContain(leaked);
		}
	});

	it("reports no kiosk PIN for an employee without one", async () => {
		const { files } = await buildExport(ids.mia, "employee", "t1170-mia");
		expect(categoryOf(files, "integrations").kiosk_pin).toEqual({
			pin_set: false,
			set_at: null,
			set_by: null,
		});
	});

	it("exports the kiosk PIN attempts and unlocks the lockout is judged from (#1288)", async () => {
		const { files } = await buildExport(ids.ada, "employee", "t1170-ada");
		expect(categoryOf(files, "integrations").kiosk_pin_events).toEqual([
			{ event: "cleared", occurred_at: "2026-08-08T08:00:00Z", offline: false },
			{ event: "failure", occurred_at: "2026-08-09T07:58:00Z", offline: false },
			{ event: "success", occurred_at: "2026-08-09T07:59:00Z", offline: true },
		]);
	});

	it("exports the employee's refused offline kiosk clockings, without the command (#1290)", async () => {
		const { files } = await buildExport(ids.ada, "employee", "t1170-ada");
		expect(categoryOf(files, "integrations").kiosk_refused_clockings).toEqual([
			{
				kiosk: "Front door",
				action: "clock_in",
				claimed_at: "2026-08-09T06:00:00Z",
				time_source: "device_clock",
				reason: "wrong_pin",
				refused_at: "2026-08-09T09:00:00Z",
			},
		]);
		expect(categoryText(files, "integrations")).not.toContain("never-t1170");
	});

	it("exports Ada's kiosk fobs, current and ended, nothing of Bob or the other organization (#1509)", async () => {
		const { files } = await buildExport(ids.ada, "employee", "t1170-ada");
		expect(categoryOf(files, "integrations").kiosk_fobs).toEqual([
			{
				serial_number: "04A1B2C3D4E5F6",
				registered_at: "2026-08-10T08:00:00Z",
				kiosk: "Front door",
				ended_at: "2026-08-20T08:00:00Z",
				ended_reason: "replaced",
			},
			{
				serial_number: "1A2B3C4D",
				registered_at: "2026-08-20T08:00:00Z",
				kiosk: null,
				ended_at: null,
				ended_reason: null,
			},
		]);
		expect(files["integrations/kiosk_fobs.csv"]?.split("\n")[0]).toBe(
			"serial_number,registered_at,kiosk,ended_at,ended_reason",
		);
		const text = categoryText(files, "integrations");
		for (const leaked of ["B0B0CAFE", "0FF0C0DE"]) {
			expect(text, leaked).not.toContain(leaked);
		}
	});

	it("shows Ada her kiosk fob audit entries, but not which colleague took over her card (#1509)", async () => {
		const fobAudits = (files: Record<string, string>) =>
			(categoryOf(files, "audit_log").entries as Array<Record<string, unknown>>)
				.filter((entry) => entry.entity_type === "kiosk_fob")
				.map((entry) => [entry.action, entry.performed_by]);

		const own = await buildExport(ids.ada, "employee", "t1170-ada");
		expect(fobAudits(own.files)).toEqual([
			["kiosk_fob.registered", "Ada Lovelace"],
			["kiosk_fob.ended", "Olga Owner"],
		]);
		expect(categoryText(own.files, "audit_log")).not.toContain("Bob Builder");

		await admin.query("delete from personal_data_export where organization_id = $1", [ORG]);
		const byAdmin = await buildExport(ids.ada, "admin", "t1170-owner");
		expect(fobAudits(byAdmin.files)).toEqual([
			["kiosk_fob.registered", "Ada Lovelace"],
			["kiosk_fob.ended", "Olga Owner"],
			["kiosk_fob.ended", "Bob Builder"],
		]);
	});

	it("holds the same rows in both kinds of export", async () => {
		const own = await buildExport(ids.ada, "employee", "t1170-ada");
		await admin.query("delete from personal_data_export where organization_id = $1", [ORG]);
		const byAdmin = await buildExport(ids.ada, "admin", "t1170-owner");
		for (const category of ["position_stamps", "notifications", "integrations"]) {
			expect(categoryOf(byAdmin.files, category), category).toEqual(
				categoryOf(own.files, category),
			);
		}
	});

	// Last: the log is append-only, so these rows stay until the organization goes.
	it("reads the whole access log, not a capped page of it", async () => {
		const before = categoryOf(
			(await buildExport(ids.ada, "employee", "t1170-ada")).files,
			"position_stamps",
		).access_log.length;
		await admin.query("delete from personal_data_export where organization_id = $1", [ORG]);
		await admin.query(
			`with rows as (
				insert into position_stamp_access_log (organization_id, viewer_user_id, kind, work_period_ids, accessed_at)
				select $1, 't1170-mia', 'work_period_detail', array[$2::uuid], timestamp '2026-01-01' + n * interval '1 minute'
				from generate_series(1, 230) as n returning id)
			 insert into position_stamp_access_log_subject (access_log_id, organization_id, employee_id)
			 select id, $1, $3 from rows`,
			[ORG, ids.adaPeriod, ids.ada],
		);
		const { files } = await buildExport(ids.ada, "employee", "t1170-ada");
		expect(categoryOf(files, "position_stamps").access_log).toHaveLength(before + 230);
	});
});
