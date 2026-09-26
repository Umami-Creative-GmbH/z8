/**
 * PostgreSQL contract: pnpm --filter webapp test:approval-workflow-repository:integration
 * Public lifecycle read models are scoped, read-only and never serialize
 * private task payloads.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Instant, parseInstant } from "@/lib/datetime/temporal-core";
import { createDepartureCommands } from "./commands";
import { getEmployeeOffboardingView, previewEmployeeDeparture } from "./queries";
import {
	enableCanonicalAbsences,
	seedPendingAbsenceWorkflow,
} from "./testing/approval-workflow.test.fixture";
import {
	createLifecycleDatabaseFixture,
	describeLifecycleDatabase,
	type LifecycleDatabaseFixture,
	type SeededEmployee,
} from "./testing/database.test.fixture";

const NOW = parseInstant("2026-09-15T08:00:00Z");
const AFTER_CUTOFF = parseInstant("2026-09-30T23:00:00Z");

describeLifecycleDatabase("employee offboarding read models", () => {
	let fixture: LifecycleDatabaseFixture;
	let now: Instant = NOW;

	beforeAll(async () => {
		fixture = await createLifecycleDatabaseFixture();
		await fixture.pool.query(`update organization set timezone = 'Europe/Berlin' where id = $1`, [
			fixture.organizationId,
		]);
	});

	afterAll(async () => {
		await fixture?.close();
	});

	const owner = () => ({ userId: fixture.ownerUserId, organizationId: fixture.organizationId });

	function commands() {
		return createDepartureCommands({
			db: fixture.db,
			clock: { nowInstant: () => now },
			clockOut: { close: async () => ({ kind: "not_running" }) },
		});
	}

	async function view(employee: SeededEmployee, actorUserId = fixture.ownerUserId) {
		const result = await getEmployeeOffboardingView(fixture.db, {
			organizationId: fixture.organizationId,
			employeeId: employee.employeeId,
			actorUserId,
			now,
		});
		if (result.kind !== "ok") throw new Error(`view ${result.kind}`);
		return result.view;
	}

	async function schedule(employee: SeededEmployee, actor = owner()) {
		return commands().scheduleDeparture(actor, {
			employeeId: employee.employeeId,
			requestId: randomUUID(),
			expectedRevision: null,
			lastWorkingDay: "2026-09-30",
			replacementEmployeeId: null,
			acknowledgeUnassignedDuties: true,
		});
	}

	describe("state", () => {
		it("shows an active employee with departure actions", async () => {
			now = NOW;
			const employee = await fixture.seedEmployee();

			expect(await view(employee)).toMatchObject({
				state: "active",
				employmentPeriodId: employee.employmentPeriodId,
				departure: null,
				capabilities: { schedule: true, offboardNow: true, cancel: false, rehire: false },
			});
		});

		it("shows a scheduled departure with its frozen zone and exact cutoff", async () => {
			now = NOW;
			const employee = await fixture.seedEmployee();
			const scheduled = await schedule(employee);

			expect(await view(employee)).toMatchObject({
				state: "scheduled",
				departure: {
					id: scheduled.departureId,
					revision: 1,
					lastWorkingDay: "2026-09-30",
					cutoff: "2026-09-30T22:00:00Z",
					timezone: "Europe/Berlin",
				},
				capabilities: { schedule: true, cancel: true, offboardNow: true },
			});
		});

		it("shows a blocked departure after the initiator lost authority", async () => {
			now = NOW;
			const admin = await fixture.seedEmployee({ role: "admin" });
			const employee = await fixture.seedEmployee();
			const scheduled = await schedule(employee, {
				userId: admin.userId,
				organizationId: fixture.organizationId,
			});
			await fixture.pool.query(`update member set role = 'member' where id = $1`, [admin.memberId]);
			now = AFTER_CUTOFF;
			await commands().executeDeparture({
				organizationId: fixture.organizationId,
				employeeId: employee.employeeId,
				employmentPeriodId: employee.employmentPeriodId,
				departureId: scheduled.departureId,
				revision: scheduled.revision,
			});

			expect(await view(employee)).toMatchObject({
				state: "blocked",
				departure: { blockedReason: "initiator_authorization_lost" },
				capabilities: { cancel: true, schedule: true },
			});
		});

		it("shows an effective departure, its follow-up and rehire, without private payloads", async () => {
			now = NOW;
			const employee = await fixture.seedEmployee();
			await fixture.pool.query(
				`insert into session (id, token, user_id, active_organization_id, expires_at, created_at, updated_at)
				 values ($1, $2, $3, $4, now() + interval '1 day', now(), now())`,
				[randomUUID(), "secret-session-token", employee.userId, fixture.organizationId],
			);
			await commands().offboardNow(owner(), {
				employeeId: employee.employeeId,
				requestId: randomUUID(),
				replacementEmployeeId: null,
				acknowledgeUnassignedDuties: true,
			});
			await fixture.pool.query(
				`update employee_departure_task set status = 'failed', last_error = 'stripe: card_declined at acct_123'
				 where organization_id = $1 and employee_id = $2 and kind = 'billing_sync'`,
				[fixture.organizationId, employee.employeeId],
			);

			const offboarded = await view(employee);

			expect(offboarded).toMatchObject({
				state: "offboarded",
				employmentPeriodId: null,
				previousEmploymentPeriodId: employee.employmentPeriodId,
				membershipApproved: true,
				capabilities: { rehire: true, schedule: false, offboardNow: false, resolve: true },
			});
			expect(offboarded.followUp.failed).toBe(1);
			expect(offboarded.followUp.pending).toBeGreaterThan(0);
			expect(offboarded.failedTasks).toEqual([{ id: expect.any(String), kind: "billing_sync" }]);
			const serialized = JSON.stringify(offboarded);
			expect(serialized).not.toContain("secret-session-token");
			expect(serialized).not.toContain("card_declined");
			expect(serialized).not.toMatch(/claim_?token/i);

			// A new stint: active again, with nothing from the previous departure.
			await fixture.pool.query(
				`insert into employee_employment_period
				 (organization_id, employee_id, status, started_at, start_provenance)
				 values ($1, $2, 'open', now(), 'recorded')`,
				[fixture.organizationId, employee.employeeId],
			);
			await fixture.pool.query(`update employee set is_active = true where id = $1`, [
				employee.employeeId,
			]);
			expect(await view(employee)).toMatchObject({ state: "active", departure: null });
		});

		it("keeps unknown legacy history without inventing a cutoff", async () => {
			const legacy = await fixture.seedEmployee({ isActive: false, withPeriod: false });

			expect(await view(legacy)).toMatchObject({
				state: "legacy_inactive",
				departure: null,
				capabilities: { rehire: false, schedule: false },
			});
		});
	});

	describe("authorization", () => {
		it("gives the employee's manager a read-only view and denies unrelated members", async () => {
			now = NOW;
			const manager = await fixture.seedEmployee();
			const employee = await fixture.seedEmployee();
			const stranger = await fixture.seedEmployee();
			await fixture.pool.query(
				`insert into employee_managers (employee_id, manager_id, is_primary, assigned_by)
				 values ($1, $2, true, $3)`,
				[employee.employeeId, manager.employeeId, fixture.ownerUserId],
			);
			await schedule(employee);

			expect(await view(employee, manager.userId)).toMatchObject({
				state: "scheduled",
				capabilities: {
					schedule: false,
					cancel: false,
					offboardNow: false,
					rehire: false,
					resolve: false,
				},
			});
			await expect(
				getEmployeeOffboardingView(fixture.db, {
					organizationId: fixture.organizationId,
					employeeId: employee.employeeId,
					actorUserId: stranger.userId,
					now,
				}),
			).resolves.toEqual({ kind: "forbidden" });
		});

		it("recognizes a listed admin role and denies an admin whose own departure is due", async () => {
			now = NOW;
			const employee = await fixture.seedEmployee();
			const listed = await fixture.seedEmployee();
			await fixture.pool.query(`update member set role = 'member, admin' where id = $1`, [
				listed.memberId,
			]);
			const departingAdmin = await fixture.seedEmployee({ role: "admin" });
			await commands().scheduleDeparture(owner(), {
				employeeId: departingAdmin.employeeId,
				requestId: randomUUID(),
				expectedRevision: null,
				lastWorkingDay: "2026-09-30",
				replacementEmployeeId: null,
				acknowledgeUnassignedDuties: true,
			});
			// The departure is due but no worker has materialized it yet.
			now = AFTER_CUTOFF;

			expect((await view(employee, listed.userId)).capabilities.schedule).toBe(true);
			await expect(
				getEmployeeOffboardingView(fixture.db, {
					organizationId: fixture.organizationId,
					employeeId: employee.employeeId,
					actorUserId: departingAdmin.userId,
					now,
				}),
			).resolves.toEqual({ kind: "forbidden" });
		});

		it("never reads an employee through another organization", async () => {
			const foreignOrganizationId = await fixture.createOrganization();
			const foreign = await fixture.seedEmployee({ organizationId: foreignOrganizationId });

			await expect(
				getEmployeeOffboardingView(fixture.db, {
					organizationId: fixture.organizationId,
					employeeId: foreign.employeeId,
					actorUserId: fixture.ownerUserId,
					now,
				}),
			).resolves.toEqual({ kind: "not_found" });
		});
	});

	describe("preview", () => {
		it("computes the frozen-zone cutoff and known exceptions without writing", async () => {
			now = NOW;
			const employee = await fixture.seedEmployee();
			const replacement = await fixture.seedEmployee({ role: "admin" });
			const counts = async () =>
				(
					await fixture.pool.query(
						`select (select count(*) from employee_departure where organization_id = $1)
							+ (select count(*) from employee_departure_task where organization_id = $1)
							+ (select count(*) from employee_departure_event where organization_id = $1) as total`,
						[fixture.organizationId],
					)
				).rows[0]?.total;
			const before = await counts();

			const result = await previewEmployeeDeparture(fixture.db, {
				organizationId: fixture.organizationId,
				employeeId: employee.employeeId,
				actorUserId: fixture.ownerUserId,
				lastWorkingDay: "2026-09-30",
				replacementEmployeeId: null,
				now,
			});

			expect(result).toMatchObject({
				kind: "ok",
				preview: {
					lastWorkingDay: "2026-09-30",
					cutoff: "2026-09-30T22:00:00Z",
					timezone: "Europe/Berlin",
					pendingDutyCount: 0,
				},
			});
			if (result.kind !== "ok") throw new Error("preview failed");
			expect(result.preview.replacementOptions.map((option) => option.employeeId)).toContain(
				replacement.employeeId,
			);
			expect(result.preview.replacementOptions.map((option) => option.employeeId)).not.toContain(
				employee.employeeId,
			);
			expect(await counts()).toBe(before);
		});

		it("checks approval duties against the chosen replacement", async () => {
			now = NOW;
			await enableCanonicalAbsences(fixture, new Date(NOW.epochMilliseconds));
			const departing = await fixture.seedEmployee({ role: "admin" });
			const requester = await fixture.seedEmployee();
			const replacement = await fixture.seedEmployee({ role: "admin" });
			const plain = await fixture.seedEmployee();
			const firstApprover = await fixture.seedEmployee({ role: "admin" });
			const at = new Date(NOW.epochMilliseconds);
			await seedPendingAbsenceWorkflow(fixture, {
				requester,
				approverEmployeeIds: [departing.employeeId],
				at,
			});
			// The replacement asked for this one and can never decide it.
			await seedPendingAbsenceWorkflow(fixture, {
				requester: replacement,
				approverEmployeeIds: [departing.employeeId],
				at,
			});
			// A later stage routed only to the departing person.
			await seedPendingAbsenceWorkflow(fixture, {
				requester,
				approverEmployeeIds: [firstApprover.employeeId],
				at,
				secondStageResolver: {
					approverType: "specific_employee",
					approverEmployeeId: departing.employeeId,
					fallbackBehavior: "fail",
				},
			});
			const preview = async (replacementEmployeeId: string | null) => {
				const result = await previewEmployeeDeparture(fixture.db, {
					organizationId: fixture.organizationId,
					employeeId: departing.employeeId,
					actorUserId: fixture.ownerUserId,
					lastWorkingDay: "2026-09-30",
					replacementEmployeeId,
					now,
				});
				if (result.kind !== "ok") throw new Error(`preview ${result.kind}`);
				return result.preview;
			};

			const without = await preview(null);
			expect(without.pendingDutyCount).toBe(2);
			expect(without.exceptions).toEqual(
				expect.arrayContaining(["unassigned_approval_duties", "later_stages_without_replacement"]),
			);
			expect(without.exceptions).not.toContain("replacement_ineligible");

			const covered = await preview(replacement.employeeId);
			expect(covered.exceptions).toContain("replacement_requested_duties");
			expect(covered.exceptions).not.toContain("unassigned_approval_duties");
			expect(covered.exceptions).not.toContain("later_stages_without_replacement");

			const ineligible = await preview(plain.employeeId);
			expect(ineligible.exceptions).toEqual(
				expect.arrayContaining([
					"replacement_ineligible",
					"unassigned_approval_duties",
					"later_stages_without_replacement",
				]),
			);
		});

		it("rejects a past last working day and non-admin actors", async () => {
			now = NOW;
			const employee = await fixture.seedEmployee();
			await expect(
				previewEmployeeDeparture(fixture.db, {
					organizationId: fixture.organizationId,
					employeeId: employee.employeeId,
					actorUserId: fixture.ownerUserId,
					lastWorkingDay: "2026-09-01",
					replacementEmployeeId: null,
					now,
				}),
			).resolves.toEqual({ kind: "invalid", code: "departure_date_in_past" });
			await expect(
				previewEmployeeDeparture(fixture.db, {
					organizationId: fixture.organizationId,
					employeeId: employee.employeeId,
					actorUserId: employee.userId,
					lastWorkingDay: "2026-09-30",
					replacementEmployeeId: null,
					now,
				}),
			).resolves.toEqual({ kind: "forbidden" });
		});
	});
});
