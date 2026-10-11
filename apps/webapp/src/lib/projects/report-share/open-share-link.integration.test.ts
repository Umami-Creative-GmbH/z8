/**
 * #806: a recipient opening a report share link on PostgreSQL, and the sweep
 * that keeps links honest. Links are created through the real creation path;
 * no session exists when they are opened.
 */

import { Effect } from "effect";
import { Temporal } from "temporal-polyfill";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { DatabaseService, makeDatabaseService } from "@/lib/effect/services/database.service";
import { loadProjectReportViewer } from "@/lib/reports/project-billable-report";
import { integrationAdminPool } from "@/test/integration-database";
import {
	type CreateShareLinkInput,
	createShareLink,
	deleteShareLinkViewsPastAuditLifetime,
	listShareLinks,
	listShareLinkViews,
	openShareLink,
	shareLinkCreatorLocale,
	sweepShareLinks,
} from "./report-share-links";
import { shareLinkFixture } from "./testing/share-link.fixture";

vi.mock("@/lib/logger", () => ({
	createLogger: () => ({
		error: () => {},
		warn: () => {},
		info: () => {},
		debug: () => {},
		child: () => ({ error: () => {}, warn: () => {}, info: () => {}, debug: () => {} }),
	}),
}));

const fixture = shareLinkFixture("t806o", "8061");
const { ids } = fixture;
const createdAt = Temporal.Instant.from("2026-10-01T09:00:00Z");
const later = Temporal.Instant.from("2026-10-05T09:00:00Z");
const recipient = { ipAddress: "203.0.113.7", userAgent: "Mozilla/5.0 (Recipient)" };

async function create(
	creator: { userId: string; employeeId: string; role: "admin" | "manager" | "employee" },
	input: Partial<CreateShareLinkInput> & Pick<CreateShareLinkInput, "target">,
) {
	const viewer = await loadProjectReportViewer(db, {
		organizationId: ids.organization,
		userId: creator.userId,
		employee: { id: creator.employeeId, role: creator.role },
	});
	const created = await Effect.runPromise(
		createShareLink({
			organizationId: ids.organization,
			creator: { userId: creator.userId, employeeId: creator.employeeId },
			viewer,
			fromDay: "2026-03-01",
			toDay: "2026-03-31",
			figures: "revenue",
			includeEmployees: false,
			creatorLocale: "de",
			now: createdAt,
			...input,
		}).pipe(Effect.provideService(DatabaseService, makeDatabaseService(db))),
	);
	return { ...created, token: created.path.slice("/share/".length) };
}

const pm = () => ({ userId: ids.pmUser, employeeId: ids.pm, role: "employee" as const });
const owner = () => ({ userId: ids.ownerUser, employeeId: ids.owner, role: "admin" as const });

