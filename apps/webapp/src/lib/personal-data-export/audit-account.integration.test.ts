/**
 * #1171: the Audit log and Account categories of a personal data export
 * against a disposable PostgreSQL database. Exports are built by the worker
 * processor from seeded rows; object storage and notifications are replaced.
 * Ada works in two organizations and acted on her colleague Bob; only the
 * exported organization's audit rows may appear, other people only by opaque
 * id, and no secret of her login anywhere in the archive.
 */

import JSZip from "jszip";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { integrationAdminPool } from "@/test/integration-database";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

vi.mock("@/lib/storage/export-s3-client", () => ({
	uploadPrivateObjectStream: async () => ({ bucket: "unused", versionId: null }),
	deletePrivateObject: async () => undefined,
	deletePrivateObjectVersions: async () => undefined,
}));

const { db } = await import("@/db");
const { processPersonalDataExport } = await import("./processor");

const ORG = "t1171-org";
const OTHER = "t1171-other";

const ids = {
	ada: "11710000-0000-4000-8000-000000000001",
	owner: "11710000-0000-4000-8000-000000000002",
	bob: "11710000-0000-4000-8000-000000000003",
	adaOther: "11710000-0000-4000-8000-000000000004",
	adaAbsence: "11710000-0000-4000-8000-0000000000a1",
	bobAbsence: "11710000-0000-4000-8000-0000000000a2",
	bobEntry: "11710000-0000-4000-8000-0000000000a3",
	project: "11710000-0000-4000-8000-0000000000a4",
	sharedDocument: "11710000-0000-4000-8000-0000000000a5",
	hrOnlyDocument: "11710000-0000-4000-8000-0000000000a6",
	rate: "11710000-0000-4000-8000-0000000000a7",
	visibleField: "11710000-0000-4000-8000-0000000000b1",
	managerField: "11710000-0000-4000-8000-0000000000b2",
	sessionOrg: "t1171-session-org",
	sessionOther: "t1171-session-other",
} as const;

/** Every secret seeded for Ada's login; none may appear anywhere in an export. */
const SECRETS = [
	"pw-hash-secret-t1171",
	"access-token-secret-t1171",
	"refresh-token-secret-t1171",
	"id-token-secret-t1171",
	"session-token-secret-t1171",
	"session-token-secret-other-t1171",
	"totp-secret-t1171",
	"backup-codes-secret-t1171",
	"passkey-public-key-secret-t1171",
	"passkey-credential-secret-t1171",
	"push-endpoint-secret-t1171",
	"p256dh-secret-t1171",
	"push-auth-secret-t1171",
	"native-push-token-secret-t1171",
	"device-fingerprint-secret-t1171",
	"session-fingerprint-secret-t1171",
	"violation-fingerprint-secret-t1171",
	"invite-code-secret-t1171",
	"scim-external-secret-t1171",
];

const admin = integrationAdminPool();
const uploads = new Map<string, Uint8Array>();

async function cleanup() {
	await admin.query("delete from audit_log where organization_id = any($1::text[])", [
		[ORG, OTHER],
	]);
	await admin.query("delete from vacation_adjustment where employee_id = any($1::uuid[])", [
		[ids.ada, ids.bob, ids.owner, ids.adaOther],
	]);
	await admin.query("delete from organization where id = any($1::text[])", [[ORG, OTHER]]);
	await admin.query(
		"delete from personal_data_export_file_cleanup where organization_id = any($1::text[])",
		[[ORG, OTHER]],
	);
	await admin.query('delete from "user" where id like $1', ["t1171-%"]);
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
		[`t1171-${name}`, displayName, `t1171-${name}@example.test`],
	);
	await admin.query(
		"insert into member (id, organization_id, user_id, role, status, created_at) values ($1, $2, $3, $4, 'approved', now())",
		[`t1171-member-${organizationId}-${name}`, organizationId, `t1171-${name}`, role],
	);
	await admin.query(
		`insert into employee (id, user_id, organization_id, role, is_active, updated_at)
		 values ($1, $2, $3, $4, true, now())`,
		[employeeId, `t1171-${name}`, organizationId, role === "member" ? "employee" : "admin"],
	);
}

