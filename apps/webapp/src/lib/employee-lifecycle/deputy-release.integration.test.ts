/**
 * #1014 (spec #802): a departure clears the departing employee as deputy on
 * the running and upcoming absences of their organization, in the departure's
 * transaction, audited like a manual deputy change with the system as actor.
 * "Not ended" is the absent employee's day; ended absences keep their deputy.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { findDeputyMissingAbsenceIds } from "@/lib/absences/deputy-missing-store";
import { AuditTrail } from "@/lib/audit-trail";
import { revokeRemovedMemberAccessInTransaction } from "@/lib/auth/member-removal-cleanup";
import { type Instant, parseInstant } from "@/lib/datetime/temporal-core";
import type { CreateNotificationParams } from "@/lib/notifications/types";
import { createDepartureCommands } from "./commands";
import { runDepartureTaskDelivery } from "./delivery";
import { releaseDeputyAssignments, releaseDeputyAssignmentsOnDeactivation } from "./deputy-release";
import { createDeputyReleaseNotificationHandler } from "./deputy-release-notifications";
import { createDepartureTaskOutbox, type DepartureTaskClaim } from "./outbox";
import { getEmployeeOffboardingView } from "./queries";
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

describe("departure clears the employee as deputy (#1014)", () => {
	let fixture: LifecycleDatabaseFixture;
	let now: Instant = parseInstant("2026-09-14T09:30:00Z");
	let vacation: string;
	let onCall: string;

	beforeAll(async () => {
		fixture = await createLifecycleDatabaseFixture();
		vacation = await seedCategory(false);
		onCall = await seedCategory(true);
	});

	afterAll(async () => {
		await fixture?.close();
	});

	function commands() {
		return createDepartureCommands({
			db: fixture.db,
			clock: { nowInstant: () => now },
			clockOut,
		});
	}

	function owner(): LifecycleActor {
		return { userId: fixture.ownerUserId, organizationId: fixture.organizationId };
	}

	async function seedCategory(deputyRequired: boolean, organizationId = fixture.organizationId) {
		const result = await fixture.pool.query<{ id: string }>(
			`insert into absence_category
			 (organization_id, type, name, requires_approval, counts_against_vacation, deputy_required,
				is_active, updated_at)
			 values ($1, 'vacation', $2, true, false, $3, true, now()) returning id`,
			[organizationId, `Category ${randomUUID()}`, deputyRequired],
		);
		return result.rows[0]?.id ?? "";
	}

	async function seedAbsence(input: {
		absent: SeededEmployee;
		deputy: SeededEmployee | null;
		startDate: string;
		endDate: string;
		status?: "pending" | "approved" | "rejected";
		categoryId?: string;
		organizationId?: string;
	}) {
		const result = await fixture.pool.query<{ id: string }>(
			`insert into absence_entry
			 (employee_id, category_id, start_date, end_date, status, organization_id, deputy_employee_id,
				updated_at)
			 values ($1, $2, $3, $4, $5, $6, $7, now()) returning id`,
			[
				input.absent.employeeId,
				input.categoryId ?? vacation,
				input.startDate,
				input.endDate,
				input.status ?? "approved",
				input.organizationId ?? fixture.organizationId,
				input.deputy?.employeeId ?? null,
			],
		);
		return result.rows[0]?.id ?? "";
	}

	async function deputyOf(absenceId: string) {
		const result = await fixture.pool.query<{ deputy_employee_id: string | null }>(
			"select deputy_employee_id from absence_entry where id = $1",
			[absenceId],
		);
		return result.rows[0]?.deputy_employee_id ?? null;
	}

	async function deputyAudits(absenceId: string) {
		const result = await fixture.pool.query<{
			action: string;
			entity_type: string;
			performed_by: string;
			employee_id: string;
			changes: string;
			metadata: string | null;
		}>(
			`select action, entity_type, performed_by, employee_id, changes, metadata from audit_log
			 where entity_id = $1 and action = 'absence.deputy_changed' order by timestamp`,
			[absenceId],
		);
		return result.rows.map((row) => ({
			action: row.action,
			entityType: row.entity_type,
			performedBy: row.performed_by,
			employeeId: row.employee_id,
			changes: JSON.parse(row.changes),
			metadata: row.metadata ? JSON.parse(row.metadata) : null,
		}));
	}

	async function setTimezone(employee: SeededEmployee, timezone: string) {
		await fixture.pool.query(
			`insert into user_settings (user_id, timezone, updated_at) values ($1, $2, now())
			 on conflict (user_id) do update set timezone = excluded.timezone`,
			[employee.userId, timezone],
		);
	}

	async function offboardNow(employeeId: string, at = "2026-09-14T09:30:00Z") {
		now = parseInstant(at);
		await commands().offboardNow(owner(), {
			employeeId,
			requestId: randomUUID(),
			replacementEmployeeId: null,
			acknowledgeUnassignedDuties: true,
		});
		const departure = await fixture.pool.query<{ id: string; status: string }>(
			`select id, status from employee_departure where employee_id = $1 order by created_at desc limit 1`,
			[employeeId],
		);
		expect(departure.rows[0]?.status).toBe("effective");
		return departure.rows[0]?.id ?? "";
	}

	it("clears the leaver as deputy on running and upcoming absences only, audited under the initiator", async () => {
		const leaver = await fixture.seedEmployee();
		const anna = await fixture.seedEmployee();
		const ben = await fixture.seedEmployee();
		const ended = await seedAbsence({
			absent: anna,
			deputy: leaver,
			startDate: "2026-09-01",
			endDate: "2026-09-10",
		});
		const running = await seedAbsence({
			absent: anna,
			deputy: leaver,
			startDate: "2026-09-12",
			endDate: "2026-09-14",
		});
		const upcoming = await seedAbsence({
			absent: ben,
			deputy: leaver,
			startDate: "2026-10-01",
			endDate: "2026-10-05",
			status: "pending",
			categoryId: onCall,
		});
		const rejected = await seedAbsence({
			absent: ben,
			deputy: leaver,
			startDate: "2026-10-10",
			endDate: "2026-10-12",
			status: "rejected",
		});
		const otherDeputy = await seedAbsence({
			absent: ben,
			deputy: anna,
			startDate: "2026-10-20",
			endDate: "2026-10-21",
		});

		const departureId = await offboardNow(leaver.employeeId);

		expect(await deputyOf(ended)).toBe(leaver.employeeId);
		expect(await deputyOf(running)).toBeNull();
		expect(await deputyOf(upcoming)).toBeNull();
		expect(await deputyOf(rejected)).toBe(leaver.employeeId);
		expect(await deputyOf(otherDeputy)).toBe(anna.employeeId);
		expect(await deputyAudits(running)).toEqual([
			{
				action: "absence.deputy_changed",
				entityType: "absence",
				performedBy: fixture.ownerUserId,
				employeeId: anna.employeeId,
				changes: { deputyEmployeeId: { from: leaver.employeeId, to: null } },
				metadata: {
					actorKind: "system",
					reason: "employee_departure",
					departureId,
					employmentPeriodId: leaver.employmentPeriodId,
				},
			},
		]);
		expect(await deputyAudits(upcoming)).toHaveLength(1);
		expect(await deputyAudits(ended)).toEqual([]);
		expect(await deputyAudits(rejected)).toEqual([]);
	});

	async function makeManager(manager: SeededEmployee, of: SeededEmployee, isPrimary = true) {
		await fixture.pool.query("update employee set role = 'manager' where id = $1", [
			manager.employeeId,
		]);
		await fixture.pool.query(
			`insert into employee_managers (employee_id, manager_id, is_primary, assigned_by)
			 values ($1, $2, $3, $4)`,
			[of.employeeId, manager.employeeId, isPrimary, fixture.ownerUserId],
		);
	}

	async function deputyReleaseTasks(departureId: string) {
		const result = await fixture.pool.query<{
			id: string;
			dedupe_key: string;
			payload: Record<string, unknown>;
		}>(
			`select id, dedupe_key, payload from employee_departure_task
			 where organization_id = $1 and departure_id = $2 and kind = 'notify_deputy_release'
			 order by dedupe_key`,
			[fixture.organizationId, departureId],
		);
		return result.rows;
	}

	async function deliver(taskId: string, sent: CreateNotificationParams[]) {
		const claimToken = randomUUID();
		const claimed = await fixture.pool.query(
			`update employee_departure_task
			 set status = 'processing', claim_token = $3, attempt_count = attempt_count + 1
			 where organization_id = $1 and id = $2
			 returning id, employee_id, employment_period_id, departure_id, kind, payload, attempt_count`,
			[fixture.organizationId, taskId, claimToken],
		);
		const row = claimed.rows[0];
		const claim: DepartureTaskClaim = {
			id: row.id,
			organizationId: fixture.organizationId,
			employeeId: row.employee_id,
			employmentPeriodId: row.employment_period_id,
			departureId: row.departure_id,
			kind: row.kind,
			payload: row.payload,
			claimToken,
			attemptCount: row.attempt_count,
		};
		return runDepartureTaskDelivery({
			outbox: { ...createDepartureTaskOutbox(fixture.db), claimDue: async () => [claim] },
			now,
			handlers: {
				notify_deputy_release: createDeputyReleaseNotificationHandler({
					database: fixture.db,
					transport: {
						send: async (params) => {
							sent.push(params);
						},
						locale: async () => "en",
					},
				}),
			},
		});
	}

	it("queues one notification per cleared absence for the absent employee and their managers, never the leaver", async () => {
		const leaver = await fixture.seedEmployee();
		const anna = await fixture.seedEmployee();
		const mia = await fixture.seedEmployee();
		await makeManager(mia, anna);
		// The leaver also manages Anna; a departed manager is not told.
		await makeManager(leaver, anna, false);
		const first = await seedAbsence({
			absent: anna,
			deputy: leaver,
			startDate: "2026-10-01",
			endDate: "2026-10-05",
		});
		const second = await seedAbsence({
			absent: anna,
			deputy: leaver,
			startDate: "2026-11-02",
			endDate: "2026-11-03",
		});

		const departureId = await offboardNow(leaver.employeeId);

		const tasks = await deputyReleaseTasks(departureId);
		expect(tasks.map((task) => task.payload)).toEqual(
			[
				{
					absenceId: first,
					absentEmployeeId: anna.employeeId,
					startDate: "2026-10-01",
					endDate: "2026-10-05",
				},
				{
					absenceId: second,
					absentEmployeeId: anna.employeeId,
					startDate: "2026-11-02",
					endDate: "2026-11-03",
				},
			].toSorted((left, right) =>
				`deputy-release:${departureId}:${left.absenceId}`.localeCompare(
					`deputy-release:${departureId}:${right.absenceId}`,
				),
			),
		);

		const sent: CreateNotificationParams[] = [];
		for (const task of tasks) {
			expect(await deliver(task.id, sent)).toMatchObject({ completed: 1, failed: 0 });
		}
		expect(
			sent.map((notification) => [notification.entityId, notification.userId]).toSorted(),
		).toEqual(
			[
				[first, anna.userId],
				[first, mia.userId],
				[second, anna.userId],
				[second, mia.userId],
			].toSorted(),
		);
		expect(sent.every((notification) => notification.type === "absence_deputy_unavailable")).toBe(
			true,
		);
		expect(new Set(sent.map((notification) => notification.idempotencyKey)).size).toBe(4);
	});

	it("is idempotent: a second run clears nothing and writes no audit entry", async () => {
		const leaver = await fixture.seedEmployee();
		const anna = await fixture.seedEmployee();
		const absence = await seedAbsence({
			absent: anna,
			deputy: leaver,
			startDate: "2026-10-01",
			endDate: "2026-10-05",
		});
		const release = () =>
			fixture.db.transaction((tx) =>
				releaseDeputyAssignments(tx, new AuditTrail(), {
					organizationId: fixture.organizationId,
					deputyEmployeeId: leaver.employeeId,
					at: parseInstant("2026-09-20T10:00:00Z"),
					actorUserId: fixture.ownerUserId,
					reason: "employee_deactivated",
				}),
			);

		expect(await release()).toEqual([
			{
				absenceId: absence,
				absentEmployeeId: anna.employeeId,
				startDate: "2026-10-01",
				endDate: "2026-10-05",
			},
		]);
		expect(await release()).toEqual([]);
		expect(await deputyAudits(absence)).toHaveLength(1);
	});

	it("does not restore deputy assignments on rehire", async () => {
		const leaver = await fixture.seedEmployee();
		const anna = await fixture.seedEmployee();
		const absence = await seedAbsence({
			absent: anna,
			deputy: leaver,
			startDate: "2026-12-01",
			endDate: "2026-12-05",
		});
		await offboardNow(leaver.employeeId);
		const policy = await fixture.pool.query<{ id: string }>(
			`insert into work_policy (organization_id, name, created_by, updated_at)
			 values ($1, $2, $3, now()) returning id`,
			[fixture.organizationId, `Policy ${randomUUID()}`, fixture.ownerUserId],
		);

		now = parseInstant("2026-11-02T08:00:00Z");
		await commands().rehireEmployee(owner(), {
			employeeId: leaver.employeeId,
			requestId: randomUUID(),
			previousEmploymentPeriodId: leaver.employmentPeriodId,
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

		expect(await deputyOf(absence)).toBeNull();
		expect(await deputyAudits(absence)).toHaveLength(1);
	});

	it("counts the absences the employee will stop covering on the offboarding checklist", async () => {
		const leaver = await fixture.seedEmployee();
		const anna = await fixture.seedEmployee();
		// Ends on the last working day: no new cover is needed.
		await seedAbsence({
			absent: anna,
			deputy: leaver,
			startDate: "2026-09-28",
			endDate: "2026-09-30",
		});
		await seedAbsence({
			absent: anna,
			deputy: leaver,
			startDate: "2026-09-29",
			endDate: "2026-10-02",
		});
		await seedAbsence({
			absent: anna,
			deputy: leaver,
			startDate: "2026-11-02",
			endDate: "2026-11-03",
			status: "pending",
		});
		await seedAbsence({
			absent: anna,
			deputy: leaver,
			startDate: "2026-11-09",
			endDate: "2026-11-10",
			status: "rejected",
		});
		now = parseInstant("2026-09-14T08:00:00Z");
		await commands().scheduleDeparture(owner(), {
			employeeId: leaver.employeeId,
			requestId: randomUUID(),
			expectedRevision: null,
			lastWorkingDay: "2026-09-30",
			replacementEmployeeId: null,
			acknowledgeUnassignedDuties: true,
		});

		const result = await getEmployeeOffboardingView(fixture.db, {
			organizationId: fixture.organizationId,
			employeeId: leaver.employeeId,
			actorUserId: fixture.ownerUserId,
			now,
		});

		expect(result.kind).toBe("ok");
		expect(result.kind === "ok" && result.view.deputyAbsences).toBe(2);
	});

	it("clears a deactivated employee as deputy, audited under the deactivating admin", async () => {
		const deputy = await fixture.seedEmployee();
		const anna = await fixture.seedEmployee();
		const absence = await seedAbsence({
			absent: anna,
			deputy,
			startDate: "2026-10-01",
			endDate: "2026-10-05",
		});
		const at = parseInstant("2026-09-20T10:00:00Z");

		const released = await fixture.db.transaction((tx) =>
			releaseDeputyAssignmentsOnDeactivation(tx, new AuditTrail(), {
				organizationId: fixture.organizationId,
				employeeId: deputy.employeeId,
				actorUserId: fixture.ownerUserId,
				at,
				reason: "employee_deactivated",
			}),
		);

		expect(released).toEqual({
			organizationId: fixture.organizationId,
			deputyEmployeeId: deputy.employeeId,
			eventKey: `employee_deactivated:${at.epochMilliseconds}`,
			assignments: [
				{
					absenceId: absence,
					absentEmployeeId: anna.employeeId,
					startDate: "2026-10-01",
					endDate: "2026-10-05",
				},
			],
			// Forwarded to the external audit service after the commit.
			audit: expect.any(AuditTrail),
		});
		expect(await deputyAudits(absence)).toEqual([
			expect.objectContaining({
				performedBy: fixture.ownerUserId,
				metadata: { actorKind: "system", reason: "employee_deactivated" },
			}),
		]);
		expect(
			await fixture.db.transaction((tx) =>
				releaseDeputyAssignmentsOnDeactivation(tx, new AuditTrail(), {
					organizationId: fixture.organizationId,
					employeeId: deputy.employeeId,
					actorUserId: fixture.ownerUserId,
					at,
					reason: "employee_deactivated",
				}),
			),
		).toBeNull();
	});

	it("clears a removed member as deputy in the removal transaction", async () => {
		const deputy = await fixture.seedEmployee();
		const anna = await fixture.seedEmployee();
		const absence = await seedAbsence({
			absent: anna,
			deputy,
			startDate: "2026-12-01",
			endDate: "2026-12-05",
		});
		await fixture.pool.query("delete from member where id = $1", [deputy.memberId]);

		const outcome = await fixture.db.transaction((tx) =>
			revokeRemovedMemberAccessInTransaction(
				tx as unknown as Parameters<typeof revokeRemovedMemberAccessInTransaction>[0],
				deputy.userId,
				fixture.organizationId,
			),
		);

		expect(await deputyOf(absence)).toBeNull();
		expect(outcome.releasedDeputies?.assignments.map((assignment) => assignment.absenceId)).toEqual(
			[absence],
		);
		expect(await deputyAudits(absence)).toEqual([
			expect.objectContaining({
				// Nobody else is known to have acted: the removed member's own user.
				performedBy: deputy.userId,
				metadata: { actorKind: "system", reason: "member_removed" },
			}),
		]);
	});

	it("audits a removed member's deputy release under the removing admin when known", async () => {
		const deputy = await fixture.seedEmployee();
		const anna = await fixture.seedEmployee();
		const absence = await seedAbsence({
			absent: anna,
			deputy,
			startDate: "2026-12-07",
			endDate: "2026-12-09",
		});
		await fixture.pool.query("delete from member where id = $1", [deputy.memberId]);

		await fixture.db.transaction((tx) =>
			revokeRemovedMemberAccessInTransaction(
				tx as unknown as Parameters<typeof revokeRemovedMemberAccessInTransaction>[0],
				deputy.userId,
				fixture.organizationId,
				{ actorUserId: fixture.ownerUserId },
			),
		);

		expect(await deputyAudits(absence)).toEqual([
			expect.objectContaining({
				performedBy: fixture.ownerUserId,
				metadata: { actorKind: "system", reason: "member_removed" },
			}),
		]);
	});

	it("flags 'Deputy missing' on running and upcoming deputy-required absences without a deputy", async () => {
		const leaver = await fixture.seedEmployee();
		const anna = await fixture.seedEmployee();
		const inHonolulu = await fixture.seedEmployee();
		await setTimezone(inHonolulu, "Pacific/Honolulu");
		const cleared = await seedAbsence({
			absent: anna,
			deputy: leaver,
			startDate: "2026-10-01",
			endDate: "2026-10-05",
			categoryId: onCall,
		});
		const notRequired = await seedAbsence({
			absent: anna,
			deputy: leaver,
			startDate: "2026-10-06",
			endDate: "2026-10-07",
		});
		const named = await seedAbsence({
			absent: anna,
			deputy: inHonolulu,
			startDate: "2026-10-08",
			endDate: "2026-10-09",
			categoryId: onCall,
		});
		const ended = await seedAbsence({
			absent: anna,
			deputy: null,
			startDate: "2026-09-01",
			endDate: "2026-09-13",
			categoryId: onCall,
		});
		// 2026-09-14T09:30Z is still 2026-09-13 in Honolulu.
		const runningInHonolulu = await seedAbsence({
			absent: inHonolulu,
			deputy: null,
			startDate: "2026-09-01",
			endDate: "2026-09-13",
			categoryId: onCall,
		});
		await offboardNow(leaver.employeeId);

		const rows = await fixture.pool.query<{
			id: string;
			employee_id: string;
			end_date: string;
			status: string;
			deputy_employee_id: string | null;
			deputy_required: boolean;
		}>(
			`select a.id, a.employee_id, a.end_date::text as end_date, a.status, a.deputy_employee_id,
				c.deputy_required
			 from absence_entry a join absence_category c on c.id = a.category_id
			 where a.id = any($1::uuid[])`,
			[[cleared, notRequired, named, ended, runningInHonolulu]],
		);
		const missing = await findDeputyMissingAbsenceIds(fixture.db, {
			organizationId: fixture.organizationId,
			at: parseInstant("2026-09-14T09:30:00Z"),
			absences: rows.rows.map((row) => ({
				id: row.id,
				employeeId: row.employee_id,
				endDate: row.end_date,
				status: row.status,
				deputyEmployeeId: row.deputy_employee_id,
				deputyRequired: row.deputy_required,
			})),
		});

		expect([...missing].toSorted()).toEqual([cleared, runningInHonolulu].toSorted());
	});

	it("decides 'not ended' in the absent employee's timezone", async () => {
		const leaver = await fixture.seedEmployee();
		const inUtc = await fixture.seedEmployee();
		const inHonolulu = await fixture.seedEmployee();
		await setTimezone(inHonolulu, "Pacific/Honolulu");
		const endedInUtc = await seedAbsence({
			absent: inUtc,
			deputy: leaver,
			startDate: "2026-09-10",
			endDate: "2026-09-13",
		});
		// 2026-09-14T09:30Z is still 2026-09-13 in Honolulu.
		const runningInHonolulu = await seedAbsence({
			absent: inHonolulu,
			deputy: leaver,
			startDate: "2026-09-10",
			endDate: "2026-09-13",
		});

		await offboardNow(leaver.employeeId);

		expect(await deputyOf(endedInUtc)).toBe(leaver.employeeId);
		expect(await deputyOf(runningInHonolulu)).toBeNull();
	});
});
