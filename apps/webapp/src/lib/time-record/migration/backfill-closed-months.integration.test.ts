/**
 * #1213 (spec #1212, story 25): the lazy canonical backfill behind the payroll export and the
 * payroll workspace attaches canonical work records one period at a time. A completed work
 * period without one in a closed month is refused by the database (Z8M01, Time Tracking
 * ADR-0004), so it is skipped and stays a half pair; the rest of the organization is still
 * backfilled and payroll doesn't fail. No closed-month bypass is involved.
 */
import { DateTime } from "luxon";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { parseInstant } from "@/lib/datetime/temporal-core";
import { fetchWorkPeriodsForExport } from "@/lib/payroll-export/data-fetcher";
import { getPayrollWorkspaceSummary } from "@/lib/payroll-workspace/summary";
import { reopenMonthAttachingWork } from "@/lib/time-tracking/closed-months/reopen-month";
import { closeMonth } from "@/lib/time-tracking/closed-months/store";
import {
	type ClosedMonthDatabaseFixture,
	createClosedMonthDatabaseFixture,
} from "@/lib/time-tracking/closed-months/testing/closed-month-database.test.fixture";
import { expectRecordAgreement } from "@/lib/time-tracking/work-records/__tests__/expect-record-agreement";
import { asHistory } from "@/lib/time-tracking/work-records/__tests__/historical-work";
import { assertCanonicalCutoverReady } from "./cutover-state";
import { reconcileLegacyToCanonical } from "./reconciliation";