describe("opening report share links on PostgreSQL", () => {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
	const admin = integrationAdminPool();

	beforeEach(() => fixture.seed(admin));
	afterAll(() => fixture.cleanup(admin));

	async function storedLink(id: string) {
		const { rows } = await admin.query("select * from report_share_link where id = $1", [id]);
		return rows[0];
	}

	async function views(id: string) {
		const { rows } = await admin.query(
			"select viewed_at, ip_address, user_agent from report_share_link_view where link_id = $1",
			[id],
		);
		return rows;
	}

	it("shows the snapshot with its header to anyone holding the token and logs the view", async () => {
		const link = await create(pm(), { target: { kind: "project", projectId: ids.website } });

		const opened = await openShareLink(db, { token: link.token, now: later, request: recipient });

		expect(opened).toMatchObject({
			status: "available",
			organizationName: "T806 GmbH",
			creatorName: ids.pmUser,
			createdAt: "2026-10-01T09:00:00Z",
			expiresAt: "2026-10-31T09:00:00Z",
			creatorLocale: "de",
			snapshot: { kind: "project", project: { name: "Website" } },
		});
		expect(await views(link.id)).toEqual([
			{
				viewed_at: new Date("2026-10-05T09:00:00Z"),
				ip_address: "203.0.113.7",
				user_agent: "Mozilla/5.0 (Recipient)",
			},
		]);
	});

	it("gives unknown, malformed, expired and revoked tokens the same neutral answer", async () => {
		const expiring = await create(pm(), {
			target: { kind: "project", projectId: ids.website },
			expiresInDays: 1,
		});
		const revoked = await create(pm(), { target: { kind: "project", projectId: ids.website } });
		await admin.query(
			"update report_share_link set revoked_at = now(), revoke_reason = 'manual', snapshot = null where id = $1",
			[revoked.id],
		);

		for (const token of [
			"A".repeat(43),
			"not-a-token",
			`${expiring.token}x`,
			expiring.token,
			revoked.token,
		]) {
			expect(await openShareLink(db, { token, now: later, request: recipient })).toEqual({
				status: "unavailable",
			});
		}
		expect(await views(expiring.id)).toEqual([]);
		expect(await storedLink(expiring.id)).toMatchObject({
			snapshot: null,
			revoke_reason: "expired",
			revoked_at: new Date("2026-10-02T09:00:00Z"),
			revoked_by: null,
		});
	});

	it("gives the creator's language only for a live link, so the page language never tells dead tokens apart", async () => {
		const live = await create(pm(), { target: { kind: "project", projectId: ids.website } });
		const expiring = await create(pm(), {
			target: { kind: "project", projectId: ids.website },
			expiresInDays: 1,
		});
		const revoked = await create(pm(), { target: { kind: "project", projectId: ids.website } });
		await admin.query(
			"update report_share_link set revoked_at = now(), revoke_reason = 'manual', snapshot = null where id = $1",
			[revoked.id],
		);

		expect(await shareLinkCreatorLocale(db, live.token, later)).toBe("de");
		for (const token of [expiring.token, revoked.token, "A".repeat(43)]) {
			expect(await shareLinkCreatorLocale(db, token, later)).toBeNull();
		}
	});

	it("stops a customer link at once when its creator loses one of its two projects", async () => {
		const link = await create(pm(), { target: { kind: "customer", customerId: ids.acme } });
		await openShareLink(db, { token: link.token, now: later, request: recipient });

		await admin.query("delete from project_manager where project_id = $1 and employee_id = $2", [
			ids.support,
			ids.pm,
		]);

		expect(await openShareLink(db, { token: link.token, now: later, request: recipient })).toEqual({
			status: "unavailable",
		});
		expect(await storedLink(link.id)).toMatchObject({
			snapshot: null,
			revoke_reason: "creator_lost_access",
			revoked_by: null,
			kind: "customer",
		});
		expect(await views(link.id)).toHaveLength(1);
		const { rows } = await admin.query(
			"select action, performed_by, metadata from audit_log where entity_id = $1 order by timestamp",
			[link.id],
		);
		expect(rows.map((row) => row.action)).toEqual([
			"report_share_link.created",
			"report_share_link.auto_revoked",
		]);
		expect(JSON.parse(rows[1].metadata)).toMatchObject({
			reason: "creator_lost_access",
			automatic: true,
		});
	});

	it("keeps showing what was shared after the work behind it is corrected", async () => {
		const link = await create(owner(), {
			target: { kind: "project", projectId: ids.website },
			includeEmployees: true,
		});
		await admin.query(
			"update work_period set duration_minutes = 60 where project_id = $1 and organization_id = $2",
			[ids.website, ids.organization],
		);
		await fixture.work(admin, {
			employeeId: ids.worker,
			projectId: ids.website,
			start: "2026-03-05T08:00:00Z",
			end: "2026-03-05T12:00:00Z",
			minutes: 240,
		});
		await admin.query("update project set status = 'archived' where id = $1", [ids.website]);

		const opened = await openShareLink(db, { token: link.token, now: later, request: recipient });
		expect(opened).toMatchObject({
			status: "available",
			snapshot: {
				summary: { totalMinutes: 480, workPeriodCount: 1 },
				employeeBreakdown: [{ employeeName: ids.workerUser, totalMinutes: 480 }],
			},
		});
	});

	it("sweeps expired links and links of creators who left, keeping their records", async () => {
		const expiring = await create(owner(), {
			target: { kind: "project", projectId: ids.website },
			expiresInDays: 1,
		});
		const departed = await create(pm(), { target: { kind: "project", projectId: ids.support } });
		const live = await create(owner(), { target: { kind: "project", projectId: ids.portal } });
		await admin.query("update employee set is_active = false where id = $1", [ids.pm]);

		expect(await sweepShareLinks(db, { now: later })).toEqual({ expired: 1, creatorLostAccess: 1 });

		expect(await storedLink(expiring.id)).toMatchObject({
			snapshot: null,
			revoke_reason: "expired",
		});
		expect(await storedLink(departed.id)).toMatchObject({
			snapshot: null,
			revoke_reason: "creator_lost_access",
		});
		expect(await storedLink(live.id)).toMatchObject({ revoked_at: null });
		expect((await storedLink(live.id)).snapshot).not.toBeNull();
	});

	it("shows a link's views to its creator and owners, never to other members or organizations", async () => {
		const link = await create(pm(), { target: { kind: "project", projectId: ids.website } });
		await openShareLink(db, { token: link.token, now: later, request: recipient });

		const viewsOf = (organizationId: string, userId: string, isOrganizationAdmin: boolean) =>
			listShareLinkViews(db, {
				organizationId,
				linkId: link.id,
				reader: { userId, isOrganizationAdmin },
			});
		expect(await viewsOf(ids.organization, ids.pmUser, false)).toEqual([
			{
				viewedAt: "2026-10-05T09:00:00Z",
				ipAddress: "203.0.113.7",
				userAgent: "Mozilla/5.0 (Recipient)",
			},
		]);
		expect(await viewsOf(ids.organization, ids.ownerUser, true)).toHaveLength(1);
		expect(await viewsOf(ids.organization, ids.teamManagerUser, false)).toBeNull();
		expect(await viewsOf(ids.otherOrganization, ids.otherUser, true)).toBeNull();
		const [summary] = await listShareLinks(db, {
			organizationId: ids.organization,
			reader: { userId: ids.ownerUser, isOrganizationAdmin: true },
			now: later,
		});
		expect(summary).toMatchObject({
			id: link.id,
			status: "active",
			viewCount: 1,
			lastViewedAt: "2026-10-05T09:00:00Z",
			canRevoke: true,
		});
	});

	it("removes recipient views older than the 365-day audit-log lifetime", async () => {
		const link = await create(pm(), { target: { kind: "project", projectId: ids.website } });
		await admin.query(
			`insert into report_share_link_view (organization_id, link_id, viewed_at) values
			 ($1, $2, '2025-10-01T08:59:00Z'), ($1, $2, '2025-10-01T09:01:00Z')`,
			[ids.organization, link.id],
		);

		expect(
			await deleteShareLinkViewsPastAuditLifetime(db, {
				now: Temporal.Instant.from("2026-10-01T09:00:00Z"),
				lifetimeDays: 365,
			}),
		).toBe(1);
		expect(await views(link.id)).toEqual([
			expect.objectContaining({ viewed_at: new Date("2025-10-01T09:01:00Z") }),
		]);
	});
});
