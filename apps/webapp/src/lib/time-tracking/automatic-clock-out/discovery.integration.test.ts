import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseInstant } from "@/lib/datetime/temporal-core";
import { createLifecycleDatabaseFixture } from "@/lib/employee-lifecycle/testing/database.test.fixture";
import { createClockingService, createDatabaseClockingStore } from "../clocking-core";
import { listDueAutoClockOutCandidates } from "./discovery";
import type { AutoClockOutCandidate } from "./types";

const now = parseInstant("2026-10-25T06:00:00Z");
describe("automatic clock-out discovery", () => {
	let fixture: Awaited<ReturnType<typeof createLifecycleDatabaseFixture>>;
	beforeAll(async () => {
		fixture = await createLifecycleDatabaseFixture();
	});
	afterAll(async () => {
		await fixture?.close();
	});
	async function seed(
		start: string,
		options: {
			enabled?: boolean;
			minutes?: number;
			deletedOrg?: boolean;
			deletedPeriod?: boolean;
			completed?: boolean;
		} = {},
	) {
		const organizationId = await fixture.createOrganization();
		const employee = await fixture.seedEmployee({ organizationId });
		const service = createClockingService({
			transaction: (body) => fixture.db.transaction((tx) => body(createDatabaseClockingStore(tx))),
		});
		const opened = await service.clockIn({
			organizationId,
			employeeId: employee.employeeId,
			createdBy: employee.userId,
			action: {
				instant: parseInstant(start),
				timezone: "UTC",
				utcOffsetMinutes: 0,
				timezoneSource: "user_setting",
			},
			source: { deviceInfo: "test", ipAddress: null },
			workLocationType: "office",
		});
		if (!("period" in opened)) throw new Error("Expected live work");
		if (options.enabled !== undefined || options.minutes !== undefined)
			await fixture.pool.query(
				"insert into organization_time_tracking_settings (organization_id, auto_clock_out_enabled, max_uninterrupted_minutes) values ($1, $2, $3)",
				[organizationId, options.enabled ?? true, options.minutes ?? 720],
			);
		if (options.deletedOrg)
			await fixture.pool.query("update organization set deleted_at = now() where id = $1", [
				organizationId,
			]);
		if (options.deletedPeriod)
			await fixture.pool.query(
				"update work_period set deleted_at = now() where organization_id = $1 and id = $2",
				[organizationId, opened.period.id],
			);
		if (options.completed)
			await service.clockOut({
				organizationId,
				employeeId: employee.employeeId,
				createdBy: employee.userId,
				action: {
					instant: now.add({ minutes: 10 }),
					timezone: "UTC",
					utcOffsetMinutes: 0,
					timezoneSource: "user_setting",
				},
				source: { deviceInfo: "test", ipAddress: null },
			});
		return { organizationId, employeeId: employee.employeeId, workPeriodId: opened.period.id };
	}
	it("includes previous-day default work at equality and custom durations, omitting nonlive/deleted/disabled work", async () => {
		const due = [
			await seed("2026-10-24T18:00:00Z"),
			await seed("2026-10-24T22:00:00Z", { minutes: 480 }),
		];
		const omitted = [
			await seed("2026-10-24T18:00:01Z"),
			await seed("2026-10-24T12:00:00Z", { enabled: false }),
			await seed("2026-10-24T12:00:00Z", { deletedOrg: true }),
			await seed("2026-10-24T12:00:00Z", { deletedPeriod: true }),
			await seed("2026-10-24T12:00:00Z", { completed: true }),
		];
		const rows = await listDueAutoClockOutCandidates({ now, after: null, limit: 1000 }, fixture.db);
		for (const item of due) expect(rows).toContainEqual(item);
		for (const item of omitted) expect(rows).not.toContainEqual(item);
	});
	it("paginates exclusively and lexicographically without losing candidates", async () => {
		await seed("2026-10-23T18:00:00Z");
		const all = await listDueAutoClockOutCandidates({ now, after: null, limit: 1000 }, fixture.db);
		const paged: AutoClockOutCandidate[] = [];
		let after: AutoClockOutCandidate | null = null;
		for (;;) {
			const page = await listDueAutoClockOutCandidates({ now, after, limit: 1 }, fixture.db);
			if (!page.length) break;
			paged.push(...page);
			after = page[0];
		}
		expect(paged).toEqual(all);
		expect(all).toEqual(
			[...all].sort((a, b) =>
				`${a.organizationId}/${a.employeeId}/${a.workPeriodId}`.localeCompare(
					`${b.organizationId}/${b.employeeId}/${b.workPeriodId}`,
				),
			),
		);
	});
	it("compares canonical UTC instants independently of the database session timezone", async () => {
		const candidate = await seed("2026-10-24T18:00:00Z");
		const connection = await fixture.openCrashableConnection();
		try {
			await connection.db.execute(sql`set time zone 'America/New_York'`);
			expect(
				await listDueAutoClockOutCandidates({ now, after: null, limit: 1000 }, connection.db),
			).toContainEqual(candidate);
		} finally {
			await connection.close();
		}
	});
});
