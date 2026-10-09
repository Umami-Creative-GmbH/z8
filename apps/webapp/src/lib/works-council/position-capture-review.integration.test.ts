/**
 * #834: the works-council portal's position capture section and the review
 * export on PostgreSQL. The organization holds real position stamps; neither
 * the rendered section nor the CSV export may ever contain a position, and
 * names follow the works council's identity visibility. Only the session is
 * mocked.
 */

import { TolgeeProvider } from "@tolgee/react";
import type { NextRequest } from "next/server";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PositionCaptureReviewSection } from "@/components/works-council/position-capture-review-section";
import { db } from "@/db";
import { parseInstant } from "@/lib/datetime/temporal-core";
import { recordPositionStampAccess } from "@/lib/time-tracking/position-capture/access-log";
import { integrationAdminPool } from "@/test/integration-database";
import { createTestTolgee } from "@/test/render-with-translations";

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
								id: `t834-session-${harness.userId}`,
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

const { POST } = await import("@/app/[locale]/(app)/works-council/export/route");
const { loadWorksCouncilPositionCaptureReview } = await import("./position-capture-review-data");

const ids = {
	organization: "t834-position-org",
	otherOrganization: "t834-other-org",
	ownerUser: "t834-owner-user",
	annaUser: "t834-anna-user",
	benUser: "t834-ben-user",
	carlUser: "t834-carl-user",
	doraUser: "t834-dora-user",
	emilUser: "t834-emil-user",
	ivoUser: "t834-ivo-user",
	foreignUser: "t834-foreign-user",
	owner: "d8340000-0000-4000-8000-000000000001",
	anna: "d8340000-0000-4000-8000-000000000002",
	ben: "d8340000-0000-4000-8000-000000000003",
	carl: "d8340000-0000-4000-8000-000000000004",
	dora: "d8340000-0000-4000-8000-000000000005",
	emil: "d8340000-0000-4000-8000-000000000006",
	ivo: "d8340000-0000-4000-8000-000000000007",
	foreign: "d8340000-0000-4000-8000-000000000008",
	team: "d8340000-0000-4000-8000-0000000000d1",
	noticeV1: "d8340000-0000-4000-8000-0000000000a1",
	noticeV2: "d8340000-0000-4000-8000-0000000000a2",
	foreignNotice: "d8340000-0000-4000-8000-0000000000a3",
	annaConsent: "d8340000-0000-4000-8000-0000000000b1",
	foreignConsent: "d8340000-0000-4000-8000-0000000000b2",
	clockIn: "d8340000-0000-4000-8000-0000000000e1",
	foreignClockIn: "d8340000-0000-4000-8000-0000000000e2",
	period: "d8340000-0000-4000-8000-0000000000f1",
	foreignPeriod: "d8340000-0000-4000-8000-0000000000f2",
} as const;

const names: Record<string, string> = {
	[ids.ownerUser]: "Olga Overseer",
	[ids.annaUser]: "Anna Fieldworker",
	[ids.benUser]: "Ben Backoffice",
	[ids.carlUser]: "Carl Courier",
	[ids.doraUser]: "Dora Driver",
	[ids.emilUser]: "Emil Engineer",
	[ids.ivoUser]: "Ivo Inactive",
	[ids.foreignUser]: "Fiona Foreign",
};
const users = Object.keys(names);
const personNames = Object.values(names);

/** Anna's stamp: none of these may ever appear in the portal or its export. */
const STAMP = { latitude: 52.520008, longitude: 13.404954, accuracyMeters: 18.5 };
const POSITION_FRAGMENTS = ["52.52", "13.40", "52,52", "13,40", "18.5"];

