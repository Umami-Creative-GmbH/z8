import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseInstant } from "@/lib/datetime/temporal-core";
import {
	createLifecycleDatabaseFixture,
	type LifecycleDatabaseFixture,
} from "@/lib/employee-lifecycle/testing/database.test.fixture";
import { loadClockingReminderSettings, saveClockingReminderSettings } from "./settings";

const clock = { nowInstant: () => parseInstant("2026-10-03T12:00:00Z") };

describe("clocking reminder settings on PostgreSQL", () => {
	let fixture: LifecycleDatabaseFixture;
	beforeAll(async () => {
		fixture = await createLifecycleDatabaseFixture();
	});
	afterAll(async () => {
		await fixture?.close();
	});

	it("reads every reminder as off for an organization that never saved settings", async () => {
		expect(
			await loadClockingReminderSettings(fixture.db, await fixture.createOrganization()),
		).toEqual({
			missedClockIn: { enabled: false, graceMinutes: 15 },
			forgottenClockOut: { enabled: false, graceMinutes: 30 },
			breakDue: { enabled: false, leadMinutes: 15 },
			roles: ["admin", "manager", "employee"],
			revision: 0,
		});
	});

	it("saves one organization's settings without affecting another", async () => {
		const first = await fixture.createOrganization();
		const second = await fixture.createOrganization();
		const saved = await saveClockingReminderSettings(
			{
				organizationId: first,
				missedClockIn: { enabled: true, graceMinutes: 5 },
				forgottenClockOut: { enabled: true, graceMinutes: 45 },
				breakDue: { enabled: true, leadMinutes: 20 },
				roles: ["employee"],
			},
			{ database: fixture.db, clock },
		);
		expect(saved).toEqual({
			missedClockIn: { enabled: true, graceMinutes: 5 },
			forgottenClockOut: { enabled: true, graceMinutes: 45 },
			breakDue: { enabled: true, leadMinutes: 20 },
			roles: ["employee"],
			revision: 1,
		});
		expect(await loadClockingReminderSettings(fixture.db, first)).toEqual(saved);
		expect((await loadClockingReminderSettings(fixture.db, second)).revision).toBe(0);

		const updated = await saveClockingReminderSettings(
			{
				organizationId: first,
				missedClockIn: { enabled: false, graceMinutes: 5 },
				forgottenClockOut: { enabled: true, graceMinutes: 45 },
				breakDue: { enabled: false, leadMinutes: 20 },
				roles: ["admin", "manager"],
			},
			{ database: fixture.db, clock },
		);
		expect(updated).toMatchObject({ roles: ["admin", "manager"], revision: 2 });
		expect(updated.missedClockIn.enabled).toBe(false);
	});
});