async function audit(row: {
	organizationId?: string;
	entityType: string;
	entityId: string;
	action: string;
	performedBy: string;
	employeeId?: string | null;
	changes?: unknown;
	metadata?: unknown;
	ipAddress?: string | null;
	userAgent?: string | null;
	timestamp: string;
}) {
	await admin.query(
		`insert into audit_log (organization_id, entity_type, entity_id, action, performed_by, employee_id, changes,
			metadata, ip_address, user_agent, timestamp) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
		[
			row.organizationId ?? ORG,
			row.entityType,
			row.entityId,
			row.action,
			row.performedBy,
			row.employeeId ?? null,
			row.changes === undefined ? null : JSON.stringify(row.changes),
			row.metadata === undefined ? null : JSON.stringify(row.metadata),
			row.ipAddress ?? null,
			row.userAgent ?? null,
			new Date(row.timestamp),
		],
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
	await seedPerson(OTHER, "ada", ids.adaOther, "Ada Lovelace");

	await admin.query(
		`insert into time_entry (id, employee_id, organization_id, type, timestamp, utc_offset_minutes,
			timezone_source, hash, created_by, created_at)
		 values ($1, $2, $3, 'clock_in', '2026-09-03T07:00:00Z', 120, 'test', md5(random()::text), 't1171-ada',
			'2026-09-03T07:00:00Z')`,
		[ids.bobEntry, ids.bob, ORG],
	);
	await admin.query(
		`insert into custom_field_definition (id, organization_id, entity, name, type, visibility, edit_level, position) values
		 ($1, $3, 'employee', 'Shirt size', 'text', 'employee', 'manager', 0),
		 ($2, $3, 'employee', 'Flight risk t1171', 'text', 'manager', 'manager', 1)`,
		[ids.visibleField, ids.managerField, ORG],
	);

	// ---- Audit log ----
	// About Ada, by the owner: no owner IP, user agent or email in the export.
	await audit({
		entityType: "employee",
		entityId: ids.ada,
		action: "manager.assigned",
		performedBy: "t1171-owner",
		metadata: { actorEmail: "owner-email-t1171@example.test", managerName: "Olga Owner" },
		ipAddress: "203.0.113.77",
		userAgent: "OwnerAgent/7.7 t1171",
		timestamp: "2026-09-01T08:00:00Z",
	});
	// About Ada, by Ada herself: her own IP and user agent stay.
	await audit({
		entityType: "absence_entry",
		entityId: ids.adaAbsence,
		action: "absence.requested",
		performedBy: "t1171-ada",
		employeeId: ids.ada,
		changes: {
			startDate: "2026-09-10",
			endDate: "2026-09-11",
			attachment: { bucket: "bucket-secret-t1171", key: "object-key-secret-t1171" },
		},
		metadata: { actorEmail: "t1171-ada@example.test" },
		ipAddress: "198.51.100.10",
		userAgent: "AdaAgent/1.0",
		timestamp: "2026-09-02T08:00:00Z",
	});
	// Ada approved Bob's absence: only an opaque id for Bob.
	await audit({
		entityType: "absence_entry",
		entityId: ids.bobAbsence,
		action: "absence.approved",
		performedBy: "t1171-ada",
		employeeId: ids.bob,
		changes: { reason: "Bob private reason t1171" },
		metadata: { employeeName: "Bob Builder" },
		ipAddress: "198.51.100.10",
		userAgent: "AdaAgent/1.0",
		timestamp: "2026-09-03T08:00:00Z",
	});
	// Ada named a manager for Bob (Bob as the audit's employee entity).
	await audit({
		entityType: "employee",
		entityId: ids.bob,
		action: "manager.assigned",
		performedBy: "t1171-ada",
		metadata: { employeeName: "Bob Builder", managerName: "Ada Lovelace" },
		timestamp: "2026-09-04T08:00:00Z",
	});
	// An approval chain event: employee_id holds the actor (Ada), the record is Bob's.
	await audit({
		entityType: "time_entry",
		entityId: ids.bobEntry,
		action: "approval_chain.stage_approved",
		performedBy: "t1171-ada",
		employeeId: ids.ada,
		metadata: { eventName: "approval_chain.stage_approved", reason: "Bob chain note t1171" },
		timestamp: "2026-09-05T08:00:00Z",
	});
	// An organization-level action by Ada: no person, no details.
	await audit({
		entityType: "project",
		entityId: ids.project,
		action: "project.created",
		performedBy: "t1171-ada",
		metadata: { projectName: "Ada project t1171" },
		timestamp: "2026-09-06T08:00:00Z",
	});
	// A shared personnel file document viewed by the owner: in both exports.
	await audit({
		entityType: "employee_document",
		entityId: ids.sharedDocument,
		action: "personnel_file.document_viewed",
		performedBy: "t1171-owner",
		employeeId: ids.ada,
		metadata: {
			document: { category: "contract", title: "Shared contract t1171", visibility: "shared" },
		},
		timestamp: "2026-09-07T08:00:00Z",
	});
	// Withheld data: admin export only.
	await audit({
		entityType: "employee_document",
		entityId: ids.hrOnlyDocument,
		action: "personnel_file.document_uploaded",
		performedBy: "t1171-owner",
		employeeId: ids.ada,
		metadata: {
			document: { category: "other", title: "HR only note t1171", visibility: "hr_only" },
		},
		timestamp: "2026-09-08T08:00:00Z",
	});
	await audit({
		entityType: "billable_rate",
		entityId: ids.rate,
		action: "billable_time.rate_set",
		performedBy: "t1171-owner",
		employeeId: ids.ada,
		changes: { hourlyRate: "987.65" },
		timestamp: "2026-09-09T08:00:00Z",
	});
	await audit({
		entityType: "employee",
		entityId: ids.ada,
		action: "custom_field_value.changed",
		performedBy: "t1171-owner",
		changes: { before: "low", after: "Flight risk value t1171" },
		metadata: { fieldId: ids.managerField, fieldName: "Flight risk t1171" },
		timestamp: "2026-09-10T08:00:00Z",
	});
	await audit({
		entityType: "employee",
		entityId: ids.ada,
		action: "custom_field_value.set",
		performedBy: "t1171-owner",
		changes: { before: null, after: "M" },
		metadata: { fieldId: ids.visibleField, fieldName: "Shirt size" },
		timestamp: "2026-09-11T08:00:00Z",
	});
	await audit({
		entityType: "employee_departure_review",
		entityId: ids.ada,
		action: "employee_departure.review_completed",
		performedBy: "t1171-owner",
		employeeId: ids.ada,
		metadata: { note: "Departure review note t1171" },
		timestamp: "2026-09-12T08:00:00Z",
	});
	// Not Ada's: another organization, and Bob's own row.
	await audit({
		organizationId: OTHER,
		entityType: "absence_entry",
		entityId: ids.adaAbsence,
		action: "absence.requested",
		performedBy: "t1171-ada",
		employeeId: ids.adaOther,
		metadata: { note: "Other org audit t1171" },
		timestamp: "2026-09-02T09:00:00Z",
	});
	await audit({
		entityType: "absence_entry",
		entityId: ids.bobAbsence,
		action: "absence.requested",
		performedBy: "t1171-bob",
		employeeId: ids.bob,
		metadata: { note: "Bob own audit t1171" },
		timestamp: "2026-09-02T10:00:00Z",
	});

	// ---- Actions on colleagues without an audit row ----
	await admin.query(
		`insert into work_policy_violation (employee_id, organization_id, violation_date, violation_type,
			acknowledged_by, acknowledged_at, acknowledged_note, created_at)
		 values ($1, $2, '2026-09-03T00:00:00Z', 'max_daily', $3, '2026-09-13T08:00:00Z', 'Bob violation note t1171', now())`,
		[ids.bob, ORG, ids.ada],
	);
	await admin.query(
		`insert into vacation_adjustment (employee_id, year, days, reason, kind, adjusted_by, created_at)
		 values ($1, 2026, 2.5, 'Bob adjustment reason t1171', 'manual', $2, '2026-09-14T08:00:00Z'),
		        ($3, 2026, 1, 'Other org adjustment t1171', 'manual', $3, '2026-09-14T08:00:00Z')`,
		[ids.bob, ids.ada, ids.adaOther],
	);

	// ---- Account ----
	await admin.query(
		`update "user" set email_verified = true, image = 'https://cdn.example/avatars/ada.webp',
			created_at = '2026-01-01T08:00:00Z', updated_at = '2026-02-01T08:00:00Z', role = 'user', banned = false,
			two_factor_enabled = true, first_name = 'Ada', last_name = 'Lovelace', can_create_organizations = true,
			pending_invite_code = 'invite-code-secret-t1171'
		 where id = 't1171-ada'`,
	);
	await admin.query(
		`insert into account (id, account_id, provider_id, user_id, access_token, refresh_token, id_token,
			access_token_expires_at, scope, password, created_at, updated_at) values
		 ('t1171-acc-pw', 't1171-ada', 'credential', 't1171-ada', null, null, null, null, null,
			'pw-hash-secret-t1171', '2026-01-01T08:00:00Z', '2026-01-01T08:00:00Z'),
		 ('t1171-acc-g', 'google-sub-t1171', 'google', 't1171-ada', 'access-token-secret-t1171',
			'refresh-token-secret-t1171', 'id-token-secret-t1171', '2026-10-01T00:00:00Z', 'openid email',
			null, '2026-01-02T08:00:00Z', '2026-03-01T08:00:00Z')`,
	);
	await admin.query(
		`insert into session (id, expires_at, token, created_at, updated_at, ip_address, user_agent, user_id,
			impersonated_by, active_organization_id) values
		 ($1, '2026-10-20T08:00:00Z', 'session-token-secret-t1171', '2026-09-20T08:00:00Z', '2026-09-21T08:00:00Z',
			'198.51.100.20', 'Firefox t1171', 't1171-ada', null, $3),
		 ($2, '2026-10-21T08:00:00Z', 'session-token-secret-other-t1171', '2026-09-22T08:00:00Z',
			'2026-09-22T09:00:00Z', '198.51.100.21', 'Safari t1171', 't1171-ada', 't1171-owner', $4)`,
		[ids.sessionOrg, ids.sessionOther, ORG, OTHER],
	);
	await admin.query(
		`insert into session_extension (session_id, organization_id, device_fingerprint, country, region, city,
			mfa_verified_at, mfa_method, last_activity_at, request_count, created_at) values
		 ($1, $3, 'session-fingerprint-secret-t1171', 'DE', 'BE', 'Berlin', '2026-09-20T08:01:00Z', 'totp',
			'2026-09-21T08:00:00Z', 12, '2026-09-20T08:00:00Z'),
		 ($2, $4, 'session-fingerprint-secret-t1171', 'ES', 'MD', 'Madrid t1171', null, null,
			'2026-09-22T09:00:00Z', 3, '2026-09-22T08:00:00Z')`,
		[ids.sessionOrg, ids.sessionOther, ORG, OTHER],
	);
	await admin.query(
		`insert into passkey (id, name, public_key, user_id, credential_id, counter, device_type, backed_up,
			transports, created_at, aaguid)
		 values ('t1171-passkey', 'YubiKey t1171', 'passkey-public-key-secret-t1171', 't1171-ada',
			'passkey-credential-secret-t1171', 4, 'singleDevice', false, 'usb', '2026-02-02T08:00:00Z', 'aaguid-t1171')`,
	);
	await admin.query(
		`insert into two_factor (id, secret, backup_codes, user_id, verified)
		 values ('t1171-2fa', 'totp-secret-t1171', 'backup-codes-secret-t1171', 't1171-ada', true)`,
	);
	await admin.query(
		`insert into trusted_device (user_id, organization_id, device_fingerprint, device_name, user_agent, platform,
			trust_source, mdm_device_id, is_active, expires_at, last_used_at, last_ip_address, created_at, created_by) values
		 ('t1171-ada', $1, 'device-fingerprint-secret-t1171', 'Ada laptop', 'Firefox t1171', 'linux',
			'remember_device', null, true, '2026-12-01T00:00:00Z', '2026-09-21T08:00:00Z', '198.51.100.20',
			'2026-09-01T08:00:00Z', 't1171-ada'),
		 ('t1171-ada', $2, 'device-fingerprint-secret-t1171', 'Other org device t1171', null, 'macos',
			'remember_device', null, true, null, null, null, '2026-09-01T08:00:00Z', 't1171-ada')`,
		[ORG, OTHER],
	);
	await admin.query(
		`insert into user_settings (user_id, dashboard_widget_order, onboarding_complete, help_improve_product,
			water_reminder_enabled, timezone, week_start_day, time_format, locale, created_at, updated_at)
		 values ('t1171-ada', '{"order":["clock","balance"]}', true, false, true, 'Europe/Berlin', 'monday', '24h',
			null, '2026-01-01T08:00:00Z', '2026-02-01T08:00:00Z')`,
	);
	await admin.query(
		`insert into notification_preference (user_id, organization_id, notification_type, channel, enabled,
			created_at, updated_at) values
		 ('t1171-ada', $1, 'approval_request_submitted', 'email', false, '2026-03-01T08:00:00Z', '2026-03-01T08:00:00Z'),
		 ('t1171-ada', null, 'approval_request_submitted', 'push', true, '2026-03-02T08:00:00Z', '2026-03-02T08:00:00Z')`,
		[OTHER],
	);
	await admin.query(
		`insert into water_intake_log (user_id, logged_at, amount, source, created_at) values
		 ('t1171-ada', '2026-09-20T09:00:00Z', 1, 'manual', '2026-09-20T09:00:00Z'),
		 ('t1171-ada', '2026-09-20T11:00:00Z', 2, 'widget', '2026-09-20T11:00:00Z')`,
	);
	await admin.query(
		`insert into hydration_stats (user_id, current_streak, longest_streak, last_goal_met_date,
			total_intake_all_time, snoozed_until, updated_at)
		 values ('t1171-ada', 3, 9, '2026-09-19', 120, null, '2026-09-20T11:00:00Z')`,
	);
	await admin.query(
		`insert into push_subscription (user_id, endpoint, p256dh, auth, user_agent, device_name, is_active,
			last_used_at, created_at, updated_at)
		 values ('t1171-ada', 'https://push.example/push-endpoint-secret-t1171', 'p256dh-secret-t1171',
			'push-auth-secret-t1171', 'Firefox t1171', 'Ada laptop browser', true, '2026-09-21T08:00:00Z',
			'2026-09-01T08:00:00Z', now())`,
	);
	await admin.query(
		`insert into push_device_token (user_id, session_id, platform, token, is_active, last_seen_at, last_used_at,
			created_at, updated_at)
		 values ('t1171-ada', $1, 'ios', 'native-push-token-secret-t1171', true, '2026-09-21T08:00:00Z', null,
			'2026-09-02T08:00:00Z', now())`,
		[ids.sessionOrg],
	);
	await admin.query(
		`insert into access_violation_log (organization_id, user_id, session_id, violation_type, ip_address, country,
			user_agent, request_path, request_method, metadata, action_taken, created_at) values
		 ($1, 't1171-ada', $3, 'ip_blocked', '203.0.113.9', 'FR', 'Firefox t1171', '/time', 'GET',
			'{"reason":"IP not allowed","blockedIp":"203.0.113.9","deviceFingerprint":"violation-fingerprint-secret-t1171"}',
			'blocked', '2026-09-15T08:00:00Z'),
		 ($2, 't1171-ada', null, 'country_blocked', '203.0.113.10', 'ES', null, '/other-org-path-t1171', 'GET', null,
			'blocked', '2026-09-15T09:00:00Z')`,
		[ORG, OTHER, ids.sessionOrg],
	);
	await admin.query(
		`insert into scim_provisioning_log (organization_id, event_type, user_id, external_id, created_at)
		 values ($1, 'user_created', 't1171-ada', 'scim-external-secret-t1171', now())`,
		[ORG],
	);
}

/** Queues and builds one export, then returns the ZIP's text files. */
async function buildExport(
	employeeId: string,
	kind: "employee" | "admin",
	requestedBy: string,
	organizationId = ORG,
): Promise<{ exportId: string; files: Record<string, string> }> {
	const { rows } = await admin.query<{ id: string }>(
		`insert into personal_data_export (organization_id, employee_id, kind, requested_by_user_id, status, expires_at)
		 values ($1, $2, $3, $4, 'pending', now() + interval '7 days') returning id`,
		[organizationId, employeeId, kind, requestedBy],
	);
	const exportId = rows[0]?.id as string;
	const outcome = await processPersonalDataExport(
		db,
		{ organizationId, exportId },
		{
			upload: async (_organizationId, key, body) => {
				uploads.set(key, new Uint8Array(await new Response(body).arrayBuffer()));
				return { bucket: "t1171", versionId: null };
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

type Entry = Record<string, unknown> & {
	action: string;
	changes: string | null;
	metadata: string | null;
};

describe("personal data export: audit log and account (#1171)", () => {
	beforeAll(seed);

	beforeEach(async () => {
		await admin.query("delete from personal_data_export where organization_id = any($1::text[])", [
			[ORG, OTHER],
		]);
		uploads.clear();
	});

	afterAll(cleanup);

	it("exports audit entries about Ada without other people's IP, user agent or email", async () => {
		const { files } = await buildExport(ids.ada, "employee", "t1171-ada");
		const { entries } = categoryOf(files, "audit_log") as { entries: Entry[] };

		expect(entries.map((entry) => entry.action)).toEqual([
			"manager.assigned",
			"absence.requested",
			"personnel_file.document_viewed",
			"custom_field_value.set",
		]);
		expect(entries[0]).toEqual({
			timestamp: "2026-09-01T08:00:00Z",
			action: "manager.assigned",
			entity_type: "employee",
			entity_id: ids.ada,
			performed_by: "Olga Owner",
			performed_by_you: false,
			ip_address: null,
			user_agent: null,
			changes: null,
			metadata: JSON.stringify({ managerName: "Olga Owner" }),
		});
		expect(entries[1]).toMatchObject({
			timestamp: "2026-09-02T08:00:00Z",
			entity_type: "absence_entry",
			entity_id: ids.adaAbsence,
			performed_by: "Ada Lovelace",
			performed_by_you: true,
			ip_address: "198.51.100.10",
			user_agent: "AdaAgent/1.0",
		});
		// Stored-object references inside the JSON are removed.
		expect(JSON.parse(entries[1]?.changes as string)).toEqual({
			startDate: "2026-09-10",
			endDate: "2026-09-11",
		});
		expect(files["audit_log/entries.csv"]?.split("\n")[0]).toBe(
			"timestamp,action,entity_type,entity_id,performed_by,performed_by_you,ip_address,user_agent,changes,metadata",
		);

		const text = categoryText(files, "audit_log");
		for (const leaked of [
			"203.0.113.77",
			"OwnerAgent/7.7 t1171",
			"owner-email-t1171@example.test",
			"bucket-secret-t1171",
			"object-key-secret-t1171",
			// Withheld data never shows, not even that it exists.
			"HR only note t1171",
			ids.hrOnlyDocument,
			"987.65",
			"billable_time.rate_set",
			"Flight risk",
			"Departure review note t1171",
			"employee_departure",
			// Other organizations and other people's own rows.
			"Other org audit t1171",
			"Bob own audit t1171",
		]) {
			expect(text, leaked).not.toContain(leaked);
		}
	});

	it("identifies the colleagues Ada acted on only by an opaque id, audit log or not", async () => {
		const { files } = await buildExport(ids.ada, "employee", "t1171-ada");
		const { actions_on_others: actions } = categoryOf(files, "audit_log") as {
			actions_on_others: Array<Record<string, unknown>>;
		};

		expect(
			actions.map((row) => [row.record_kind, row.authority, row.action, row.acted_at]),
		).toEqual([
			["time_entry", "record", "created", "2026-09-03T07:00:00Z"],
			["absence_entry", "audit_log", "absence.approved", "2026-09-03T08:00:00Z"],
			["employee", "audit_log", "manager.assigned", "2026-09-04T08:00:00Z"],
			["time_entry", "audit_log", "approval_chain.stage_approved", "2026-09-05T08:00:00Z"],
			["project", "audit_log", "project.created", "2026-09-06T08:00:00Z"],
			["work_policy_violation", "record", "acknowledged", "2026-09-13T08:00:00Z"],
			["vacation_adjustment", "record", "adjusted", "2026-09-14T08:00:00Z"],
		]);
		expect(actions.every((row) => row.as_deputy === false)).toBe(true);
		const bob = actions
			.filter((row) => row.record_kind !== "project")
			.map((row) => row.other_person);
		expect(new Set(bob).size).toBe(1);
		expect(bob[0]).toMatch(/^person-[0-9a-f]{16}$/);
		// An organization-level action concerns no person.
		expect(actions.find((row) => row.record_kind === "project")?.other_person).toBeNull();
		expect(files["audit_log/actions_on_others.csv"]?.split("\n")[0]).toBe(
			"record_kind,authority,action,acted_at,as_deputy,other_person",
		);

		const text = categoryText(files, "audit_log");
		for (const leaked of [
			ids.bob,
			ids.bobAbsence,
			ids.bobEntry,
			ids.project,
			"Bob Builder",
			"Bob private reason t1171",
			"Bob chain note t1171",
			"Ada project t1171",
			"Bob violation note t1171",
			"Bob adjustment reason t1171",
			"Other org adjustment t1171",
		]) {
			expect(text, leaked).not.toContain(leaked);
		}
	});

	it("gives the admin export every row about Ada, withheld ones included, still without others' IPs", async () => {
		const { files } = await buildExport(ids.ada, "admin", "t1171-owner");
		const { entries, actions_on_others: actions } = categoryOf(files, "audit_log") as {
			entries: Entry[];
			actions_on_others: unknown[];
		};
		expect(entries.map((entry) => entry.action)).toEqual([
			"manager.assigned",
			"absence.requested",
			"personnel_file.document_viewed",
			"personnel_file.document_uploaded",
			"billable_time.rate_set",
			"custom_field_value.changed",
			"custom_field_value.set",
			"employee_departure.review_completed",
		]);
		expect(actions).toHaveLength(7);

		const text = categoryText(files, "audit_log");
		expect(text).toContain("987.65");
		expect(text).toContain("HR only note t1171");
		for (const leaked of [
			"203.0.113.77",
			"OwnerAgent/7.7 t1171",
			"owner-email-t1171@example.test",
			"Other org audit t1171",
			"Bob private reason t1171",
			ids.bob,
		]) {
			expect(text, leaked).not.toContain(leaked);
		}
	});

	it("exports Ada's account in the employee export: login, sessions, sign-in methods, devices and settings", async () => {
		const { files } = await buildExport(ids.ada, "employee", "t1171-ada");
		const account = categoryOf(files, "account");

		expect(account.user).toEqual({
			name: "Ada Lovelace",
			first_name: "Ada",
			last_name: "Lovelace",
			email: "t1171-ada@example.test",
			email_verified: true,
			image: "https://cdn.example/avatars/ada.webp",
			two_factor_enabled: true,
			can_create_organizations: true,
			role: "user",
			banned: false,
			ban_reason: null,
			ban_expires: null,
			created_at: "2026-01-01T08:00:00Z",
			updated_at: "2026-02-01T08:00:00Z",
		});
		expect(account.sessions).toEqual([
			{
				created_at: "2026-09-20T08:00:00Z",
				updated_at: "2026-09-21T08:00:00Z",
				expires_at: "2026-10-20T08:00:00Z",
				ip_address: "198.51.100.20",
				user_agent: "Firefox t1171",
				impersonated: false,
				country: "DE",
				region: "BE",
				city: "Berlin",
				mfa_method: "totp",
				mfa_verified_at: "2026-09-20T08:01:00Z",
				last_activity_at: "2026-09-21T08:00:00Z",
			},
			{
				created_at: "2026-09-22T08:00:00Z",
				updated_at: "2026-09-22T09:00:00Z",
				expires_at: "2026-10-21T08:00:00Z",
				// An impersonated session's IP and user agent are the impersonator's.
				ip_address: null,
				user_agent: null,
				impersonated: true,
				// Session details recorded by another organization stay out.
				country: null,
				region: null,
				city: null,
				mfa_method: null,
				mfa_verified_at: null,
				last_activity_at: null,
			},
		]);
		expect(account.sign_in_methods).toEqual([
			{
				provider: "credential",
				account_id: "t1171-ada",
				password_set: true,
				created_at: "2026-01-01T08:00:00Z",
				updated_at: "2026-01-01T08:00:00Z",
			},
			{
				provider: "google",
				account_id: "google-sub-t1171",
				password_set: false,
				created_at: "2026-01-02T08:00:00Z",
				updated_at: "2026-03-01T08:00:00Z",
			},
		]);
		expect(account.passkeys).toEqual([
			{
				name: "YubiKey t1171",
				device_type: "singleDevice",
				backed_up: false,
				transports: "usb",
				aaguid: "aaguid-t1171",
				created_at: "2026-02-02T08:00:00Z",
			},
		]);
		expect(account.trusted_devices).toEqual([
			{
				device_name: "Ada laptop",
				platform: "linux",
				user_agent: "Firefox t1171",
				trust_source: "remember_device",
				is_active: true,
				expires_at: "2026-12-01T00:00:00Z",
				last_used_at: "2026-09-21T08:00:00Z",
				last_ip_address: "198.51.100.20",
				mdm_provider: null,
				mdm_compliant: null,
				created_at: "2026-09-01T08:00:00Z",
				created_by: "Ada Lovelace",
				revoked_at: null,
				revoked_by: null,
				revoke_reason: null,
			},
		]);
		expect(account.settings).toMatchObject({
			dashboard_widget_order: JSON.stringify({ order: ["clock", "balance"] }),
			onboarding_complete: true,
			help_improve_product: false,
			water_reminder_enabled: true,
			timezone: "Europe/Berlin",
			week_start_day: "monday",
			time_format: "24h",
			locale: null,
		});
		expect(account.notification_preferences).toEqual([
			{
				notification_type: "approval_request_submitted",
				channel: "email",
				enabled: false,
				created_at: "2026-03-01T08:00:00Z",
				updated_at: "2026-03-01T08:00:00Z",
			},
			{
				notification_type: "approval_request_submitted",
				channel: "push",
				enabled: true,
				created_at: "2026-03-02T08:00:00Z",
				updated_at: "2026-03-02T08:00:00Z",
			},
		]);
		expect(account.water_intake).toEqual([
			{
				logged_at: "2026-09-20T09:00:00Z",
				amount: 1,
				source: "manual",
				created_at: "2026-09-20T09:00:00Z",
			},
			{
				logged_at: "2026-09-20T11:00:00Z",
				amount: 2,
				source: "widget",
				created_at: "2026-09-20T11:00:00Z",
			},
		]);
		expect(account.hydration_stats).toEqual({
			current_streak: 3,
			longest_streak: 9,
			last_goal_met_date: "2026-09-19",
			total_intake_all_time: 120,
			snoozed_until: null,
			updated_at: "2026-09-20T11:00:00Z",
		});
		expect(account.push_devices).toEqual([
			{
				kind: "web",
				platform: null,
				device_name: "Ada laptop browser",
				user_agent: "Firefox t1171",
				is_active: true,
				created_at: "2026-09-01T08:00:00Z",
				last_used_at: "2026-09-21T08:00:00Z",
				last_seen_at: null,
			},
			{
				kind: "native",
				platform: "ios",
				device_name: null,
				user_agent: null,
				is_active: true,
				created_at: "2026-09-02T08:00:00Z",
				last_used_at: null,
				last_seen_at: "2026-09-21T08:00:00Z",
			},
		]);
		expect(account.access_violations).toEqual([
			{
				violation_type: "ip_blocked",
				action_taken: "blocked",
				ip_address: "203.0.113.9",
				country: "FR",
				user_agent: "Firefox t1171",
				request_path: "/time",
				request_method: "GET",
				reason: "IP not allowed",
				blocked_ip: "203.0.113.9",
				blocked_country: null,
				required_mfa_type: null,
				concurrent_session_count: null,
				created_at: "2026-09-15T08:00:00Z",
			},
		]);

		const text = categoryText(files, "account");
		for (const leaked of [
			"198.51.100.21",
			"Safari t1171",
			"Madrid t1171",
			"Other org device t1171",
			"/other-org-path-t1171",
			OTHER,
			"t1171-owner",
		]) {
			expect(text, leaked).not.toContain(leaked);
		}
	});

	it("never puts a secret of the login anywhere in either export", async () => {
		const own = await buildExport(ids.ada, "employee", "t1171-ada");
		await admin.query("delete from personal_data_export where organization_id = $1", [ORG]);
		const byAdmin = await buildExport(ids.ada, "admin", "t1171-owner");
		for (const { files } of [own, byAdmin]) {
			const everything = Object.values(files).join("\n");
			for (const secret of SECRETS) {
				expect(everything, secret).not.toContain(secret);
			}
		}
	});

	it("keeps the admin export's account to name and email", async () => {
		const { files } = await buildExport(ids.ada, "admin", "t1171-owner");
		expect(Object.keys(categoryOf(files, "account"))).toEqual(["user"]);
		expect(categoryOf(files, "account").user).toEqual({
			name: "Ada Lovelace",
			first_name: "Ada",
			last_name: "Lovelace",
			email: "t1171-ada@example.test",
		});
	});

	it("repeats the login's settings, preferences and wellness logs identically in every organization's export", async () => {
		const here = categoryOf((await buildExport(ids.ada, "employee", "t1171-ada")).files, "account");
		const there = categoryOf(
			(await buildExport(ids.adaOther, "employee", "t1171-ada", OTHER)).files,
			"account",
		);
		for (const part of [
			"user",
			"settings",
			"notification_preferences",
			"water_intake",
			"hydration_stats",
			"sign_in_methods",
			"passkeys",
			"push_devices",
		]) {
			expect(there[part], part).toEqual(here[part]);
		}
		// Organization-scoped rows follow the organization.
		expect(there.trusted_devices.map((row: { device_name: string }) => row.device_name)).toEqual([
			"Other org device t1171",
		]);
		expect(
			there.access_violations.map((row: { request_path: string }) => row.request_path),
		).toEqual(["/other-org-path-t1171"]);
	});
});
