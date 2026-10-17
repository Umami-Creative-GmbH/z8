/**
 * #1365 (spec #889, ADR 0012): a kiosk badge ends with the employee's
 * departure. Driven through the public departure and rehire commands; the
 * badge is observed only through its public contract, `resolveActiveKioskBadge`
 * (what kiosks verify) and `readKioskBadgeStatus` (what managers see).
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Instant, parseInstant } from "@/lib/datetime/temporal-core";
import {
	issueKioskBadge,
	readKioskBadgeStatus,
	resolveActiveKioskBadge,
} from "@/lib/time-tracking/kiosk/badge-store";
import { issueKioskPin, readKioskPinStatus } from "@/lib/time-tracking/kiosk/pin-store";
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

describe("kiosk badges across departure and rehire", () => {
	let fixture: LifecycleDatabaseFixture;
	let now: Instant = parseInstant("2026-09-14T08:00:00Z");
	const clock = { nowInstant: () => now };

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

	function manage(employeeId: string, organizationId = fixture.organizationId) {
		return { organizationId, actorUserId: fixture.ownerUserId, employeeId };
	}

	/** Issues a badge and returns the credential its QR code would carry. */
	async function issueBadge(employeeId: string): Promise<string> {
		const issued = await issueKioskBadge(
			fixture.db,
			manage(employeeId),
			async ({ credential }) => credential,
			clock,
		);
		return issued.delivery;
	}

	/** Whose badge the credential is at `at`, as a kiosk would verify it. */
	async function holder(credential: string, at: Instant = now) {
		const badge = await resolveActiveKioskBadge(fixture.db, {
			organizationId: fixture.organizationId,
			credential,
			now: at,
		});
		return badge?.employeeId ?? null;
	}

	function status(employeeId: string) {
		return readKioskBadgeStatus(fixture.db, manage(employeeId), clock);
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

	async function badgeAudits(employeeId: string) {
		const result = await fixture.pool.query<{
			action: string;
			performed_by: string;
			entity_id: string;
			metadata: string | null;
		}>(
			`select action, performed_by, entity_id, metadata from audit_log
			 where organization_id = $1 and employee_id = $2 and entity_type = 'kiosk_badge'
			 order by timestamp, action`,
			[fixture.organizationId, employeeId],
		);
		return result.rows.map((row) => ({
			action: row.action,
			performedBy: row.performed_by,
			badgeId: row.entity_id,
			metadata: row.metadata ? JSON.parse(row.metadata) : null,
		}));
	}

	it("revokes the badge inside the departure transaction, audited under the departure", async () => {
		const worker = await fixture.seedEmployee();
		now = parseInstant("2026-09-14T08:00:00Z");
		const credential = await issueBadge(worker.employeeId);
		expect(await holder(credential)).toBe(worker.employeeId);
		await issueKioskPin(fixture.db, manage(worker.employeeId));

		const departureId = await offboardNow(worker);

		// The kiosk PIN keeps its own lifecycle: the departure leaves it in place.
		expect(await readKioskPinStatus(fixture.db, manage(worker.employeeId))).toMatchObject({
			hasPin: true,
		});
		expect(await holder(credential)).toBeNull();
		expect(await status(worker.employeeId)).toEqual({
			active: null,
			lastRevoked: {
				revokedAt: parseInstant("2026-09-14T09:30:00Z"),
				reason: "employee_departure",
			},
			canIssue: false,
		});
		const audits = await badgeAudits(worker.employeeId);
		expect(audits.map((audit) => audit.action)).toEqual([
			"kiosk_badge.issued",
			"kiosk_badge.revoked",
		]);
		expect(audits[1]).toEqual({
			action: "kiosk_badge.revoked",
			performedBy: fixture.ownerUserId,
			badgeId: audits[0]?.badgeId,
			metadata: {
				reason: "employee_departure",
				departureId,
				employmentPeriodId: worker.employmentPeriodId,
			},
		});
		const stored = await fixture.pool.query(
			"select * from employee_kiosk_badge where employee_id = $1",
			[worker.employeeId],
		);
		expect(stored.rows).toEqual([
			expect.objectContaining({
				revoked_by_user_id: fixture.ownerUserId,
				revoked_reason: "employee_departure",
			}),
		]);
		const everything = JSON.stringify([stored.rows, await badgeAudits(worker.employeeId)]);
		expect(everything).not.toContain(credential);
	});

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

	it("keeps a badge until the cutoff in the organization's zone, and denies it from then on before the departure is processed", async () => {
		const original = await fixture.pool.query<{ timezone: string | null }>(
			"select timezone from organization where id = $1",
			[fixture.organizationId],
		);
		await fixture.pool.query("update organization set timezone = 'Europe/Berlin' where id = $1", [
			fixture.organizationId,
		]);
		try {
			const worker = await fixture.seedEmployee();
			now = parseInstant("2026-09-14T08:00:00Z");
			const credential = await issueBadge(worker.employeeId);
			const scheduled = await schedule(worker, "2026-09-30");
			// Midnight after the last working day in Berlin, not in UTC or the viewer's zone.
			const cutoff = parseInstant("2026-09-30T22:00:00Z");

			expect(await holder(credential)).toBe(worker.employeeId);
			expect(await holder(credential, parseInstant("2026-09-30T21:59:59.999Z"))).toBe(
				worker.employeeId,
			);
			expect(await commands().executeDeparture(identityOf(worker, scheduled))).toEqual({
				status: "not_due",
			});
			expect((await status(worker.employeeId)).active).not.toBeNull();

			// The worker is late: nothing processed the departure yet.
			now = cutoff;
			expect(await holder(credential)).toBeNull();
			expect(await status(worker.employeeId)).toEqual({
				active: null,
				lastRevoked: { revokedAt: cutoff, reason: "employee_departure" },
				canIssue: false,
			});

			now = parseInstant("2026-10-03T11:00:00Z");
			expect(await commands().executeDeparture(identityOf(worker, scheduled))).toMatchObject({
				status: "effective",
			});
			expect(await holder(credential)).toBeNull();
			expect(await status(worker.employeeId)).toEqual({
				active: null,
				lastRevoked: { revokedAt: cutoff, reason: "employee_departure" },
				canIssue: false,
			});
			expect((await badgeAudits(worker.employeeId)).at(-1)?.metadata).toEqual({
				reason: "employee_departure",
				departureId: scheduled.departureId,
				employmentPeriodId: worker.employmentPeriodId,
			});
		} finally {
			await fixture.pool.query("update organization set timezone = $2 where id = $1", [
				fixture.organizationId,
				original.rows[0]?.timezone ?? null,
			]);
		}
	});

	it("follows the current revision: an edited or cancelled departure does not end the badge early", async () => {
		const edited = await fixture.seedEmployee();
		const cancelled = await fixture.seedEmployee();
		now = parseInstant("2026-09-14T08:00:00Z");
		const editedCredential = await issueBadge(edited.employeeId);
		const cancelledCredential = await issueBadge(cancelled.employeeId);
		const first = await schedule(edited, "2026-09-20");
		const moved = await schedule(edited, "2026-10-20", first.revision);
		const doomed = await schedule(cancelled, "2026-09-20");
		await commands().cancelDeparture(owner(), {
			employeeId: cancelled.employeeId,
			departureId: doomed.departureId,
			requestId: randomUUID(),
			expectedRevision: doomed.revision,
		});

		// Past the first cutoff: the superseded revision and the cancelled departure end nothing.
		now = parseInstant("2026-09-25T08:00:00Z");
		expect(await commands().executeDeparture(identityOf(edited, first))).toEqual({
			status: "obsolete",
		});
		expect(await commands().executeDeparture(identityOf(cancelled, doomed))).toEqual({
			status: "obsolete",
		});
		expect(await holder(editedCredential)).toBe(edited.employeeId);
		expect(await holder(cancelledCredential)).toBe(cancelled.employeeId);
		expect((await status(edited.employeeId)).active).not.toBeNull();
		expect((await status(cancelled.employeeId)).active).not.toBeNull();

		// The edited cutoff still applies.
		now = parseInstant("2026-10-21T00:00:00Z");
		expect(await holder(editedCredential)).toBeNull();
		expect(await commands().executeDeparture(identityOf(edited, moved))).toMatchObject({
			status: "effective",
		});
		expect(await holder(cancelledCredential)).toBe(cancelled.employeeId);
	});

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

	it("never revives an old badge on rehire, even after delayed processing, and lets a new one be issued", async () => {
		const worker = await fixture.seedEmployee();
		now = parseInstant("2026-09-14T08:00:00Z");
		const old = await issueBadge(worker.employeeId);
		await schedule(worker, "2026-09-30");

		// No worker ran the departure; the rehire command processes it first.
		now = parseInstant("2026-11-02T08:00:00Z");
		expect(await holder(old)).toBeNull();
		const newPeriodId = await rehire(worker);
		expect(newPeriodId).not.toBe(worker.employmentPeriodId);

		expect(await holder(old)).toBeNull();
		expect(await status(worker.employeeId)).toEqual({
			active: null,
			lastRevoked: {
				revokedAt: parseInstant("2026-10-01T00:00:00Z"),
				reason: "employee_departure",
			},
			canIssue: true,
		});

		const fresh = await issueBadge(worker.employeeId);
		const verified = await resolveActiveKioskBadge(fixture.db, {
			organizationId: fixture.organizationId,
			credential: fresh,
			now,
		});
		expect(verified).toMatchObject({
			employeeId: worker.employeeId,
			employmentPeriodId: newPeriodId,
		});
		expect(await holder(old)).toBeNull();
		expect(await status(worker.employeeId)).toEqual({
			active: { issuedAt: now },
			lastRevoked: null,
			canIssue: true,
		});
	});

	it("lets no retry of the old departure touch a badge of the new employment, even when it races the issuance", async () => {
		const worker = await fixture.seedEmployee();
		now = parseInstant("2026-09-14T08:00:00Z");
		await issueBadge(worker.employeeId);
		const scheduled = await schedule(worker, "2026-09-30");
		now = parseInstant("2026-10-02T08:00:00Z");
		await commands().executeDeparture(identityOf(worker, scheduled));
		now = parseInstant("2026-11-02T08:00:00Z");
		await rehire(worker);

		const staleRetries = () =>
			Array.from({ length: 3 }, () => commands().executeDeparture(identityOf(worker, scheduled)));
		const [fresh, ...retries] = await Promise.all([
			issueBadge(worker.employeeId),
			...staleRetries(),
		]);
		const later = await Promise.all(staleRetries());

		expect([...retries, ...later]).toEqual(
			Array.from({ length: 6 }, () => ({ status: "obsolete" })),
		);
		expect(await holder(fresh)).toBe(worker.employeeId);
		expect((await badgeAudits(worker.employeeId)).map((audit) => audit.action)).toEqual([
			"kiosk_badge.issued",
			"kiosk_badge.revoked",
			"kiosk_badge.issued",
		]);
		const employment = await fixture.pool.query<{ status: string }>(
			"select status from employee_employment_period where employee_id = $1 order by created_at",
			[worker.employeeId],
		);
		expect(employment.rows.map((period) => period.status)).toEqual(["closed", "open"]);
	});

	it("leaves no working badge when an issuance races the departure", async () => {
		for (let round = 0; round < 4; round++) {
			const worker = await fixture.seedEmployee();
			now = parseInstant("2026-09-14T09:30:00Z");
			const [issued] = await Promise.allSettled([
				issueBadge(worker.employeeId),
				commands().offboardNow(owner(), {
					employeeId: worker.employeeId,
					requestId: randomUUID(),
					replacementEmployeeId: null,
					acknowledgeUnassignedDuties: true,
				}),
			]);

			if (issued.status === "fulfilled") {
				expect(await holder(issued.value)).toBeNull();
			} else {
				expect(issued.reason).toMatchObject({ code: "employee_inactive" });
			}
			const active = await fixture.pool.query(
				"select id from employee_kiosk_badge where employee_id = $1 and revoked_at is null",
				[worker.employeeId],
			);
			expect(active.rows).toHaveLength(0);
			expect(await status(worker.employeeId)).toMatchObject({ active: null, canIssue: false });
		}
	});

	it("ends only the departing employee's badge, in their organization", async () => {
		const leaver = await fixture.seedEmployee();
		const colleague = await fixture.seedEmployee();
		const otherOrganizationId = await fixture.createOrganization();
		now = parseInstant("2026-09-14T08:00:00Z");
		const leaverCredential = await issueBadge(leaver.employeeId);
		const colleagueCredential = await issueBadge(colleague.employeeId);

		await offboardNow(leaver);

		expect(await holder(leaverCredential)).toBeNull();
		expect(await holder(colleagueCredential)).toBe(colleague.employeeId);
		expect(
			await resolveActiveKioskBadge(fixture.db, {
				organizationId: otherOrganizationId,
				credential: colleagueCredential,
				now,
			}),
		).toBeNull();
		// The departed employee's status is not readable from another organization.
		await expect(
			readKioskBadgeStatus(fixture.db, manage(leaver.employeeId, otherOrganizationId), clock),
		).rejects.toMatchObject({ code: "employee_not_found" });
		expect(await badgeAudits(colleague.employeeId)).toHaveLength(1);
	});
});
