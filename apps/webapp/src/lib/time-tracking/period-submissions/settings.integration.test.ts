import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseInstant } from "@/lib/datetime/temporal-core";
import {
	createLifecycleDatabaseFixture,
	type LifecycleDatabaseFixture,
} from "@/lib/employee-lifecycle/testing/database.test.fixture";
import {
	loadPeriodSubmissionSettings,
	loadSubmissionCadenceHistory,
	savePeriodSubmissionSettings,
} from "./settings";

const clockAt = (value: string) => ({ nowInstant: () => parseInstant(value) });

describe("period submission settings on PostgreSQL", () => {
	let fixture: LifecycleDatabaseFixture;
	beforeAll(async () => {
		fixture = await createLifecycleDatabaseFixture();
	});
	afterAll(async () => {
		await fixture?.close();
	});

	it("reads the cadence as off for an organization that never saved settings", async () => {
		const organizationId = await fixture.createOrganization();
		expect(
			await loadPeriodSubmissionSettings(fixture.db, organizationId, {
				clock: clockAt("2026-03-04T10:00:00Z"),
			}),
		).toEqual({
			cadence: { kind: "off" },
			inEffect: { kind: "off" },
			upcoming: null,
			secondReminderDelayDays: 3,
			revision: 0,
		});
		expect(await loadSubmissionCadenceHistory(fixture.db, organizationId)).toEqual([]);
	});

	it("saves one organization's cadence without affecting another", async () => {
		const first = await fixture.createOrganization();
		const second = await fixture.createOrganization();
		const saved = await savePeriodSubmissionSettings(
			{
				organizationId: first,
				actorUserId: fixture.ownerUserId,
				cadence: { kind: "weekly", weekStartDay: "monday" },
				secondReminderDelayDays: 5,
			},
			{ database: fixture.db, clock: clockAt("2026-03-04T10:00:00Z") },
		);
		expect(saved).toEqual({
			cadence: { kind: "weekly", weekStartDay: "monday" },
			inEffect: { kind: "off" },
			upcoming: {
				cadence: { kind: "weekly", weekStartDay: "monday" },
				fromDate: "2026-03-09",
			},
			secondReminderDelayDays: 5,
			revision: 1,
		});
		expect(
			await loadPeriodSubmissionSettings(fixture.db, first, {
				clock: clockAt("2026-03-10T10:00:00Z"),
			}),
		).toMatchObject({ inEffect: { kind: "weekly", weekStartDay: "monday" }, upcoming: null });
		expect(await loadSubmissionCadenceHistory(fixture.db, first)).toEqual([
			{
				cadence: { kind: "weekly", weekStartDay: "monday" },
				changedAt: parseInstant("2026-03-04T10:00:00Z"),
			},
		]);
		expect(
			await loadPeriodSubmissionSettings(fixture.db, second, {
				clock: clockAt("2026-03-10T10:00:00Z"),
			}),
		).toMatchObject({ cadence: { kind: "off" }, revision: 0 });
		expect(await loadSubmissionCadenceHistory(fixture.db, second)).toEqual([]);
	});

	it("records a cadence change only when the saved cadence differs", async () => {
		const organizationId = await fixture.createOrganization();
		const save = (
			cadence: Parameters<typeof savePeriodSubmissionSettings>[0]["cadence"],
			at: string,
			delay = 3,
		) =>
			savePeriodSubmissionSettings(
				{
					organizationId,
					actorUserId: fixture.ownerUserId,
					cadence,
					secondReminderDelayDays: delay,
				},
				{ database: fixture.db, clock: clockAt(at) },
			);
		await save({ kind: "monthly" }, "2026-01-15T09:00:00Z");
		const delayOnly = await save({ kind: "monthly" }, "2026-01-20T09:00:00Z", 7);
		expect(delayOnly).toMatchObject({ secondReminderDelayDays: 7, revision: 2 });
		const switchedOff = await save({ kind: "off" }, "2026-02-10T09:00:00Z", 7);
		expect(switchedOff).toMatchObject({
			cadence: { kind: "off" },
			inEffect: { kind: "monthly" },
			upcoming: { cadence: { kind: "off" }, fromDate: "2026-03-01" },
			revision: 3,
		});
		expect(
			(await loadSubmissionCadenceHistory(fixture.db, organizationId)).map(
				(change) => change.cadence.kind,
			),
		).toEqual(["monthly", "off"]);
	});
});
