import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { systemClock } from "@/lib/datetime/temporal-core";
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
		// The Approval inbox lists a manager's own assignments (#1978).
		await fixture.pool.query(`update employee set role = 'manager' where id = $1`, [managerId]);
		pendingId = await seedRequest(
			fixture.organizationId,
			requester,
			managerId,
			"pending",
			"2026-10-22T12:00:00Z",
		);
		// Requests assigned elsewhere are not this viewer's pending work.
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
			expect(pending.result.data?.preview.map((row) => row.id)).not.toContain(pendingId);
			expect(recent.result.data?.map((row) => row.id)).toEqual([pendingId, recentId, olderId]);
		} finally {
			await fixture.pool.query(
				`update approval_request set status='pending',updated_at='2026-10-22T12:00:00Z' where id=$1`,
				[pendingId],
			);
		}
	});
	it("withholds organization statistics from an employee base role", async () => {
		expect((await read("team-overview", "employee")).result).toEqual({ success: true, data: null });
	});

	describe("pending approvals from the unified Approval inbox (#1978)", () => {
		let colleagueId: string;
		let adaId: string;
		let katherineId: string;
		let exceptionId: string;
		let coveredId: string;
		let oldestId: string;
		let olderOwnId: string;
		let laterOwnId: string;
		let newestOwnId: string;

		async function named(name: string, role: "manager" | "employee" = "employee") {
			const seeded = await fixture.seedEmployee();
			await fixture.pool.query(`update "user" set name = $2 where id = $1`, [seeded.userId, name]);
			await fixture.pool.query(`update employee set role = $2 where id = $1`, [
				seeded.employeeId,
				role,
			]);
			return seeded;
		}

		beforeAll(async () => {
			const organizationId = fixture.organizationId;
			colleagueId = (await named("Clara Colleague", "manager")).employeeId;
			katherineId = (await named("Katherine Johnson")).employeeId;
			adaId = (await named("Ada Lovelace")).employeeId;
			// The manager manages Ada, so they see her ArbZG compliance exceptions.
			await fixture.pool.query(
				`insert into employee_managers (id, employee_id, manager_id, is_primary, assigned_by) values ($1,$2,$3,true,$4)`,
				[randomUUID(), adaId, managerId, fixture.ownerUserId],
			);
			// Clara is away today and the manager covers for her (#1016).
			await fixture.pool.query(
				`insert into approval_setting (organization_id, deputy_decisions_enabled) values ($1, true)
				 on conflict (organization_id) do update set deputy_decisions_enabled = true`,
				[organizationId],
			);
			const today = systemClock.nowInstant().toZonedDateTimeISO("UTC").toPlainDate();
			const categoryId = randomUUID();
			categoryIds.push(categoryId);
			await fixture.pool.query(
				`insert into absence_category (id,organization_id,type,name,requires_approval,requires_work_time,counts_against_vacation,is_active,updated_at) values ($1,$2,'vacation','Vacation',true,false,true,true,now())`,
				[categoryId, organizationId],
			);
			const awayId = randomUUID();
			absenceIds.push(awayId);
			await fixture.pool.query(
				`insert into absence_entry (id,organization_id,employee_id,category_id,start_date,end_date,status,deputy_employee_id,updated_at) values ($1,$2,$3,$4,$5,$6,'approved',$7,now())`,
				[
					awayId,
					organizationId,
					colleagueId,
					categoryId,
					today.subtract({ days: 1 }).toString(),
					today.add({ days: 1 }).toString(),
					managerId,
				],
			);
			oldestId = await seedRequest(
				organizationId,
				katherineId,
				managerId,
				"pending",
				"2026-10-01T12:00:00Z",
			);
			coveredId = await seedRequest(
				organizationId,
				katherineId,
				colleagueId,
				"pending",
				"2026-10-03T12:00:00Z",
			);
			olderOwnId = await seedRequest(
				organizationId,
				katherineId,
				managerId,
				"pending",
				"2026-10-05T12:00:00Z",
			);
			laterOwnId = await seedRequest(
				organizationId,
				katherineId,
				managerId,
				"pending",
				"2026-10-10T12:00:00Z",
			);
			newestOwnId = await seedRequest(
				organizationId,
				katherineId,
				managerId,
				"pending",
				"2026-11-20T12:00:00Z",
			);
			// Older than every absence request and still valid for a day: pending, not expired.
			const validUntil = systemClock.nowInstant().add({ hours: 23 });
			exceptionId = randomUUID();
			await fixture.pool.query(
				`insert into compliance_exception
				 (id, organization_id, employee_id, exception_type, status, reason, planned_duration_minutes,
				  valid_from, valid_until, created_at, created_by, updated_at)
				 values ($1,$2,$3,'overtime_daily','pending','Inventory count runs late',90,$4,$5,$4,$6,$4)`,
				[
					exceptionId,
					organizationId,
					adaId,
					"2026-09-01T12:00:00Z",
					validUntil.toString(),
					fixture.ownerUserId,
				],
			);
		});

		async function pendingData() {
			const snapshot = await read("pending-approvals");
			if (!snapshot.result.success) throw new Error(snapshot.result.error);
			expect(await Response.json(snapshot).json()).toEqual(snapshot);
			if (!snapshot.result.data) throw new Error("expected pending approvals");
			return snapshot.result.data;
		}

		it("counts every type the inbox badge counts, covered approvals included and flagged", async () => {
			const originalId = randomUUID(),
				correctionId = randomUUID(),
				periodId = randomUUID(),
				requestId = randomUUID();
			const organizationId = fixture.organizationId;
			await fixture.pool.query(
				`insert into time_entry (id,employee_id,organization_id,type,timestamp,utc_offset_minutes,timezone,timezone_source,hash,created_by) values ($1::uuid,$2,$3,'clock_in','2026-10-23T08:00:00Z',120,'Europe/Berlin','backfill',$1::text,$4)`,
				[originalId, katherineId, organizationId, fixture.ownerUserId],
			);
			await fixture.pool.query(
				`insert into time_entry (id,employee_id,organization_id,type,timestamp,utc_offset_minutes,timezone,timezone_source,hash,created_by,replaces_entry_id) values ($1::uuid,$2,$3,'correction','2026-10-23T09:00:00Z',120,'Europe/Berlin','backfill',$1::text,$4,$5)`,
				[correctionId, katherineId, organizationId, fixture.ownerUserId, originalId],
			);
			await fixture.pool.query(
				`insert into work_period (id,employee_id,organization_id,clock_in_id,start_time,updated_at) values ($1,$2,$3,$4,'2026-10-23T08:00:00Z',now())`,
				[periodId, katherineId, organizationId, originalId],
			);
			await fixture.pool.query(
				`insert into approval_request (id,organization_id,entity_type,entity_id,requested_by,approver_id,status,created_at,updated_at) values ($1,$2,'time_entry',$3,$4,$5,'pending',now(),now())`,
				[requestId, organizationId, periodId, katherineId, managerId],
			);
			try {
				const data = await pendingData();
				// Own absences: pendingId plus four of Katherine's; one more covered for Clara.
				expect({
					total: data.total,
					coveringCount: data.coveringCount,
					typeCounts: data.typeCounts,
				}).toEqual({
					total: 8,
					coveringCount: 1,
					typeCounts: [
						{ type: "absence_entry", count: 6 },
						{ type: "time_entry", count: 1 },
						{ type: "compliance_exception", count: 1 },
					],
				});
			} finally {
				await fixture.pool.query(`delete from approval_request where id=$1`, [requestId]);
				await fixture.pool.query(`delete from work_period where id=$1`, [periodId]);
				await fixture.pool.query(`delete from time_entry where id=any($1::uuid[])`, [
					[originalId, correctionId],
				]);
			}
		});

		it("previews the five most urgent pending approvals in inbox risk, priority and age order, tagging covered ones", async () => {
			const data = await pendingData();

			// These stale absence requests are high risk, the compliance exception medium: risk
			// outranks age, so the oldest item waits behind them. Own and covered absences
			// interleave by age; the newest falls outside the five.
			expect(data.preview.map((row) => row.id)).toEqual([
				oldestId,
				coveredId,
				olderOwnId,
				laterOwnId,
				pendingId,
			]);
			expect(data.preview.map((row) => row.id)).not.toContain(exceptionId);
			expect(data.preview.map((row) => row.id)).not.toContain(newestOwnId);
			expect(data.preview[1]).toMatchObject({
				type: "absence_entry",
				requesterName: "Katherine Johnson",
				coveringForName: "Clara Colleague",
			});
			expect(data.preview[0]?.coveringForName).toBeNull();
			for (const row of data.preview) {
				expect(row.title).toBeTruthy();
			}
		});

		it("previews a compliance exception with its requester and localized summary once nothing outranks it", async () => {
			const absenceRequests = [oldestId, coveredId, olderOwnId, laterOwnId, newestOwnId, pendingId];
			await fixture.pool.query(
				`update approval_request set status = 'approved' where id = any($1::uuid[])`,
				[absenceRequests],
			);
			try {
				const data = await pendingData();
				expect(data).toMatchObject({
					total: 1,
					coveringCount: 0,
					typeCounts: [{ type: "compliance_exception", count: 1 }],
				});
				expect(data.preview).toEqual([
					{
						id: exceptionId,
						type: "compliance_exception",
						requesterName: "Ada Lovelace",
						title: expect.objectContaining({ key: expect.stringMatching(/^approvals:/) }),
						// The employee's reason is shown as written.
						detail: "Inventory count runs late",
						coveringForName: null,
					},
				]);
			} finally {
				await fixture.pool.query(
					`update approval_request set status = 'pending' where id = any($1::uuid[])`,
					[absenceRequests],
				);
			}
		});

		it("shows no approvals to an employee who may not open the Approval inbox", async () => {
			const plain = await fixture.seedEmployee();
			harness.userId = plain.userId;
			const snapshot = await readDashboardWidget("pending-approvals", {
				userId: plain.userId,
				organizationId: fixture.organizationId,
				employee: {
					id: plain.employeeId,
					organizationId: fixture.organizationId,
					role: "employee",
				},
			});
			expect(snapshot.result).toEqual({ success: true, data: null });
		});
	});
});