describe("works-council position capture section on PostgreSQL", () => {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
	const pool = integrationAdminPool();

	async function cleanup() {
		await pool.query("delete from organization where id in ($1, $2)", [
			ids.organization,
			ids.otherOrganization,
		]);
		await pool.query('delete from "user" where id = any($1::text[])', [users]);
	}

	async function seed() {
		await cleanup();
		const at = new Date("2026-01-01T00:00:00Z");
		await pool.query(
			`insert into organization (id, name, slug, timezone, created_at, works_council_enabled) values
			 ($1, 'T834 position', $1, 'Europe/Berlin', $3, true), ($2, 'T834 other', $2, 'UTC', $3, true)`,
			[ids.organization, ids.otherOrganization, at],
		);
		for (const userId of users) {
			await pool.query(
				`insert into "user" (id, name, email, role, created_at, updated_at)
				 values ($1, $2, $1 || '@example.test', 'user', $3, $3)`,
				[userId, names[userId], at],
			);
			const organizationId = userId === ids.foreignUser ? ids.otherOrganization : ids.organization;
			await pool.query(
				`insert into member (id, organization_id, user_id, role, status, created_at)
				 values ($1, $2, $3, $4, 'approved', $5)`,
				[
					`m-${userId}`,
					organizationId,
					userId,
					userId === ids.ownerUser || userId === ids.foreignUser ? "owner" : "member",
					at,
				],
			);
		}
		await pool.query(
			"insert into team (id, organization_id, name, updated_at) values ($1, $2, 'Field service', $3)",
			[ids.team, ids.organization, at],
		);
		const employees: Array<[string, string, string, string | null, boolean]> = [
			[ids.owner, ids.ownerUser, ids.organization, null, true],
			[ids.anna, ids.annaUser, ids.organization, ids.team, true],
			[ids.ben, ids.benUser, ids.organization, null, true],
			[ids.carl, ids.carlUser, ids.organization, ids.team, true],
			[ids.dora, ids.doraUser, ids.organization, ids.team, true],
			[ids.emil, ids.emilUser, ids.organization, ids.team, true],
			[ids.ivo, ids.ivoUser, ids.organization, ids.team, false],
			[ids.foreign, ids.foreignUser, ids.otherOrganization, null, true],
		];
		for (const [employeeId, userId, organizationId, teamId, isActive] of employees) {
			await pool.query(
				`insert into employee (id, user_id, organization_id, role, team_id, is_active, updated_at)
				 values ($1, $2, $3, $4, $5, $6, $7)`,
				[
					employeeId,
					userId,
					organizationId,
					userId === ids.ownerUser || userId === ids.foreignUser ? "admin" : "employee",
					teamId,
					isActive,
					at,
				],
			);
		}

		// Capture on for the team and for Ben individually; two notice versions.
		await pool.query(
			`insert into position_capture_setting (organization_id, enabled, purpose_statement, retention_days, updated_at)
			 values ($1, true, 'Proof of on-site work at customer sites', 60, $2),
			        ($3, true, 'Foreign purpose', 30, $2)`,
			[ids.organization, at, ids.otherOrganization],
		);
		await pool.query(
			`insert into position_capture_assignment (organization_id, assignment_type, team_id, employee_id, priority, capture_enabled, created_by, updated_at)
			 values ($1, 'team', $2, null, 1, true, $5, $4), ($1, 'employee', null, $3, 2, true, $5, $4)`,
			[ids.organization, ids.team, ids.ben, at, ids.ownerUser],
		);
		await pool.query(
			`insert into position_notice (id, organization_id, version, purpose_statement, retention_days, template_revision, created_at) values
			 ($1, $4, 1, 'Proof of on-site work', 90, 1, '2026-01-01T00:00:00Z'),
			 ($2, $4, 2, 'Proof of on-site work at customer sites', 90, 1, '2026-03-01T00:00:00Z'),
			 ($3, $5, 1, 'Foreign purpose', 30, 1, '2026-01-01T00:00:00Z')`,
			[ids.noticeV1, ids.noticeV2, ids.foreignNotice, ids.organization, ids.otherOrganization],
		);
		await pool.query(
			`insert into position_consent (id, organization_id, employee_id, notice_id, granted_at, withdrawn_at) values
			 ($1, $3, $4, $5, '2026-03-02T00:00:00Z', null),
			 (gen_random_uuid(), $3, $6, $7, '2026-01-02T00:00:00Z', null),
			 (gen_random_uuid(), $3, $8, $5, '2026-03-02T00:00:00Z', '2026-03-05T00:00:00Z'),
			 (gen_random_uuid(), $3, $9, $5, '2026-03-02T00:00:00Z', null),
			 ($2, $10, $11, $12, '2026-01-02T00:00:00Z', null)`,
			[
				ids.annaConsent,
				ids.foreignConsent,
				ids.organization,
				ids.anna,
				ids.noticeV2,
				ids.carl,
				ids.noticeV1,
				ids.emil,
				ids.ivo,
				ids.otherOrganization,
				ids.foreign,
				ids.foreignNotice,
			],
		);
		await pool.query(
			`insert into position_notice_decline (organization_id, employee_id, notice_id, declined_at)
			 values ($1, $2, $3, '2026-03-03T00:00:00Z')`,
			[ids.organization, ids.dora, ids.noticeV2],
		);

		// Anna's stamped clock-in, and the same in the other organization.
		const entry = `insert into time_entry (id, employee_id, organization_id, type, timestamp, utc_offset_minutes,
			timezone_source, hash, created_by) values ($1, $2, $3, 'clock_in', $4, 120, 'test', md5(random()::text), $5)`;
		const startedAt = new Date("2026-09-20T06:00:00Z");
		await pool.query(entry, [ids.clockIn, ids.anna, ids.organization, startedAt, ids.annaUser]);
		await pool.query(entry, [
			ids.foreignClockIn,
			ids.foreign,
			ids.otherOrganization,
			startedAt,
			ids.foreignUser,
		]);
		await pool.query(
			`insert into work_period (id, employee_id, organization_id, clock_in_id, start_time, is_active, updated_at) values
			 ($1, $2, $3, $4, $5, true, $5), ($6, $7, $8, $9, $5, true, $5)`,
			[
				ids.period,
				ids.anna,
				ids.organization,
				ids.clockIn,
				startedAt,
				ids.foreignPeriod,
				ids.foreign,
				ids.otherOrganization,
				ids.foreignClockIn,
			],
		);
		const stamp = `insert into position_stamp (organization_id, employee_id, time_entry_id, consent_id,
			latitude, longitude, accuracy_meters, fixed_at, captured_at, purge_at)
			values ($1, $2, $3, $4, $5, $6, $7, $8, $8, $9)`;
		await pool.query(stamp, [
			ids.organization,
			ids.anna,
			ids.clockIn,
			ids.annaConsent,
			STAMP.latitude,
			STAMP.longitude,
			STAMP.accuracyMeters,
			startedAt,
			new Date("2026-11-19T06:00:00Z"),
		]);
		await pool.query(stamp, [
			ids.otherOrganization,
			ids.foreign,
			ids.foreignClockIn,
			ids.foreignConsent,
			STAMP.latitude,
			STAMP.longitude,
			STAMP.accuracyMeters,
			startedAt,
			new Date("2026-10-20T06:00:00Z"),
		]);

		// The owner looked at Anna's positions; the foreign owner at Fiona's.
		await recordPositionStampAccess(db, {
			organizationId: ids.organization,
			viewerUserId: ids.ownerUser,
			kind: "work_period_detail",
			workPeriodIds: [ids.period],
			subjectEmployeeIds: [ids.anna],
			accessedAt: parseInstant("2026-09-20T15:00:00Z"),
		});
		await recordPositionStampAccess(db, {
			organizationId: ids.otherOrganization,
			viewerUserId: ids.foreignUser,
			kind: "work_period_detail",
			workPeriodIds: [ids.foreignPeriod],
			subjectEmployeeIds: [ids.foreign],
			accessedAt: parseInstant("2026-09-20T15:00:00Z"),
		});
	}

	async function setWorksCouncil(identityVisibility: "aggregated" | "pseudonymized" | "named") {
		await pool.query(
			`insert into works_council_settings (organization_id, enabled, identity_visibility, export_enabled,
				minimum_aggregation_threshold, updated_at)
			 values ($1, true, $2, true, 1, now())
			 on conflict (organization_id) do update set identity_visibility = excluded.identity_visibility`,
			[ids.organization, identityVisibility],
		);
		return { identityVisibility, minimumAggregationThreshold: 1 };
	}

	async function exportCsv(): Promise<string> {
		harness.userId = ids.ownerUser;
		harness.organizationId = ids.organization;
		const response = await POST(
			new Request(
				"https://app.example.test/en/works-council/export?from=2026-09-01&to=2026-09-30",
				{ method: "POST" },
			) as NextRequest,
		);
		expect(response.status).toBe(200);
		return response.text();
	}

	async function renderSection(identityVisibility: "aggregated" | "pseudonymized" | "named") {
		const review = await loadWorksCouncilPositionCaptureReview({
			organizationId: ids.organization,
			settings: await setWorksCouncil(identityVisibility),
		});
		const tolgee = createTestTolgee();
		return {
			review,
			html: renderToStaticMarkup(
				createElement(
					TolgeeProvider,
					{ tolgee, fallback: null },
					createElement(PositionCaptureReviewSection, { review, locale: "en", t: tolgee.t }),
				),
			),
		};
	}

	function expectNoPosition(text: string) {
		for (const fragment of POSITION_FRAGMENTS) expect(text).not.toContain(fragment);
	}

	beforeEach(async () => {
		harness.userId = null;
		harness.organizationId = null;
		await seed();
	});

	afterAll(async () => {
		await cleanup();
	});

	it("counts consent among the active employees capture is switched on for, in this organization only", async () => {
		const { review } = await renderSection("named");

		// Anna active; Emil withdrew; Carl (lapsed), Dora ("Not now") and Ben (no answer) are
		// undecided; Ivo is inactive; the owner has no assignment; Fiona is in another org.
		expect(review.consentCounts).toEqual({
			state: "available",
			switchedOnEmployees: 5,
			active: 1,
			withdrawn: 1,
			undecided: 3,
		});
		expect(review.enabled).toBe(true);
		expect(review.retentionDays).toBe(60);
		expect(review.noticeHistory.map((notice) => notice.version)).toEqual([2, 1]);
		expect(review.teamAssignments).toEqual([{ teamName: "Field service", captureEnabled: true }]);
		expect(review.accessLog).toHaveLength(1);
		expect(JSON.stringify(review)).not.toContain("Fiona");
	});

	it("names the viewer and employees only under named identity visibility, never a position", async () => {
		const { html } = await renderSection("named");
		expect(html).toContain("Olga Overseer");
		expect(html).toContain("Anna Fieldworker");
		expect(html).toContain("Ben Backoffice");
		expectNoPosition(html);

		const csv = await exportCsv();
		expect(csv).toContain('"Position capture enabled","yes"');
		expect(csv).toContain('"Olga Overseer","Anna Fieldworker","1"');
		expectNoPosition(csv);
	});

	it("shows no viewer or employee name when identities are pseudonymized or aggregated, never a position", async () => {
		for (const identityVisibility of ["pseudonymized", "aggregated"] as const) {
			const { html } = await renderSection(identityVisibility);
			const csv = await exportCsv();
			for (const text of [html, csv]) {
				for (const name of personNames) expect(text).not.toContain(name);
				expectNoPosition(text);
			}
			expect(csv).toContain('"Consent: active","1"');
			if (identityVisibility === "pseudonymized") {
				expect(html).toContain("Viewer A");
				expect(csv).toContain('"Viewer A"');
			}
		}
	});
});
