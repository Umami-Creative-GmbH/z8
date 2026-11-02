/**
 * #1509 (spec #1358, ADR 0014): a kiosk fob follows the employee lifecycle.
 * The departure ends it at its cutoff (never at the time a delayed worker
 * runs), a rehire never revives it, and its rows go with the employee's and
 * the organization's data. Driven through the public departure and rehire
 * commands; the fob is observed through `resolveActiveKioskFob` (what kiosks
 * read) and its stored rows.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Instant, parseInstant } from "@/lib/datetime/temporal-core";
import { runOrganizationCleanup } from "@/lib/jobs/organization-cleanup";
import { registerKioskFob, resolveActiveKioskFob } from "@/lib/time-tracking/kiosk/fob-store";
import { createDepartureCommands } from "./commands";
import {
	createLifecycleDatabaseFixture,
	type LifecycleDatabaseFixture,
	type SeededEmployee,
} from "./testing/database.test.fixture";
import type { DepartureClockOutPort, LifecycleActor } from "./types";

const clockOut: DepartureClockOutPort = {
	async close() {
		return { kind: "not_running" };
	},
};

/** A distinct 7-byte serial number per call, as a reader would type it. */
let serials = 0;
function newSerial(): string {
	serials += 1;
	return `04A1B2C3D4${serials.toString(16).toUpperCase().padStart(4, "0")}`;
}

