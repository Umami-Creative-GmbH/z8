/**
 * #1217 (spec #1212): work diagnostics and the cutover reconciliation judge stored
 * work by the record agreement rule every writer uses, so "divergent" means one
 * thing everywhere. Pairs that agree are seeded by copying each work period into
 * its canonical work record; one canonical column per pair is then changed with
 * SQL, as history would contain it. Half pairs (completed work without a canonical
 * record) in a closed month are reported apart from the rest.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { parseInstant } from "@/lib/datetime/temporal-core";
import { runCanonicalBackfill } from "@/lib/time-record/migration/backfill";
import { assertCanonicalCutoverReady } from "@/lib/time-record/migration/cutover-state";
import { reconcileLegacyToCanonical } from "@/lib/time-record/migration/reconciliation";
import { asHistory } from "@/lib/time-tracking/work-records/__tests__/historical-work";
import { closeMonth } from "./closed-months/store";
import {
	type ClosedMonthDatabaseFixture,
	createClosedMonthDatabaseFixture,
} from "./closed-months/testing/closed-month-database.test.fixture";
import { calendarDateEnvelope, type WorkFinding } from "./historical-work-diagnostics";
import { readHistoricalWorkDiagnostics } from "./historical-work-diagnostics-reader";

describe("record agreement in work diagnostics and the cutover reconciliation", () => {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
	let fixture: ClosedMonthDatabaseFixture;

	beforeAll(async () => {
		fixture = await createClosedMonthDatabaseFixture();
	});

	afterAll(async () => {
		await fixture?.close();
	});

	async function organizationWithReferences() {
		const org = await fixture.organization("UTC");
		const person = await fixture.employee({ organizationId: org.organizationId });
		const refs = {
			project: randomUUID(),
			otherProject: randomUUID(),
			task: randomUUID(),
			category: randomUUID(),
			otherCategory: randomUUID(),
		};
		await fixture.pool.query(
			`insert into project (id, organization_id, name, status, is_active, created_by, updated_at)
			 values ($1, $3, 'Project A', 'active', true, $4, now()),
			        ($2, $3, 'Project B', 'active', true, $4, now())`,
			[refs.project, refs.otherProject, org.organizationId, org.ownerUserId],
		);
		await fixture.pool.query(
			`insert into project_task (id, organization_id, project_id, name, state, created_by, updated_at)
			 values ($1, $2, $3, 'Design', 'open', $4, now())`,
			[refs.task, org.organizationId, refs.project, org.ownerUserId],
		);
		await fixture.pool.query(
			`insert into work_category (id, organization_id, name, created_by, updated_at)
			 values ($1, $3, 'Category A', $4, now()), ($2, $3, 'Category B', $4, now())`,
			[refs.category, refs.otherCategory, org.organizationId, org.ownerUserId],
		);
		return { org, person, refs };
	}

	type Seeded = Awaited<ReturnType<typeof organizationWithReferences>>;

	/** Completed work on `day` and a canonical work record that agrees with it. */
	async function agreeingPair(
		seeded: Seeded,
		day: string,
		attribution: {
			projectId?: string;
			taskId?: string;
			isBillable?: boolean;
			workCategoryId?: string;
			workLocationType?: string;
			ownCarFromKm?: number;
		} = {},
	) {
		const { workPeriodId } = await fixture.work({
			organizationId: seeded.org.organizationId,
			employeeId: seeded.person.employeeId,
			userId: seeded.person.userId,
			start: `${day}T08:00:00Z`,
			end: `${day}T16:00:00Z`,
			canonical: "history",
		});
		// The pair as history wrote it: the record check (#1224) sees it only once linked.
		await asHistory(fixture.pool, async (client) => {
			await client.query(
				`update work_period set project_id = $2, task_id = $3, is_billable = $4,
				  work_category_id = $5, work_location_type = $6,
				  vehicle_kind = case when $7::int is null then null else 'own' end,
				  odometer_start_km = $7
				 where id = $1`,
				[
					workPeriodId,
					attribution.projectId ?? null,
					attribution.taskId ?? null,
					attribution.isBillable ?? false,
					attribution.workCategoryId ?? null,
					attribution.workLocationType ?? null,
					attribution.ownCarFromKm ?? null,
				],
			);
			await client.query(
				`insert into time_record
				 (id, organization_id, employee_id, record_kind, start_at, end_at, duration_minutes,
				  approval_state, origin, created_by, updated_by, updated_at)
				 select id, organization_id, employee_id, 'work', start_time, end_time, duration_minutes,
				  approval_status::text::time_record_approval_state, 'clock', $2, $2, now()
				 from work_period where id = $1`,
				[workPeriodId, seeded.org.ownerUserId],
			);
			await client.query(
				`insert into time_record_work
				 (record_id, organization_id, work_category_id, work_location_type,
				  vehicle_kind, vehicle_id, odometer_start_km, odometer_end_km, driven_distance_km)
				 select id, organization_id, work_category_id, work_location_type,
				  vehicle_kind, vehicle_id, odometer_start_km, odometer_end_km, driven_distance_km
				 from work_period where id = $1`,
				[workPeriodId],
			);
			await client.query(
				`insert into time_record_allocation
				 (organization_id, record_id, allocation_kind, project_id, task_id, weight_percent, is_billable)
				 select organization_id, id, 'project', project_id, task_id, 100, is_billable
				 from work_period where id = $1 and project_id is not null`,
				[workPeriodId],
			);
			await client.query("update work_period set canonical_record_id = id where id = $1", [
				workPeriodId,
			]);
		});
		return workPeriodId;
	}

	/** The findings, without the fixture's clock entries disclosing an inferred capture zone. */
	async function findings(seeded: Seeded): Promise<WorkFinding[]> {
		const read = await readHistoricalWorkDiagnostics(db, seeded.org.organizationId, {
			employeeIds: [seeded.person.employeeId],
			range: calendarDateEnvelope("2026-06-01", "2026-07-31"),
		});
		return read.work.findings.filter((finding) => finding.kind !== "capture_inferred");
	}

	it("reports each divergent pair with the facet the record agreement rule finds", async () => {
		const seeded = await organizationWithReferences();
		const { project, otherProject, task, category, otherCategory } = seeded.refs;
		const divergences: [string, string, Parameters<typeof agreeingPair>[2], string][] = [
			[
				"interval",
				"2026-07-01",
				{},
				"update time_record set start_at = start_at + interval '30 minutes'",
			],
			["duration", "2026-07-02", {}, "update time_record set duration_minutes = 470"],
			["approval_state", "2026-07-03", {}, "update time_record set approval_state = 'rejected'"],
			[
				"project",
				"2026-07-06",
				{ projectId: project },
				`update time_record_allocation set project_id = '${otherProject}'`,
			],
			[
				"task",
				"2026-07-07",
				{ projectId: project, taskId: task },
				"update time_record_allocation set task_id = null",
			],
			[
				"billable",
				"2026-07-08",
				{ projectId: project, isBillable: true },
				"update time_record_allocation set is_billable = false",
			],
			[
				"work_category",
				"2026-07-09",
				{ workCategoryId: category },
				`update time_record_work set work_category_id = '${otherCategory}'`,
			],
			[
				"work_location",
				"2026-07-10",
				{ workLocationType: "office" },
				"update time_record_work set work_location_type = 'home'",
			],
			[
				"vehicle_use",
				"2026-07-13",
				{ ownCarFromKm: 100 },
				"update time_record_work set odometer_start_km = 120",
			],
		];
		const periods = new Map<string, string>();
		for (const [facet, day, attribution] of divergences) {
			periods.set(facet, await agreeingPair(seeded, day, attribution));
		}
		// The copies agree before anything diverges.
		expect(await findings(seeded)).toEqual([]);
		expect((await reconcileLegacyToCanonical(seeded.org.organizationId)).divergentWorkRecords).toBe(
			0,
		);

		for (const [facet, , , update] of divergences) {
			// The canonical record shares its period's ID; detail and allocations name it.
			const key = update.startsWith("update time_record set") ? "id" : "record_id";
			await fixture.pool.query(`${update} where ${key} = $1`, [periods.get(facet)]);
		}

		const reported = await findings(seeded);
		for (const [facet] of divergences) {
			const periodFindings = reported.filter((finding) =>
				finding.workPeriodIds.includes(periods.get(facet) as string),
			);
			expect(
				periodFindings.map((finding) => finding.details.facet),
				`facets reported for the ${facet} divergence`,
			).toEqual([facet]);
		}
		expect((await reconcileLegacyToCanonical(seeded.org.organizationId)).divergentWorkRecords).toBe(
			divergences.length,
		);
	});

	it("reports, without blocking the payroll gate, work diverging only in task or vehicle use", async () => {
		const seeded = await organizationWithReferences();
		const taskOnly = await agreeingPair(seeded, "2026-07-01", {
			projectId: seeded.refs.project,
			taskId: seeded.refs.task,
		});
		const vehicleOnly = await agreeingPair(seeded, "2026-07-02", { ownCarFromKm: 100 });
		await fixture.pool.query(
			"update time_record_allocation set task_id = null where record_id = $1",
			[taskOnly],
		);
		await fixture.pool.query(
			"update time_record_work set odometer_start_km = 120 where record_id = $1",
			[vehicleOnly],
		);

		// Enforcement waits until production shows no divergence (#1228).
		await expect(assertCanonicalCutoverReady(seeded.org.organizationId)).resolves.toBeUndefined();
		expect(await reconcileLegacyToCanonical(seeded.org.organizationId)).toMatchObject({
			divergentWorkRecords: 2,
			blockingMismatchCount: 0,
		});
		expect(
			(await findings(seeded)).map((finding) => [finding.workPeriodIds[0], finding.details.facet]),
		).toEqual(
			expect.arrayContaining([
				[taskOnly, "task"],
				[vehicleOnly, "vehicle_use"],
			]),
		);
	});

	it("reports completed work without a canonical record in a closed month apart from the rest", async () => {
		const seeded = await organizationWithReferences();
		const work = (start: string, end: string) =>
			fixture.work({
				organizationId: seeded.org.organizationId,
				employeeId: seeded.person.employeeId,
				userId: seeded.person.userId,
				start,
				end,
				canonical: "history",
			});
		const june = await work("2026-06-10T08:00:00Z", "2026-06-10T16:00:00Z");
		const july = await work("2026-07-07T08:00:00Z", "2026-07-07T16:00:00Z");
		const closed = await closeMonth(fixture.db, {
			organizationId: seeded.org.organizationId,
			month: "2026-06",
			scope: { kind: "organization" },
			actor: { kind: "user", userId: seeded.org.ownerUserId },
			now: parseInstant("2026-07-15T12:00:00Z"),
		});
		expect(closed.kind).toBe("closed");

		const reported = await findings(seeded);

		expect(
			reported
				.filter((finding) => finding.kind.startsWith("canonical_missing"))
				.map((finding) => [finding.kind, finding.workPeriodIds, finding.details]),
		).toEqual([
			["canonical_missing", [july.workPeriodId], {}],
			["canonical_missing_closed_month", [june.workPeriodId], { closedMonth: "2026-06" }],
		]);
		// The closed month keeps its half pair until reopened; only the open one is missing.
		expect(await reconcileLegacyToCanonical(seeded.org.organizationId)).toMatchObject({
			missingWorkCanonicalRecords: 1,
			divergentWorkRecords: 0,
		});
	});

	it("reports only the closed month's half pairs after a backfill run (#1224)", async () => {
		const seeded = await organizationWithReferences();
		const work = (day: string) =>
			fixture.work({
				organizationId: seeded.org.organizationId,
				employeeId: seeded.person.employeeId,
				userId: seeded.person.userId,
				start: `${day}T08:00:00Z`,
				end: `${day}T16:00:00Z`,
				canonical: "history",
			});
		const june = await work("2026-06-10");
		await work("2026-07-07");
		const drove = await work("2026-07-08");
		// Full work attribution, vehicle use included, written as history.
		await asHistory(fixture.pool, (client) =>
			client.query(
				`update work_period set project_id = $2, task_id = $3, is_billable = true,
				  work_category_id = $4, work_location_type = 'office', vehicle_kind = 'own',
				  odometer_start_km = 100, odometer_end_km = 130, driven_distance_km = 30
				 where id = $1`,
				[drove.workPeriodId, seeded.refs.project, seeded.refs.task, seeded.refs.category],
			),
		);
		expect(
			await closeMonth(fixture.db, {
				organizationId: seeded.org.organizationId,
				month: "2026-06",
				scope: { kind: "organization" },
				actor: { kind: "user", userId: seeded.org.ownerUserId },
				now: parseInstant("2026-07-15T12:00:00Z"),
			}),
		).toMatchObject({ kind: "closed" });

		const backfill = await runCanonicalBackfill({
			organizationId: seeded.org.organizationId,
			actorId: seeded.org.ownerUserId,
		});

		expect(backfill.work).toMatchObject({
			closedMonthSkips: [{ workPeriodId: june.workPeriodId, month: "2026-06" }],
			refused: [],
		});
		expect(backfill.work.attached).toHaveLength(2);
		expect(
			(await findings(seeded)).map((finding) => [finding.kind, finding.workPeriodIds]),
		).toEqual([["canonical_missing_closed_month", [june.workPeriodId]]]);
		expect(await reconcileLegacyToCanonical(seeded.org.organizationId)).toMatchObject({
			blockingMismatchCount: 0,
			divergentWorkRecords: 0,
		});
	});
});
