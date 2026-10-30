import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
	createLifecycleDatabaseFixture,
	type LifecycleDatabaseFixture,
} from "@/lib/employee-lifecycle/testing/database.test.fixture";

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
								id: `t1457-dashboard-${harness.userId}`,
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

import type { ServerWidgetId } from "./dashboard-types";

const { readDashboardWidget } = await import("./dashboard-reads");
const { getRecentlyApprovedRequests } = await import("./actions");

describe("authorized Dashboard approval delivery", () => {
	vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });
	let fixture: LifecycleDatabaseFixture;
	let requester: string;
	let managerId: string;
	let managerUserId: string;
	let otherOrg: string;
	let pendingId: string;
	let recentId: string;
	let olderId: string;
	let otherRecentId: string;
	let approvedIds: string[];
	const allRequestIds: string[] = [];
	const absenceIds: string[] = [];
	const categoryIds: string[] = [];
	beforeAll(async () => {
		fixture = await createLifecycleDatabaseFixture();
		const manager = await fixture.seedEmployee();
		managerId = manager.employeeId;
		managerUserId = manager.userId;
		requester = fixture.employeeId;
		otherOrg = await fixture.createOrganization();
		const outsider = await fixture.seedEmployee({ organizationId: otherOrg });
		// This caller has a profile in each org; active organization must select the correct one.
		await fixture.pool.query(
			`insert into member (id, organization_id, user_id, role, status, created_at) values ($1,$2,$3,'member','approved',now())`,
			[randomUUID(), otherOrg, managerUserId],
		);
		await fixture.pool.query(
			`insert into employee (id, organization_id, user_id, role, is_active, updated_at) values ($1,$2,$3,'employee',true,now())`,
			[randomUUID(), otherOrg, managerUserId],
		);
		pendingId = await seedRequest(
			fixture.organizationId,
			requester,
			managerId,
			"pending",
			"2026-10-22T12:00:00Z",
		);
		// Own request and requests assigned elsewhere are not this viewer's pending work.
		await seedRequest(
			fixture.organizationId,
			managerId,
			managerId,
			"pending",
			"2026-10-23T12:00:00Z",
		);
		await seedRequest(
			fixture.organizationId,
			requester,
			fixture.employeeId,
			"pending",
			"2026-10-24T12:00:00Z",
		);
		await seedRequest(otherOrg, outsider.employeeId, managerId, "pending", "2026-10-24T12:00:00Z");
		olderId = await seedRequest(
			fixture.organizationId,
			requester,
			managerId,
			"approved",
			"2026-10-20T12:00:00Z",
		);
		recentId = await seedRequest(
			fixture.organizationId,
			requester,
			managerId,
			"approved",
			"2026-10-22T12:00:00Z",
		);
		otherRecentId = await seedRequest(
			otherOrg,
			outsider.employeeId,
			managerId,
			"approved",
			"2026-10-24T12:00:00Z",
		);
		approvedIds = [recentId, olderId];
	});
	beforeEach(() => {
		harness.userId = managerUserId;
		harness.organizationId = fixture.organizationId;
	});
	afterAll(async () => {
		if (!fixture) return;
		await fixture.pool.query(`delete from approval_request where id = any($1::uuid[])`, [
			allRequestIds,
		]);
		await fixture.pool.query(`delete from absence_entry where id = any($1::uuid[])`, [absenceIds]);
		await fixture.pool.query(`delete from absence_category where id = any($1::uuid[])`, [
			categoryIds,
		]);
		await fixture.close();
	});
	async function seedRequest(
		organizationId: string,
		requestedBy: string,
		approverId: string,
		status: string,
		updatedAt: string,
	) {
		const categoryId = randomUUID();
		categoryIds.push(categoryId);
		await fixture.pool.query(
			`insert into absence_category (id,organization_id,type,name,requires_approval,requires_work_time,counts_against_vacation,is_active,updated_at) values ($1,$2,'vacation','Vacation',true,false,true,true,now())`,
			[categoryId, organizationId],
		);
		const absenceId = randomUUID();
		absenceIds.push(absenceId);
		await fixture.pool.query(
			`insert into absence_entry (id,organization_id,employee_id,category_id,start_date,end_date,status,updated_at) values ($1,$2,$3,$4,'2026-10-26','2026-10-27',$5,now())`,
			[absenceId, organizationId, requestedBy, categoryId, status],
		);
		const id = randomUUID();
		allRequestIds.push(id);
		await fixture.pool.query(
			`insert into approval_request (id,organization_id,entity_type,entity_id,requested_by,approver_id,status,created_at,updated_at) values ($1,$2,'absence_entry',$3,$4,$5,$6,$7,$7)`,
			[id, organizationId, absenceId, requestedBy, approverId, status, updatedAt],
		);
		return id;
	}
	async function read<K extends ServerWidgetId>(id: K, role: "manager" | "employee" = "manager") {
		return readDashboardWidget(id, {
			userId: managerUserId,
			organizationId: fixture.organizationId,
			employee: { id: managerId, organizationId: fixture.organizationId, role },
		});
	}
	it.each([
		"managed-employees",
		"team-overview",
		"pending-approvals",
		"recently-approved",
	] as const)(
		"refuses missing employee scope for %s rather than inventing empty data",
		async (id) => {
			for (const employee of [
				null,
				{ id: managerId, organizationId: otherOrg, role: "manager" as const },
			]) {
				const snapshot = await readDashboardWidget(id, {
					userId: managerUserId,
					organizationId: fixture.organizationId,
					employee,
				});
				expect(snapshot.result.success).toBe(false);
			}
		},
	);

	it("delivers only assigned pending approvals and preserves calendar strings after an actual JSON response", async () => {
		const snapshot = await read("pending-approvals");
		expect(snapshot.result.success).toBe(true);
		if (!snapshot.result.success) throw new Error(snapshot.result.error);
		expect(snapshot.result.data?.absenceApprovals.map((row) => row.id)).toEqual([pendingId]);
		expect(snapshot.result.data?.absenceApprovals[0].absence).toEqual({
			startDate: "2026-10-26",
			endDate: "2026-10-27",
			category: { name: "Vacation" },
		});
		expect(await Response.json(snapshot).json()).toEqual(snapshot);
	});
	it("serializes a real pending correction's UTC work-period instant without changing its card meaning", async () => {
		const originalId = randomUUID(),
			correctionId = randomUUID(),
			periodId = randomUUID(),
			requestId = randomUUID();
		const organizationId = fixture.organizationId;
		await fixture.pool.query(
			`insert into time_entry (id,employee_id,organization_id,type,timestamp,utc_offset_minutes,timezone,timezone_source,hash,created_by) values ($1::uuid,$2,$3,'clock_in','2026-10-23T08:00:00Z',120,'Europe/Berlin','backfill',$1::text,$4)`,
			[originalId, requester, organizationId, fixture.ownerUserId],
		);
		await fixture.pool.query(
			`insert into time_entry (id,employee_id,organization_id,type,timestamp,utc_offset_minutes,timezone,timezone_source,hash,created_by,replaces_entry_id) values ($1::uuid,$2,$3,'correction','2026-10-23T09:00:00Z',120,'Europe/Berlin','backfill',$1::text,$4,$5)`,
			[correctionId, requester, organizationId, fixture.ownerUserId, originalId],
		);
		await fixture.pool.query(
			`insert into work_period (id,employee_id,organization_id,clock_in_id,start_time,updated_at) values ($1,$2,$3,$4,'2026-10-23T08:00:00Z',now())`,
			[periodId, requester, organizationId, originalId],
		);
		await fixture.pool.query(
			`insert into approval_request (id,organization_id,entity_type,entity_id,requested_by,approver_id,status,created_at,updated_at) values ($1,$2,'time_entry',$3,$4,$5,'pending',now(),now())`,
			[requestId, organizationId, periodId, requester, managerId],
		);
		try {
			const snapshot = await read("pending-approvals");
			if (!snapshot.result.success) throw new Error(snapshot.result.error);
			expect(snapshot.result.data?.timeCorrectionApprovals).toEqual([
				{
					id: requestId,
					requester: { user: { name: "Lifecycle" } },
					workPeriod: { startTime: "2026-10-23T08:00:00.000Z" },
				},
			]);
			expect(await Response.json(snapshot).json()).toEqual(snapshot);
		} finally {
			await fixture.pool.query(`delete from approval_request where id=$1`, [requestId]);
			await fixture.pool.query(`delete from work_period where id=$1`, [periodId]);
			await fixture.pool.query(`delete from time_entry where id=any($1::uuid[])`, [
				[originalId, correctionId],
			]);
		}
	});

	it("retains recent approval order and UTC instants while excluding the other organization", async () => {
		const snapshot = await read("recently-approved");
		if (!snapshot.result.success) throw new Error(snapshot.result.error);
		expect(snapshot.result.data?.map((row) => row.id)).toEqual(approvedIds);
		expect(snapshot.result.data?.[0].updatedAt).toBe("2026-10-22T12:00:00.000Z");
		expect(snapshot.result.data?.[0].requestedByEmployee.user.name).toBe("Lifecycle");
		expect(await Response.json(snapshot).json()).toEqual(snapshot);
		const action = await getRecentlyApprovedRequests();
		if (!action.success) throw new Error(action.error);
		expect(action.data.map((row) => row.id)).toEqual(approvedIds);
	});
	it("follows active organization in the existing action when a caller has employee profiles in both", async () => {
		harness.organizationId = otherOrg;
		const result = await getRecentlyApprovedRequests();
		if (!result.success) throw new Error(result.error);
		expect(result.data.map((row) => row.id)).toEqual([otherRecentId]);
	});

	it("observes an approval decision on the immediately following read without a cache delay", async () => {
		await fixture.pool.query(
			`update approval_request set status='approved',updated_at='2026-10-24T12:00:00Z' where id=$1`,
			[pendingId],
		);
		try {
			const pending = await read("pending-approvals");
			const recent = await read("recently-approved");
			if (!pending.result.success || !recent.result.success) throw new Error("read failed");
			expect(pending.result.data?.absenceApprovals).toEqual([]);
			expect(recent.result.data?.map((row) => row.id)).toEqual([pendingId, recentId, olderId]);
		} finally {
			await fixture.pool.query(
				`update approval_request set status='pending',updated_at='2026-10-22T12:00:00Z' where id=$1`,
				[pendingId],
			);
		}
	});
	it("retains assigned approval visibility for an employee base role while withholding organization statistics", async () => {
		const approvals = await read("pending-approvals", "employee");
		if (!approvals.result.success) throw new Error(approvals.result.error);
		expect(approvals.result.data?.absenceApprovals.map((row) => row.id)).toEqual([pendingId]);
		expect((await read("team-overview", "employee")).result).toEqual({ success: true, data: null });
	});
});