describe("kiosk fobs across departure, rehire and data deletion", () => {
	let fixture: LifecycleDatabaseFixture;
	let now: Instant = parseInstant("2026-09-14T08:00:00Z");
	const clock = { nowInstant: () => now };
	const kiosks = new Map<string, string>();

	beforeAll(async () => {
		fixture = await createLifecycleDatabaseFixture();
	});

	afterAll(async () => {
		await fixture?.close();
	});

	function commands() {
		return createDepartureCommands({ db: fixture.db, clock, clockOut });
	}

	function owner(): LifecycleActor {
		return { userId: fixture.ownerUserId, organizationId: fixture.organizationId };
	}

	/** The organization's kiosk the fobs are registered at, seeded once per organization. */
	async function kioskOf(organizationId: string): Promise<string> {
		const known = kiosks.get(organizationId);
		if (known) return known;
		const location = randomUUID();
		const kiosk = randomUUID();
		await fixture.pool.query(
			`insert into location (id, organization_id, name, created_by, updated_at)
			 values ($1, $2, 'Store', $3, now())`,
			[location, organizationId, fixture.ownerUserId],
		);
		await fixture.pool.query(
			`insert into kiosk (id, organization_id, location_id, name, timezone, updated_at)
			 values ($1, $2, $3, 'Front door', 'Europe/Berlin', now())`,
			[kiosk, organizationId, location],
		);
		kiosks.set(organizationId, kiosk);
		return kiosk;
	}

	async function register(
		employee: SeededEmployee,
		serial: string,
		organizationId = fixture.organizationId,
	) {
		return registerKioskFob(
			fixture.db,
			{
				organizationId,
				kioskId: await kioskOf(organizationId),
				employeeId: employee.employeeId,
				serial,
			},
			clock,
		);
	}

	/** Whose fob the serial number selects at `at`, as a kiosk would read it. */
	async function holder(
		serial: string,
		at: Instant = now,
		organizationId = fixture.organizationId,
	) {
		const fob = await resolveActiveKioskFob(fixture.db, { organizationId, serial, now: at });
		return fob?.employeeId ?? null;
	}

	async function fobRows(employeeId: string) {
		const { rows } = await fixture.pool.query<{
			id: string;
			employment_period_id: string;
			serial_number: string;
			ended_at: Date | null;
			ended_reason: string | null;
			ended_by_user_id: string | null;
		}>(
			`select id, employment_period_id, serial_number, ended_at, ended_reason, ended_by_user_id
			 from employee_kiosk_fob where employee_id = $1 order by registered_at, id`,
			[employeeId],
		);
		return rows;
	}

	async function fobAudits(employeeId: string) {
		const { rows } = await fixture.pool.query<{
			action: string;
			performed_by: string;
			entity_id: string;
			metadata: string | null;
		}>(
			`select action, performed_by, entity_id, metadata from audit_log
			 where organization_id = $1 and employee_id = $2 and entity_type = 'kiosk_fob'
			 order by timestamp, action`,
			[fixture.organizationId, employeeId],
		);
		return rows.map((row) => ({
			action: row.action,
			performedBy: row.performed_by,
			fobId: row.entity_id,
			metadata: row.metadata ? JSON.parse(row.metadata) : null,
		}));
	}

	async function offboardNow(employee: SeededEmployee, at = "2026-09-14T09:30:00Z") {
		now = parseInstant(at);
		await commands().offboardNow(owner(), {
			employeeId: employee.employeeId,
			requestId: randomUUID(),
			replacementEmployeeId: null,
			acknowledgeUnassignedDuties: true,
		});
		const departure = await fixture.pool.query<{ id: string; status: string }>(
			"select id, status from employee_departure where employee_id = $1 order by created_at desc limit 1",
			[employee.employeeId],
		);
		expect(departure.rows[0]?.status).toBe("effective");
		return departure.rows[0]?.id ?? "";
	}

	async function schedule(
		employee: SeededEmployee,
		lastWorkingDay: string,
		expectedRevision = null as number | null,
	) {
		return commands().scheduleDeparture(owner(), {
			employeeId: employee.employeeId,
			requestId: randomUUID(),
			expectedRevision,
			lastWorkingDay,
			replacementEmployeeId: null,
			acknowledgeUnassignedDuties: true,
		});
	}

	function identityOf(
		employee: SeededEmployee,
		scheduled: { departureId: string; revision: number },
	) {
		return {
			organizationId: fixture.organizationId,
			employeeId: employee.employeeId,
			employmentPeriodId: employee.employmentPeriodId,
			departureId: scheduled.departureId,
			revision: scheduled.revision,
		};
	}

	async function rehire(employee: SeededEmployee): Promise<string> {
		const policy = await fixture.pool.query<{ id: string }>(
			`insert into work_policy (organization_id, name, created_by, updated_at)
			 values ($1, $2, $3, now()) returning id`,
			[fixture.organizationId, `Policy ${randomUUID()}`, fixture.ownerUserId],
		);
		const result = await commands().rehireEmployee(owner(), {
			employeeId: employee.employeeId,
			requestId: randomUUID(),
			previousEmploymentPeriodId: employee.employmentPeriodId,
			role: "employee",
			teamId: null,
			primaryManagerId: fixture.ownerEmployeeId,
			workPolicyId: policy.rows[0]?.id ?? "",
			weeklyContractMinutes: 2400,
			contractType: "fixed",
			workModel: "onsite",
			hourlyRate: null,
			currency: "EUR",
			probationStartsOn: null,
			probationEndsOn: null,
			changeReason: "Returning",
		});
		return result.employmentPeriodId;
	}

	it("ends the fob inside the departure transaction at the cutoff, as departure, audited under the departure", async () => {
		const worker = await fixture.seedEmployee();
		const serial = newSerial();
		now = parseInstant("2026-09-14T08:00:00Z");
		await register(worker, serial);
		expect(await holder(serial)).toBe(worker.employeeId);

		const departureId = await offboardNow(worker);

		expect(await holder(serial)).toBeNull();
		const [fob] = await fobRows(worker.employeeId);
		expect(fob).toMatchObject({
			employment_period_id: worker.employmentPeriodId,
			ended_at: new Date("2026-09-14T09:30:00Z"),
			ended_reason: "departure",
			ended_by_user_id: fixture.ownerUserId,
		});
		const audits = await fobAudits(worker.employeeId);
		expect(audits.map((audit) => audit.action)).toEqual([
			"kiosk_fob.registered",
			"kiosk_fob.ended",
		]);
		expect(audits[1]).toEqual({
			action: "kiosk_fob.ended",
			performedBy: fixture.ownerUserId,
			fobId: fob?.id,
			metadata: {
				reason: "departure",
				departureId,
				employmentPeriodId: worker.employmentPeriodId,
			},
		});
		expect(JSON.stringify(audits)).not.toContain(serial);
	});

	it("keeps the fob working until a future cutoff in the organization's zone, denies it from then on and records the cutoff, not the late run", async () => {
		const original = await fixture.pool.query<{ timezone: string | null }>(
			"select timezone from organization where id = $1",
			[fixture.organizationId],
		);
		await fixture.pool.query("update organization set timezone = 'Europe/Berlin' where id = $1", [
			fixture.organizationId,
		]);
		try {
			const worker = await fixture.seedEmployee();
			const serial = newSerial();
			now = parseInstant("2026-09-14T08:00:00Z");
			await register(worker, serial);
			const scheduled = await schedule(worker, "2026-09-30");
			// Midnight after the last working day in Berlin, not in UTC or the viewer's zone.
			const cutoff = parseInstant("2026-09-30T22:00:00Z");

			// Scheduling ends nothing early.
			expect((await fobRows(worker.employeeId))[0]?.ended_at).toBeNull();
			expect(await holder(serial)).toBe(worker.employeeId);
			expect(await holder(serial, parseInstant("2026-09-30T21:59:59.999Z"))).toBe(
				worker.employeeId,
			);
			expect(await commands().executeDeparture(identityOf(worker, scheduled))).toEqual({
				status: "not_due",
			});
			expect((await fobRows(worker.employeeId))[0]?.ended_at).toBeNull();

			// The worker is late: nothing processed the departure yet, kiosks already refuse.
			now = cutoff;
			expect(await holder(serial)).toBeNull();

			now = parseInstant("2026-10-03T11:00:00Z");
			expect(await commands().executeDeparture(identityOf(worker, scheduled))).toMatchObject({
				status: "effective",
			});
			expect(await holder(serial)).toBeNull();
			expect(await fobRows(worker.employeeId)).toEqual([
				expect.objectContaining({
					ended_at: new Date(cutoff.epochMilliseconds),
					ended_reason: "departure",
				}),
			]);
		} finally {
			await fixture.pool.query("update organization set timezone = $2 where id = $1", [
				fixture.organizationId,
				original.rows[0]?.timezone ?? null,
			]);
		}
	});

	it("follows the current revision: an edited or cancelled departure does not end the fob early", async () => {
		const edited = await fixture.seedEmployee();
		const cancelled = await fixture.seedEmployee();
		const editedSerial = newSerial();
		const cancelledSerial = newSerial();
		now = parseInstant("2026-09-14T08:00:00Z");
		await register(edited, editedSerial);
		await register(cancelled, cancelledSerial);
		const first = await schedule(edited, "2026-09-20");
		const moved = await schedule(edited, "2026-10-20", first.revision);
		const doomed = await schedule(cancelled, "2026-09-20");
		await commands().cancelDeparture(owner(), {
			employeeId: cancelled.employeeId,
			departureId: doomed.departureId,
			requestId: randomUUID(),
			expectedRevision: doomed.revision,
		});

		now = parseInstant("2026-09-25T08:00:00Z");
		expect(await commands().executeDeparture(identityOf(edited, first))).toEqual({
			status: "obsolete",
		});
		expect(await commands().executeDeparture(identityOf(cancelled, doomed))).toEqual({
			status: "obsolete",
		});
		expect(await holder(editedSerial)).toBe(edited.employeeId);
		expect(await holder(cancelledSerial)).toBe(cancelled.employeeId);

		now = parseInstant("2026-10-21T00:00:00Z");
		expect(await holder(editedSerial)).toBeNull();
		expect(await commands().executeDeparture(identityOf(edited, moved))).toMatchObject({
			status: "effective",
		});
		expect((await fobRows(edited.employeeId))[0]?.ended_reason).toBe("departure");
		expect(await holder(cancelledSerial)).toBe(cancelled.employeeId);
		expect((await fobRows(cancelled.employeeId))[0]?.ended_at).toBeNull();
	});

	it("never revives the old fob on rehire, even after delayed processing, until the employee registers it again", async () => {
		const worker = await fixture.seedEmployee();
		const serial = newSerial();
		now = parseInstant("2026-09-14T08:00:00Z");
		await register(worker, serial);
		await schedule(worker, "2026-09-30");

		// No worker ran the departure; the rehire command processes it first.
		now = parseInstant("2026-11-02T08:00:00Z");
		expect(await holder(serial)).toBeNull();
		const newPeriodId = await rehire(worker);
		expect(newPeriodId).not.toBe(worker.employmentPeriodId);

		expect(await holder(serial)).toBeNull();
		const [old] = await fobRows(worker.employeeId);
		expect(old).toMatchObject({
			employment_period_id: worker.employmentPeriodId,
			ended_at: new Date("2026-10-01T00:00:00Z"),
			ended_reason: "departure",
		});

		// Registering the same card again links it anew, to the new employment.
		const again = await register(worker, serial);
		expect(again).toMatchObject({ outcome: "registered", replacedFobId: null });
		expect(
			await resolveActiveKioskFob(fixture.db, {
				organizationId: fixture.organizationId,
				serial,
				now,
			}),
		).toEqual({
			fobId: again.fobId,
			employeeId: worker.employeeId,
			employmentPeriodId: newPeriodId,
		});
		// The old link stays ended as it was.
		expect(await fobRows(worker.employeeId)).toEqual([
			old,
			expect.objectContaining({
				id: again.fobId,
				ended_at: null,
				employment_period_id: newPeriodId,
			}),
		]);
	});

	it("lets no retry of the old departure end a fob of the new employment", async () => {
		const worker = await fixture.seedEmployee();
		now = parseInstant("2026-09-14T08:00:00Z");
		await register(worker, newSerial());
		const scheduled = await schedule(worker, "2026-09-30");
		now = parseInstant("2026-10-02T08:00:00Z");
		await commands().executeDeparture(identityOf(worker, scheduled));
		now = parseInstant("2026-11-02T08:00:00Z");
		await rehire(worker);
		const fresh = newSerial();
		await register(worker, fresh);

		const retries = await Promise.all(
			Array.from({ length: 3 }, () => commands().executeDeparture(identityOf(worker, scheduled))),
		);

		expect(retries).toEqual(Array.from({ length: 3 }, () => ({ status: "obsolete" })));
		expect(await holder(fresh)).toBe(worker.employeeId);
		expect((await fobAudits(worker.employeeId)).map((audit) => audit.action)).toEqual([
			"kiosk_fob.registered",
			"kiosk_fob.ended",
			"kiosk_fob.registered",
		]);
	});

	it("lets a colleague register the card once the departure ended it", async () => {
		const leaver = await fixture.seedEmployee();
		const colleague = await fixture.seedEmployee();
		const serial = newSerial();
		now = parseInstant("2026-09-14T08:00:00Z");
		await register(leaver, serial);
		await offboardNow(leaver);

		const taken = await register(colleague, serial);

		expect(taken.outcome).toBe("registered");
		expect(await holder(serial)).toBe(colleague.employeeId);
		expect((await fobRows(leaver.employeeId))[0]).toMatchObject({ ended_reason: "departure" });
	});

	it("ends only the departing employee's fob, in their organization", async () => {
		const leaver = await fixture.seedEmployee();
		const colleague = await fixture.seedEmployee();
		const otherOrganizationId = await fixture.createOrganization();
		const elsewhere = await fixture.seedEmployee({ organizationId: otherOrganizationId });
		const leaverSerial = newSerial();
		const colleagueSerial = newSerial();
		now = parseInstant("2026-09-14T08:00:00Z");
		await register(leaver, leaverSerial);
		await register(colleague, colleagueSerial);
		// The same card in another organization is another link.
		await register(elsewhere, leaverSerial, otherOrganizationId);

		await offboardNow(leaver);

		expect(await holder(leaverSerial)).toBeNull();
		expect(await holder(colleagueSerial)).toBe(colleague.employeeId);
		expect(await holder(leaverSerial, now, otherOrganizationId)).toBe(elsewhere.employeeId);
		expect((await fobRows(colleague.employeeId))[0]?.ended_at).toBeNull();
		expect((await fobRows(elsewhere.employeeId))[0]?.ended_at).toBeNull();
	});

	it("deletes the employee's fob rows with the employee's data, and nobody else's", async () => {
		const leaving = await fixture.seedEmployee();
		const colleague = await fixture.seedEmployee();
		const otherOrganizationId = await fixture.createOrganization();
		const elsewhere = await fixture.seedEmployee({ organizationId: otherOrganizationId });
		const serial = newSerial();
		now = parseInstant("2026-09-14T08:00:00Z");
		await register(leaving, newSerial());
		await register(leaving, serial);
		await register(colleague, newSerial());
		await register(elsewhere, serial, otherOrganizationId);
		expect(await fobRows(leaving.employeeId)).toHaveLength(2);

		// Their employee record goes, as the demo reset deletes it (audit entries
		// kept, detached); its rows cascade.
		await fixture.pool.query("update audit_log set employee_id = null where employee_id = $1", [
			leaving.employeeId,
		]);
		await fixture.pool.query("delete from employee where id = $1 and organization_id = $2", [
			leaving.employeeId,
			fixture.organizationId,
		]);

		expect(await fobRows(leaving.employeeId)).toEqual([]);
		expect(await fobRows(colleague.employeeId)).toHaveLength(1);
		expect(await holder(serial, now, otherOrganizationId)).toBe(elsewhere.employeeId);
	});

	it("deletes every fob row of a permanently deleted organization", async () => {
		const deletedOrganizationId = await fixture.createOrganization();
		const person = await fixture.seedEmployee({ organizationId: deletedOrganizationId });
		const serial = newSerial();
		now = parseInstant("2026-09-14T08:00:00Z");
		await register(person, newSerial(), deletedOrganizationId);
		await register(person, serial, deletedOrganizationId);
		const kept = await fixture.seedEmployee();
		await register(kept, serial);

		await fixture.pool.query(
			"update organization set deleted_at = now() - interval '6 days' where id = $1",
			[deletedOrganizationId],
		);
		const deleted = await runOrganizationCleanup();

		expect(deleted.errors).toEqual([]);
		const { rows } = await fixture.pool.query(
			"select 1 from employee_kiosk_fob where organization_id = $1",
			[deletedOrganizationId],
		);
		expect(rows).toHaveLength(0);
		expect(await holder(serial)).toBe(kept.employeeId);
	});
});