describe("the canonical backfill with closed months", () => {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
	let fixture: ClosedMonthDatabaseFixture;

	beforeAll(async () => {
		fixture = await createClosedMonthDatabaseFixture();
	});

	afterAll(async () => {
		await fixture?.close();
	});

	/**
	 * An organization in UTC whose employee has a half pair (work period without a canonical
	 * work record) in closed March and one in open April that drove 30 km in their own car.
	 */
	async function halfPairsAcrossAClose() {
		const org = await fixture.organization("UTC");
		const person = await fixture.employee({ organizationId: org.organizationId });
		const work = (start: string, end: string) =>
			fixture.work({
				organizationId: org.organizationId,
				employeeId: person.employeeId,
				userId: person.userId,
				start,
				end,
				canonical: "history",
			});
		const march = await work("2026-03-10T08:00:00Z", "2026-03-10T16:00:00Z");
		const april = await work("2026-04-07T08:00:00Z", "2026-04-07T16:00:00Z");
		// A colleague's half pair in March.
		const colleague = await fixture.employee({ organizationId: org.organizationId });
		const colleagueMarch = await fixture.work({
			organizationId: org.organizationId,
			employeeId: colleague.employeeId,
			userId: colleague.userId,
			start: "2026-03-11T08:00:00Z",
			end: "2026-03-11T16:00:00Z",
			canonical: "history",
		});
		await asHistory(fixture.pool, (client) =>
			client.query(
				`update work_period set vehicle_kind = 'own', odometer_start_km = 100,
				 odometer_end_km = 130, driven_distance_km = 30 where id = $1`,
				[april.workPeriodId],
			),
		);
		// The March period's approval history must not be linked to a record it can't get.
		await fixture.pool.query(
			`insert into approval_request
			 (organization_id, entity_type, entity_id, requested_by, approver_id, status, updated_at)
			 select $1, 'time_entry', $2, $3, e.id, 'approved', now()
			 from employee e where e.organization_id = $1 and e.user_id = $4`,
			[org.organizationId, march.workPeriodId, person.employeeId, org.ownerUserId],
		);
		const closed = await closeMonth(fixture.db, {
			organizationId: org.organizationId,
			month: "2026-03",
			scope: { kind: "organization" },
			actor: { kind: "user", userId: org.ownerUserId },
			now: parseInstant("2026-04-10T12:00:00Z"),
		});
		expect(closed.kind).toBe("closed");
		return { org, person, march, april, colleagueMarch };
	}

	async function canonicalOf(workPeriodId: string) {
		const { rows } = await fixture.pool.query<{
			canonical_record_id: string | null;
			graph_revision: number;
			record_id: string | null;
			origin: string | null;
			created_by: string | null;
			detail_id: string | null;
			vehicle_kind: string | null;
			odometer_start_km: number | null;
			odometer_end_km: number | null;
			driven_distance_km: number | null;
		}>(
			`select wp.canonical_record_id, wp.graph_revision, r.id as record_id, r.origin,
			  r.created_by, d.record_id as detail_id,
			  d.vehicle_kind, d.odometer_start_km, d.odometer_end_km, d.driven_distance_km
			 from work_period wp
			 left join time_record r on r.id = wp.id
			 left join time_record_work d on d.record_id = wp.id
			 where wp.id = $1`,
			[workPeriodId],
		);
		return rows[0];
	}

	it("backfills open months, leaves closed half pairs alone, and keeps payroll running", async () => {
		const { org, person, march, april } = await halfPairsAcrossAClose();

		await expect(
			fetchWorkPeriodsForExport(org.organizationId, {
				dateRange: {
					start: DateTime.fromISO("2026-04-01", { zone: "UTC" }),
					end: DateTime.fromISO("2026-04-30", { zone: "UTC" }),
				},
			}),
		).resolves.toEqual([expect.objectContaining({ employeeId: person.employeeId })]);
		await expect(
			getPayrollWorkspaceSummary({
				organizationId: org.organizationId,
				allowedEmployeeIds: [],
				period: {
					start: DateTime.fromISO("2026-04-01", { zone: "UTC" }),
					end: DateTime.fromISO("2026-04-30", { zone: "UTC" }),
					label: "April 2026",
				},
				generatedBy: { id: org.ownerUserId, name: "Owner" },
			}),
		).resolves.toBeDefined();

		// Attached through work records: the revision advances, the record agrees with its
		// period and was created by the work's own actor.
		await expectRecordAgreement({
			organizationId: org.organizationId,
			workPeriodIds: [april.workPeriodId],
		});
		expect(await canonicalOf(april.workPeriodId)).toEqual({
			canonical_record_id: april.workPeriodId,
			graph_revision: 1,
			record_id: april.workPeriodId,
			origin: "system",
			created_by: person.userId,
			detail_id: april.workPeriodId,
			vehicle_kind: "own",
			odometer_start_km: 100,
			odometer_end_km: 130,
			driven_distance_km: 30,
		});
		expect(await canonicalOf(march.workPeriodId)).toMatchObject({
			canonical_record_id: null,
			record_id: null,
			detail_id: null,
		});
		const { rows: links } = await fixture.pool.query(
			"select canonical_record_id from approval_request where entity_id = $1",
			[march.workPeriodId],
		);
		expect(links).toEqual([{ canonical_record_id: null }]);
		// A closed month's half pair can't change, so it doesn't hold payroll readiness back.
		expect(
			Object.values(await reconcileLegacyToCanonical(org.organizationId)).every((n) => n === 0),
		).toBe(true);
	});

	it("attaches the reopened employees' half pairs on reopening; closing again leaves them", async () => {
		const { org, person, march, colleagueMarch } = await halfPairsAcrossAClose();
		await assertCanonicalCutoverReady(org.organizationId);
		expect((await canonicalOf(march.workPeriodId)).record_id).toBeNull();

		const reopened = await reopenMonthAttachingWork(fixture.db, {
			organizationId: org.organizationId,
			month: "2026-03",
			scope: { kind: "employees", employeeIds: [person.employeeId] },
			reason: "Late correction",
			actorUserId: org.ownerUserId,
		});

		expect(reopened).toMatchObject({
			kind: "reopened",
			employeeIds: [person.employeeId],
			work: { attached: [march.workPeriodId], closedMonthSkips: [], refused: [] },
		});
		expect(await canonicalOf(march.workPeriodId)).toMatchObject({
			canonical_record_id: march.workPeriodId,
			record_id: march.workPeriodId,
			origin: "system",
			created_by: person.userId,
			detail_id: march.workPeriodId,
		});
		await expectRecordAgreement({
			organizationId: org.organizationId,
			workPeriodIds: [march.workPeriodId],
		});
		const { rows: links } = await fixture.pool.query(
			"select canonical_record_id from approval_request where entity_id = $1",
			[march.workPeriodId],
		);
		expect(links).toEqual([{ canonical_record_id: march.workPeriodId }]);
		// The colleague is still closed for March: their half pair stays as it is.
		expect((await canonicalOf(colleagueMarch.workPeriodId)).record_id).toBeNull();

		const closedAgain = await closeMonth(fixture.db, {
			organizationId: org.organizationId,
			month: "2026-03",
			scope: { kind: "organization" },
			actor: { kind: "user", userId: org.ownerUserId },
			now: parseInstant("2026-04-20T12:00:00Z"),
		});
		expect(closedAgain).toMatchObject({ kind: "closed", employeeIds: [person.employeeId] });
		expect(await canonicalOf(march.workPeriodId)).toMatchObject({
			canonical_record_id: march.workPeriodId,
			record_id: march.workPeriodId,
		});
	});
});
