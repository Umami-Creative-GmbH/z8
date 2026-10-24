/**
 * #1440 acceptance (spec #1437, Organization ADR 0006): Deactivate has the
 * consequences of a departure taking effect, at the moment of deactivation,
 * through the real server actions against PostgreSQL. Only the request and
 * session, notification delivery, queues and the Next cache are replaced.
 *
 * One employee who manages two reports (one with another manager, one
 * without), holds every grant type, a driving authorization (suspended) and a
 * kiosk badge, has pending approval duties, past, running and future shifts,
 * spanning and future absences, a team, a deputy duty and a share link is
 * deactivated. The suite checks the preview against what the server applied,
 * the refusals, each consequence and its audit entry, the handover through the
 * worker, retention, and that a retried request applies nothing twice.
 */
import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ApprovalWorkflowDatabase } from "@/lib/approvals/workflow/repository";
import { type Instant, parseInstant } from "@/lib/datetime/temporal-core";
import type { DeactivationApplied, DeactivationPlan } from "./types";

const harness = vi.hoisted(() => ({
	userId: null as string | null,
	organizationId: null as string | null,
	now: "2026-10-20T08:00:00Z",
}));

vi.mock("next/server", async (importOriginal) =>
	(await import("@/test/integration-harness")).nextServer(importOriginal),
);
vi.mock("next/headers", async () => (await import("@/test/integration-harness")).nextHeaders());
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
							session: { activeOrganizationId: harness.organizationId },
						}
					: null,
		},
	},
}));
vi.mock("@/lib/auth-helpers", async (importOriginal) => {
	const original = await importOriginal<typeof import("@/lib/auth-helpers")>();
	const { db } = await import("@/db");
	const { loadOrganizationPrincipalContext } = await import("@/lib/authorization/principal-loader");
	return {
		...original,
		getAuthContext: async () => ({
			user: { id: harness.userId },
			session: { activeOrganizationId: harness.organizationId },
		}),
		getPrincipalContext: async () =>
			harness.userId && harness.organizationId
				? loadOrganizationPrincipalContext(db, {
						userId: harness.userId,
						organizationId: harness.organizationId,
					})
				: null,
	};
});
// The mocked session has no stored SSO provenance to admit.
vi.mock("@/lib/organization-mfa/organization-access", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/organization-mfa/organization-access")>()),
	canAccessOrganization: async () => true,
}));
vi.mock("@/lib/billing/guard", async () =>
	(await import("@/test/integration-harness")).billingGuard(),
);
// Every notice is recorded instead of delivered; its idempotency key is what dedupes it.
const { createNotification } = vi.hoisted(() => ({ createNotification: vi.fn() }));
vi.mock("@/lib/notifications/notification-service", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/notifications/notification-service")>()),
	createNotification,
}));
vi.mock("@/lib/queue", async (importOriginal) =>
	(await import("@/test/integration-harness")).calendarSyncQueue(importOriginal),
);
vi.mock("@/lib/approvals/delivery/kick", async () =>
	(await import("@/test/integration-harness")).deliveryKick(),
);
// The deactivation instant (and the clocks of the seeding steps) is the suite's.
vi.mock("@/lib/datetime/temporal-core", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@/lib/datetime/temporal-core")>();
	return { ...actual, systemClock: { nowInstant: () => actual.parseInstant(harness.now) } };
});
vi.mock("@/lib/logger", async (importOriginal) => {
	const original = await importOriginal<typeof import("@/lib/logger")>();
	const quiet = { error: () => {}, warn: () => {}, info: () => {}, debug: () => {} };
	return { ...original, createLogger: () => quiet };
});
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

const { deactivateEmployeeAction, previewEmployeeDeactivationAction, reactivateEmployeeAction } =
	await import("@/app/[locale]/(app)/settings/employees/employee-lifecycle.actions");
const {
	dismissReactivationChecklistAction,
	getReactivationChecklistAction,
	listEmployeeLifecycleHistoryAction,
} = await import("@/app/[locale]/(app)/settings/employees/employee-reactivation.actions");
const { assignDepartureReplacementAction, getEmployeeOffboardingViewAction } = await import(
	"@/app/[locale]/(app)/settings/employees/employee-offboarding.actions"
);
const { createLifecycleDatabaseFixture } = await import("../testing/database.test.fixture");
type LifecycleDatabaseFixture = import("../testing/database.test.fixture").LifecycleDatabaseFixture;
type SeededEmployee = import("../testing/database.test.fixture").SeededEmployee;
const { enableCanonicalAbsences, seedPendingAbsenceWorkflow, absenceApprovalRuntime } =
	await import("../testing/approval-workflow.test.fixture");
const { createApprovalHandoverHandler, createApprovalHandoverRuntime } = await import(
	"../approval-handover"
);
const { runDepartureTaskDelivery } = await import("../delivery");
const { createDepartureTaskOutbox } = await import("../outbox");
type DepartureTaskClaim = import("../outbox").DepartureTaskClaim;
const { activateDrivingLicenceControl, saveConfirmedIntendedDriverAssignment } = await import(
	"@/lib/organization/driving-licence/testing/control.test.fixture"
);
const checks = await import("@/lib/organization/driving-licence/check-actions");
const verifierActions = await import("@/lib/organization/driving-licence/verifier-actions");
const impediments = await import("@/lib/organization/driving-licence/impediment-actions");
const { savePayrollAccessGrant } = await import("@/lib/payroll-access/grant-store");
const { seedPersonnelFileOfficerGrant } = await import(
	"@/lib/personnel-file/testing/officer-grant.test.fixture"
);
const { issueKioskBadge } = await import("@/lib/time-tracking/kiosk/badge-store");
const { saveExpenseOfficerGrant } = await import(
	"@/lib/travel-expenses/expense-officer-grant-store"
);
const { shiftStoredDate } = await import("@/lib/scheduling/shift-date");
const { loadRetentionEmployment } = await import("@/lib/personnel-file/retention-employment");
const { retentionStart } = await import("@/lib/personnel-file/retention");
const { findEmployeesNotOnCurrentRoster } = await import("../current-roster-guard");

const ZONE = "Europe/Berlin";
const SEEDED_AT = parseInstant("2026-10-20T08:00:00Z");
// 10:00 on Saturday, 24 October 2026 in Berlin.
const AT = parseInstant("2026-10-24T08:00:00Z");

type People = {
	person: SeededEmployee;
	manager: SeededEmployee;
	replacement: SeededEmployee;
	plainEmployee: SeededEmployee;
	formerAdmin: SeededEmployee;
	keepsManager: SeededEmployee;
	orphan: SeededEmployee;
	unmanaged: SeededEmployee;
};

type Seeded = People & {
	teamId: string;
	grants: { expense: string; payroll: string; personnelFile: string };
	verifierGrantId: string;
	authorizationIds: string[];
	badgeId: string;
	shareLinkId: string;
	shifts: { past: string; running: string; future: string };
	absences: { spanning: string; pending: string; approved: string };
	deputyAbsenceId: string;
	duties: {
		toReplacement: { workflow: string; assignment: string };
		toReview: { workflow: string; assignment: string };
		laterStage: { workflow: string; stage: string };
	};
};

describe("deactivation acceptance (#1440)", () => {
	let fixture: LifecycleDatabaseFixture;
	let seeded: Seeded;
	let clockNow: Instant = SEEDED_AT;
	const clock = { nowInstant: () => clockNow };

	function actAs(userId: string, organizationId = fixture.organizationId) {
		harness.userId = userId;
		harness.organizationId = organizationId;
	}

	async function named(
		input: Parameters<LifecycleDatabaseFixture["seedEmployee"]>[0],
		name: string,
	) {
		const seededEmployee = await fixture.seedEmployee(input);
		await fixture.pool.query(`update "user" set name = $2 where id = $1`, [
			seededEmployee.userId,
			name,
		]);
		return seededEmployee;
	}

	async function link(report: SeededEmployee, manager: SeededEmployee, isPrimary: boolean) {
		await fixture.pool.query(
			`insert into employee_managers (id, employee_id, manager_id, is_primary, assigned_by, assigned_at, created_at)
			 values ($1, $2, $3, $4, $5, $6, $6)`,
			[
				randomUUID(),
				report.employeeId,
				manager.employeeId,
				isPrimary,
				fixture.ownerUserId,
				new Date(SEEDED_AT.epochMilliseconds),
			],
		);
	}

	async function seedDrivingAuthorization(person: SeededEmployee, verifier: SeededEmployee) {
		actAs(fixture.ownerUserId);
		harness.now = "2026-10-20T08:00:00Z";
		expect(
			(
				await activateDrivingLicenceControl({
					intervalMonths: 6,
					timezone: ZONE,
					reminderLeadDays: [30, 7],
					retentionMonths: 36,
					retentionJustification: "Dedicated driving inspection evidence retention",
				})
			).success,
		).toBe(true);
		expect(
			(
				await saveConfirmedIntendedDriverAssignment({
					target: { type: "employee", employeeId: person.employeeId },
					value: "required",
				})
			).success,
		).toBe(true);
		for (const verifierEmployeeId of [verifier.employeeId, person.employeeId]) {
			expect(
				(
					await verifierActions.saveDrivingLicenceVerifierGrantAction({
						verifierEmployeeId,
						scope: "all",
						teamIds: [],
						employeeIds: [],
					})
				).success,
			).toBe(true);
		}
		actAs(verifier.userId);
		expect(
			(
				await checks.completeDrivingLicenceCheckAction({
					employeeId: person.employeeId,
					commandId: randomUUID(),
					originalInspected: true,
					identityConfirmed: true,
					employeeDeclaration: true,
					verifierConfirmed: true,
					documentIssuedOn: "2020-05-01",
					documentExpiresOn: "2035-05-01",
					classes: [
						{ code: "B", result: "successful", expiryDate: null, restrictions: "" },
						{ code: "C", result: "successful", expiryDate: null, restrictions: "" },
					],
				})
			).success,
		).toBe(true);
		// The person reports an impediment: their classes are suspended, and still end.
		harness.now = "2026-10-21T08:00:00Z";
		actAs(person.userId);
		expect(
			(await impediments.reportDrivingImpedimentAction({ commandId: randomUUID() })).success,
		).toBe(true);
		actAs(fixture.ownerUserId);
	}

	async function seedShareLink(creator: SeededEmployee) {
		const { rows } = await fixture.pool.query<{ id: string }>(
			`insert into report_share_link
			 (organization_id, created_by, creator_employee_id, kind, project_ids, from_day, to_day, figures,
			  creator_locale, token_digest, token_hash_version, snapshot, created_at, expires_at)
			 values ($1, $2, $3, 'project', array[$4::uuid], '2026-09-01', '2026-09-30', 'hours', 'en', $5, 'v1',
			  '{}'::jsonb, '2026-10-01T08:00:00Z', '2026-12-01T00:00:00Z')
			 returning id`,
			[
				fixture.organizationId,
				creator.userId,
				creator.employeeId,
				randomUUID(),
				createHash("sha256").update(randomUUID()).digest("hex"),
			],
		);
		return rows[0]?.id ?? "";
	}

	async function seedShifts(person: SeededEmployee) {
		const locationId = randomUUID();
		const subareaId = randomUUID();
		await fixture.pool.query(
			`insert into location (id, organization_id, name, created_by, updated_at)
			 values ($1, $2, 'Store', $3, now())`,
			[locationId, fixture.organizationId, fixture.ownerUserId],
		);
		await fixture.pool.query(
			`insert into location_subarea (id, location_id, name, created_by, updated_at)
			 values ($1, $2, 'Floor', $3, now())`,
			[subareaId, locationId, fixture.ownerUserId],
		);
		const shift = async (date: string, startTime: string, endTime: string) => {
			const id = randomUUID();
			await fixture.pool.query(
				`insert into shift
				 (id, organization_id, employee_id, subarea_id, date, start_time, end_time, status, created_by, updated_at)
				 values ($1, $2, $3, $4, $5, $6, $7, 'published', $8, now())`,
				[
					id,
					fixture.organizationId,
					person.employeeId,
					subareaId,
					shiftStoredDate(date, ZONE),
					startTime,
					endTime,
					fixture.ownerUserId,
				],
			);
			return id;
		};
		return {
			past: await shift("2026-10-20", "09:00", "17:00"),
			// Started at 07:00 Berlin, before the instant: it stays.
			running: await shift("2026-10-24", "07:00", "15:00"),
			future: await shift("2026-10-27", "09:00", "17:00"),
		};
	}

	/** The person's own absence with its canonical record and pending workflow, decided by `approver`. */
	async function seedOwnAbsence(
		person: SeededEmployee,
		approver: SeededEmployee,
		categoryId: string,
		input: { startDate: string; endDate: string; status: "pending" | "approved" },
	) {
		const at = new Date(SEEDED_AT.epochMilliseconds);
		const record = randomUUID();
		const absence = randomUUID();
		const workflow = randomUUID();
		const stage = randomUUID();
		const assignment = randomUUID();
		const org = fixture.organizationId;
		await fixture.pool.query(
			`insert into time_record (id, organization_id, employee_id, record_kind, start_at, end_at,
				approval_state, origin, created_at, created_by, updated_at)
			 values ($1, $2, $3, 'absence', $4::date, ($5::date + 1), 'pending', 'manual', $6, $7, $6)`,
			[record, org, person.employeeId, input.startDate, input.endDate, at, person.userId],
		);
		await fixture.pool.query(
			`insert into time_record_absence (record_id, organization_id, record_kind, absence_category_id)
			 values ($1, $2, 'absence', $3)`,
			[record, org, categoryId],
		);
		await fixture.pool.query(
			`insert into absence_entry (id, employee_id, category_id, start_date, end_date, status,
				organization_id, canonical_record_id, created_at, updated_at)
			 values ($1, $2, $3, $4, $5, 'pending', $6, $7, $8, $8)`,
			[absence, person.employeeId, categoryId, input.startDate, input.endDate, org, record, at],
		);
		await fixture.pool.query(
			`insert into approval_workflow (id, organization_id, workflow_type, source_type, source_id,
				requester_employee_id, status, current_stage_order, version, policy_snapshot,
				context_snapshot, display_snapshot, submitted_at, created_at, updated_at)
			 values ($1, $2, 'absence', 'absence_entry', $3, $4, 'pending', 1, 1, '{}', '{}', '{}', $5, $5, $5)`,
			[workflow, org, absence, person.employeeId, at],
		);
		await fixture.pool.query(
			`update absence_entry set approval_workflow_id = $1 where organization_id = $2 and id = $3`,
			[workflow, org, absence],
		);
		await fixture.pool.query(
			`insert into approval_workflow_stage (id, organization_id, workflow_id, stage_order, label,
				resolver_snapshot, activation_mode, status, activated_at, created_at, updated_at)
			 values ($1, $2, $3, 1, 'Manager', $4, 'human', 'pending', $5, $5, $5)`,
			[
				stage,
				org,
				workflow,
				JSON.stringify({ approverType: "direct_manager", fallbackBehavior: "fail" }),
				at,
			],
		);
		await fixture.pool.query(
			`insert into approval_stage_assignment (id, organization_id, workflow_id, stage_id,
				assignment_sequence, approver_employee_id, status, assigned_at, created_at, updated_at)
			 values ($1, $2, $3, $4, 1, $5, 'pending', $6, $6, $6)`,
			[assignment, org, workflow, stage, approver.employeeId, at],
		);
		if (input.status === "approved") {
			await absenceApprovalRuntime(fixture, clock).transitionEngine.execute({
				organizationId: org,
				workflowId: workflow,
				expectedVersion: 1,
				idempotencyKey: `seed:${workflow}`,
				principal: { kind: "employee", userId: approver.userId },
				command: { type: "approve", stageId: stage, assignmentId: assignment },
			});
		}
		return absence;
	}

	async function seed(): Promise<Seeded> {
		await fixture.pool.query(`update organization set timezone = $2 where id = $1`, [
			fixture.organizationId,
			ZONE,
		]);
		await enableCanonicalAbsences(fixture, new Date(SEEDED_AT.epochMilliseconds));
		const people: People = {
			person: await named({ role: "member" }, "Pat Person"),
			manager: await named({ role: "admin" }, "Mia Manager"),
			replacement: await named({ role: "admin" }, "Anna Admin"),
			plainEmployee: await named({}, "Eli Employee"),
			formerAdmin: await named({ role: "admin", isActive: false }, "Fay Former"),
			keepsManager: await named({}, "Kim Keeps"),
			orphan: await named({}, "Rita Report"),
			unmanaged: await named({}, "Uma Unmanaged"),
		};
		const { person, manager, keepsManager, orphan, unmanaged } = people;
		await fixture.pool.query(`update employee set role = 'manager' where id = $1`, [
			person.employeeId,
		]);
		// Two reports, one keeping another manager; and the person's own manager.
		await link(keepsManager, person, true);
		await link(keepsManager, manager, false);
		await link(orphan, person, true);
		await link(person, manager, true);

		const teamId = randomUUID();
		await fixture.pool.query(
			`insert into team (id, organization_id, name, updated_at) values ($1, $2, 'Floor team', now())`,
			[teamId, fixture.organizationId],
		);
		await fixture.pool.query(
			`insert into team_membership (organization_id, team_id, employee_id) values ($1, $2, $3)`,
			[fixture.organizationId, teamId, person.employeeId],
		);
		await fixture.pool.query(`update employee set team_id = $2 where id = $1`, [
			person.employeeId,
			teamId,
		]);

		// Approval duties: one for the orphan's request, one nobody can take, a later stage.
		const toReplacement = await seedPendingAbsenceWorkflow(fixture, {
			requester: orphan,
			approverEmployeeIds: [person.employeeId],
			at: new Date(SEEDED_AT.epochMilliseconds),
		});
		const toReview = await seedPendingAbsenceWorkflow(fixture, {
			requester: unmanaged,
			approverEmployeeIds: [person.employeeId],
			at: new Date(SEEDED_AT.epochMilliseconds),
		});
		const laterStage = await seedPendingAbsenceWorkflow(fixture, {
			requester: unmanaged,
			approverEmployeeIds: [manager.employeeId],
			at: new Date(SEEDED_AT.epochMilliseconds),
			secondStageResolver: {
				approverType: "specific_employee",
				fallbackBehavior: "fail",
				approverEmployeeId: person.employeeId,
			},
		});

		// Grants, a driving authorization and a kiosk badge.
		await seedDrivingAuthorization(person, manager);
		const expense = await fixture.db.transaction((tx) =>
			saveExpenseOfficerGrant(tx, {
				organizationId: fixture.organizationId,
				actorUserId: fixture.ownerUserId,
				grant: {
					officerEmployeeId: person.employeeId,
					scope: "all",
					teamIds: [],
					employeeIds: [],
					canExport: true,
					canRecordReimbursements: true,
				},
			}),
		);
		const payroll = await fixture.db.transaction((tx) =>
			savePayrollAccessGrant(tx, {
				organizationId: fixture.organizationId,
				actorUserId: fixture.ownerUserId,
				grant: { payrollEmployeeId: person.employeeId, scope: "all", teamIds: [], employeeIds: [] },
			}),
		);
		const personnelFile = await seedPersonnelFileOfficerGrant(fixture.pool, {
			organizationId: fixture.organizationId,
			officerEmployeeId: person.employeeId,
			createdBy: fixture.ownerUserId,
		});
		const badge = await issueKioskBadge(
			fixture.db,
			{
				organizationId: fixture.organizationId,
				actorUserId: fixture.ownerUserId,
				employeeId: person.employeeId,
			},
			async () => null,
			{ nowInstant: () => parseInstant("2026-10-21T09:00:00Z") },
		);
		const verifierGrant = await fixture.pool.query<{ id: string }>(
			`select id from driving_licence_verifier_grant
			 where organization_id = $1 and verifier_employee_id = $2 and revoked_at is null`,
			[fixture.organizationId, person.employeeId],
		);
		const authorizations = await fixture.pool.query<{ id: string }>(
			`select id from driving_authorization where organization_id = $1 and employee_id = $2 order by id`,
			[fixture.organizationId, person.employeeId],
		);

		const shareLinkId = await seedShareLink(person);
		const shifts = await seedShifts(person);

		// Absences: one spanning the day they leave, two after it; and a colleague's they cover.
		const category = await fixture.pool.query<{ id: string }>(
			`insert into absence_category
			 (organization_id, type, name, requires_approval, counts_against_vacation, is_active, updated_at)
			 values ($1, 'vacation', 'Annual leave', true, true, true, now()) returning id`,
			[fixture.organizationId],
		);
		const categoryId = category.rows[0]?.id ?? "";
		clockNow = parseInstant("2026-10-20T09:00:00Z");
		const absences = {
			spanning: await seedOwnAbsence(person, manager, categoryId, {
				startDate: "2026-10-23",
				endDate: "2026-10-27",
				status: "approved",
			}),
			pending: await seedOwnAbsence(person, manager, categoryId, {
				startDate: "2026-11-02",
				endDate: "2026-11-03",
				status: "pending",
			}),
			approved: await seedOwnAbsence(person, manager, categoryId, {
				startDate: "2026-11-09",
				endDate: "2026-11-10",
				status: "approved",
			}),
		};
		const deputyAbsence = await fixture.pool.query<{ id: string }>(
			`insert into absence_entry (employee_id, category_id, start_date, end_date, status, organization_id,
				deputy_employee_id, deputy_assigned_at, created_at, updated_at)
			 values ($1, $2, '2026-11-16', '2026-11-17', 'approved', $3, $4, now(), now(), now()) returning id`,
			[keepsManager.employeeId, categoryId, fixture.organizationId, person.employeeId],
		);

		return {
			...people,
			teamId,
			grants: { expense: expense.grantId, payroll: payroll.grantId, personnelFile },
			verifierGrantId: verifierGrant.rows[0]?.id ?? "",
			authorizationIds: authorizations.rows.map((row) => row.id),
			badgeId: badge.badgeId,
			shareLinkId,
			shifts,
			absences,
			deputyAbsenceId: deputyAbsence.rows[0]?.id ?? "",
			duties: {
				toReplacement: {
					workflow: toReplacement.workflow,
					assignment: toReplacement.assignments[0] as string,
				},
				toReview: { workflow: toReview.workflow, assignment: toReview.assignments[0] as string },
				laterStage: { workflow: laterStage.workflow, stage: laterStage.secondStage as string },
			},
		};
	}

	beforeAll(async () => {
		fixture = await createLifecycleDatabaseFixture();
		seeded = await seed();
		harness.now = AT.toString();
		clockNow = AT;
		actAs(fixture.ownerUserId);
	});

	afterAll(async () => {
		await fixture?.close();
	});

	beforeEach(() => {
		createNotification.mockReset();
		createNotification.mockResolvedValue({ id: "notification" });
		harness.now = AT.toString();
		clockNow = AT;
		actAs(fixture.ownerUserId);
	});

	// ---- reads ---------------------------------------------------------------

	async function managerLinks() {
		const { rows } = await fixture.pool.query<{
			employee_id: string;
			manager_id: string;
			is_primary: boolean;
		}>(
			`select l.employee_id, l.manager_id, l.is_primary from employee_managers l
			 join employee e on e.id = l.employee_id
			 where e.organization_id = $1 order by l.employee_id, l.manager_id`,
			[fixture.organizationId],
		);
		return rows;
	}

	async function personState() {
		const { rows } = await fixture.pool.query<{
			is_active: boolean;
			deactivated_at: Date | null;
			team_id: string | null;
		}>(`select is_active, deactivated_at, team_id from employee where id = $1`, [
			seeded.person.employeeId,
		]);
		return rows[0];
	}

	async function deactivationRows() {
		const { rows } = await fixture.pool.query<{
			id: string;
			request_id: string;
			deactivated_at: Date;
			created_by: string;
			reason: string;
			replacement_managers: Record<string, string>;
			applied: DeactivationApplied;
		}>(
			`select id, request_id, deactivated_at, created_by, reason, replacement_managers, applied
			 from employee_deactivation where organization_id = $1 and employee_id = $2`,
			[fixture.organizationId, seeded.person.employeeId],
		);
		return rows;
	}

	async function deactivationAudits(deactivationId: string) {
		const { rows } = await fixture.pool.query<{
			action: string;
			entity_id: string;
			performed_by: string;
			metadata: string;
		}>(
			`select action, entity_id, performed_by, metadata from audit_log
			 where organization_id = $1 and metadata::jsonb ->> 'deactivationId' = $2
			 order by action, entity_id`,
			[fixture.organizationId, deactivationId],
		);
		return rows.map((row) => ({
			action: row.action,
			entityId: row.entity_id,
			performedBy: row.performed_by,
			metadata: JSON.parse(row.metadata) as Record<string, unknown>,
		}));
	}

	async function handoverTasks(deactivationId: string) {
		const { rows } = await fixture.pool.query<{
			id: string;
			payload: { assignmentId?: string; replacementEmployeeId?: string | null };
		}>(
			`select id, payload from employee_departure_task
			 where organization_id = $1 and deactivation_id = $2 and kind = 'approval_handover'`,
			[fixture.organizationId, deactivationId],
		);
		return rows;
	}

	async function reviews(deactivationId: string) {
		const { rows } = await fixture.pool.query<{
			id: string;
			subject_id: string | null;
			status: string;
			metadata: Record<string, unknown>;
		}>(
			`select id, subject_id, status, metadata from employee_departure_review
			 where organization_id = $1 and deactivation_id = $2 order by created_at, id`,
			[fixture.organizationId, deactivationId],
		);
		return rows;
	}

	async function pendingApprovers(workflowId: string) {
		const { rows } = await fixture.pool.query<{ approver_employee_id: string }>(
			`select approver_employee_id from approval_stage_assignment
			 where organization_id = $1 and workflow_id = $2 and status = 'pending'`,
			[fixture.organizationId, workflowId],
		);
		return rows.map((row) => row.approver_employee_id);
	}

	async function claim(taskId: string): Promise<DepartureTaskClaim> {
		const claimToken = randomUUID();
		const result = await fixture.pool.query(
			`update employee_departure_task
			 set status = 'processing', claim_token = $3, attempt_count = attempt_count + 1,
				available_at = $4, last_error = null
			 where organization_id = $1 and id = $2
			 returning id, employee_id, employment_period_id, departure_id, deactivation_id, kind, payload,
				attempt_count`,
			[
				fixture.organizationId,
				taskId,
				claimToken,
				new Date(AT.add({ minutes: 5 }).epochMilliseconds),
			],
		);
		const row = result.rows[0];
		return {
			id: row.id,
			organizationId: fixture.organizationId,
			employeeId: row.employee_id,
			employmentPeriodId: row.employment_period_id,
			departureId: row.departure_id,
			deactivationId: row.deactivation_id,
			kind: row.kind,
			payload: row.payload,
			claimToken,
			attemptCount: row.attempt_count,
		};
	}

	async function deliver(taskId: string) {
		const claimed = await claim(taskId);
		const outbox = createDepartureTaskOutbox(fixture.db);
		return runDepartureTaskDelivery({
			outbox: { ...outbox, claimDue: async () => [claimed] },
			now: AT,
			handlers: {
				approval_handover: createApprovalHandoverHandler({
					database: fixture.db,
					clock,
					runtime: createApprovalHandoverRuntime(
						fixture.db as unknown as ApprovalWorkflowDatabase,
						clock,
					),
				}),
			},
		});
	}

	/** What applying `plan` must change, derived from the plan alone. */
	function expectedApplied(plan: DeactivationPlan, personId: string) {
		const links = plan.managerLinks;
		const sortLinks = <T extends { employeeId: string; managerId: string }>(items: T[]) =>
			items.toSorted((a, b) =>
				`${a.employeeId}:${a.managerId}`.localeCompare(`${b.employeeId}:${b.managerId}`),
			);
		return {
			managerLinks: {
				removedLinks: sortLinks([
					...links.reportsKeepingAnotherManager.map((r) => ({
						employeeId: r.employeeId,
						managerId: personId,
					})),
					...links.reportsNeedingReplacement.map((r) => ({
						employeeId: r.employeeId,
						managerId: personId,
					})),
					...links.ownManagerLinks.map((l) => ({ employeeId: personId, managerId: l.employeeId })),
				]),
				addedLinks: sortLinks(
					links.reportsNeedingReplacement.map((r) => ({
						employeeId: r.employeeId,
						managerId: r.replacementEmployeeId as string,
						isPrimary: r.wasPrimary,
					})),
				),
				promotedLinks: sortLinks(
					links.reportsKeepingAnotherManager.flatMap((r) =>
						r.newPrimaryManagerId
							? [{ employeeId: r.employeeId, managerId: r.newPrimaryManagerId }]
							: [],
					),
				),
			},
			teamLinks: {
				teamIds: plan.teamLinks.teams.map((t) => t.teamId).toSorted(),
				projectAssignmentProjectIds: plan.teamLinks.projectAssignments
					.map((p) => p.projectId)
					.toSorted(),
				projectManagerProjectIds: plan.teamLinks.projectManagerLinks
					.map((p) => p.projectId)
					.toSorted(),
			},
			shifts: { openedShiftIds: plan.shifts.shiftsToOpen.map((s) => s.shiftId).toSorted() },
			absences: {
				cancelledAbsenceIds: plan.absences.absencesToCancel.map((a) => a.absenceId).toSorted(),
			},
			accessEnds: {
				grantIds: plan.accessEnds.grants.map((g) => g.grantId).toSorted(),
				drivingAuthorizationIds: plan.accessEnds.drivingAuthorizations
					.map((d) => d.authorizationId)
					.toSorted(),
				kioskBadgeIds: plan.accessEnds.kioskBadges.map((b) => b.badgeId).toSorted(),
				shareLinkIds: plan.accessEnds.shareLinks.map((l) => l.linkId).toSorted(),
			},
		};
	}

	function sortedApplied(applied: DeactivationApplied) {
		const sortLinks = <T extends { employeeId: string; managerId: string }>(items: T[]) =>
			items.toSorted((a, b) =>
				`${a.employeeId}:${a.managerId}`.localeCompare(`${b.employeeId}:${b.managerId}`),
			);
		return {
			managerLinks: {
				removedLinks: sortLinks(applied.managerLinks.removedLinks),
				addedLinks: sortLinks(applied.managerLinks.addedLinks),
				promotedLinks: sortLinks(applied.managerLinks.promotedLinks),
			},
			teamLinks: {
				teamIds: applied.teamLinks.teamIds.toSorted(),
				projectAssignmentProjectIds: applied.teamLinks.projectAssignmentProjectIds.toSorted(),
				projectManagerProjectIds: applied.teamLinks.projectManagerProjectIds.toSorted(),
			},
			shifts: { openedShiftIds: applied.shifts.openedShiftIds.toSorted() },
			absences: { cancelledAbsenceIds: applied.absences.cancelledAbsenceIds.toSorted() },
			accessEnds: {
				grantIds: applied.accessEnds.grantIds.toSorted(),
				drivingAuthorizationIds: applied.accessEnds.drivingAuthorizationIds.toSorted(),
				kioskBadgeIds: applied.accessEnds.kioskBadgeIds.toSorted(),
				shareLinkIds: applied.accessEnds.shareLinkIds.toSorted(),
			},
		};
	}

	// ---- the scenario, in order ----------------------------------------------

	let preview: DeactivationPlan;
	let deactivationId: string;
	const requestId = randomUUID();

	it("previews every consequence, asking for a replacement for the report left without a manager", async () => {
		const result = await previewEmployeeDeactivationAction({
			employeeId: seeded.person.employeeId,
		});
		if (!result.success) throw new Error(result.error);
		const plan = result.data;

		expect(plan.at).toBe(AT.toString());
		expect(plan.timeZone).toBe(ZONE);
		expect(plan.managerLinks.reportsNeedingReplacement).toEqual([
			{
				employeeId: seeded.orphan.employeeId,
				name: "Rita Report",
				wasPrimary: true,
				replacementEmployeeId: null,
				refusal: "replacement_missing",
			},
		]);
		expect(plan.managerLinks.reportsKeepingAnotherManager).toEqual([
			{
				employeeId: seeded.keepsManager.employeeId,
				name: "Kim Keeps",
				newPrimaryManagerId: seeded.manager.employeeId,
			},
		]);
		expect(plan.managerLinks.ownManagerLinks).toEqual([
			{ employeeId: seeded.manager.employeeId, name: "Mia Manager", isPrimary: true },
		]);
		const options = plan.managerLinks.replacementOptions.map((option) => option.employeeId);
		expect(options).toContain(seeded.replacement.employeeId);
		expect(options).not.toContain(seeded.plainEmployee.employeeId);
		expect(options).not.toContain(seeded.formerAdmin.employeeId);
		expect(options).not.toContain(seeded.person.employeeId);
		expect(plan.refusals).toEqual(["replacement_missing"]);
		expect(plan.teamLinks.teams).toEqual([{ teamId: seeded.teamId, name: "Floor team" }]);
		expect(plan.shifts.shiftsToOpen.map((shift) => shift.shiftId)).toEqual([seeded.shifts.future]);
		expect(plan.shifts.plannerRecipientUserIds).toEqual([seeded.manager.userId]);
		expect(plan.absences.absencesToCancel.map((item) => item.absenceId)).toEqual([
			seeded.absences.pending,
			seeded.absences.approved,
		]);
		expect(plan.absences.absencesSpanning.map((item) => item.absenceId)).toEqual([
			seeded.absences.spanning,
		]);
		expect(plan.accessEnds.grants.map((grant) => grant.kind).toSorted()).toEqual([
			"driving_licence_verifier",
			"expense_officer",
			"payroll_access",
			"personnel_file_officer",
		]);
		expect(plan.accessEnds.drivingAuthorizations).toHaveLength(2);
		expect(plan.accessEnds.kioskBadges).toEqual([{ badgeId: seeded.badgeId }]);
		expect(plan.accessEnds.shareLinks).toEqual([{ linkId: seeded.shareLinkId, kind: "project" }]);
		expect(plan.retentionStarts).toBe(true);
		expect(plan.seatReleased).toBe(true);
	});

	it("refuses without a replacement, with an ineligible one and with a former one, changing nothing", async () => {
		const before = await managerLinks();

		for (const replacementManagers of [
			{},
			{ [seeded.orphan.employeeId]: seeded.plainEmployee.employeeId },
			{ [seeded.orphan.employeeId]: seeded.formerAdmin.employeeId },
			// The report itself can't be their own manager.
			{ [seeded.orphan.employeeId]: seeded.orphan.employeeId },
		]) {
			const result = await deactivateEmployeeAction({
				employeeId: seeded.person.employeeId,
				requestId: randomUUID(),
				replacementManagers,
			});
			expect(result).toMatchObject({
				success: false,
				code: "ValidationError",
				refusal: "replacement_required",
			});
		}

		expect(await personState()).toMatchObject({ is_active: true, deactivated_at: null });
		expect(await managerLinks()).toEqual(before);
		expect(await deactivationRows()).toEqual([]);
		expect(createNotification).not.toHaveBeenCalled();
	});

	it("previews the chosen replacement, then applies exactly what the preview listed", async () => {
		const replacementManagers = { [seeded.orphan.employeeId]: seeded.replacement.employeeId };
		const previewed = await previewEmployeeDeactivationAction({
			employeeId: seeded.person.employeeId,
			replacementManagers,
		});
		if (!previewed.success) throw new Error(previewed.error);
		preview = previewed.data;
		expect(preview.refusals).toEqual([]);
		expect(preview.managerLinks.reportsNeedingReplacement[0]).toMatchObject({
			replacementEmployeeId: seeded.replacement.employeeId,
			refusal: null,
		});

		const result = await deactivateEmployeeAction({
			employeeId: seeded.person.employeeId,
			requestId,
			replacementManagers,
		});
		expect(result).toEqual({ success: true, data: undefined });

		const [row, ...others] = await deactivationRows();
		expect(others).toEqual([]);
		if (!row) throw new Error("no deactivation recorded");
		deactivationId = row.id;
		expect(row).toMatchObject({
			request_id: requestId,
			deactivated_at: new Date(AT.epochMilliseconds),
			created_by: fixture.ownerUserId,
			reason: "employee_deactivated",
			replacement_managers: replacementManagers,
		});
		// The preview lists every item the server applied, and nothing else.
		expect(sortedApplied(row.applied)).toEqual(expectedApplied(preview, seeded.person.employeeId));
		const tasks = await handoverTasks(deactivationId);
		expect(tasks.map((task) => task.payload.assignmentId).toSorted()).toEqual(
			preview.approvalDuties.handovers.map((handover) => handover.assignmentId).toSorted(),
		);
		expect(
			Object.fromEntries(
				tasks.map((task) => [task.payload.assignmentId, task.payload.replacementEmployeeId]),
			),
		).toEqual(
			Object.fromEntries(
				preview.approvalDuties.handovers.map((handover) => [
					handover.assignmentId,
					handover.targetEmployeeId,
				]),
			),
		);
		expect(row.applied.approvalDuties.handoverTaskIds.toSorted()).toEqual(
			tasks.map((task) => task.id).toSorted(),
		);
		const raised = await reviews(deactivationId);
		expect(raised.map((review) => review.subject_id)).toEqual(
			preview.approvalDuties.reviews.map((review) => review.stageId ?? review.approvalRequestId),
		);
		expect(row.applied.approvalDuties.reviewIds.toSorted()).toEqual(
			raised.map((review) => review.id).toSorted(),
		);

		// The planners hear about the opened shift exactly once, after the commit.
		const shiftNotices = createNotification.mock.calls
			.map(([input]) => input as { type: string; userId: string; message: string })
			.filter((input) => input.type === "employee_deactivation_shifts_opened");
		expect(shiftNotices).toEqual([
			expect.objectContaining({
				userId: seeded.manager.userId,
				message: "Pat Person was deactivated. 1 upcoming shift is open now.",
				idempotencyKey: `deactivation-shifts:${deactivationId}:${seeded.manager.userId}`,
			}),
		]);
	});

	it("switches the person off at the instant and records the history event", async () => {
		expect(await personState()).toEqual({
			is_active: false,
			deactivated_at: new Date(AT.epochMilliseconds),
			team_id: null,
		});
		const events = await fixture.pool.query<{
			kind: string;
			departure_id: string | null;
			metadata: unknown;
		}>(
			`select kind, departure_id, metadata from employee_departure_event
			 where organization_id = $1 and employee_id = $2 and kind = 'employee_deactivated'`,
			[fixture.organizationId, seeded.person.employeeId],
		);
		expect(events.rows).toEqual([
			{ kind: "employee_deactivated", departure_id: null, metadata: { deactivationId } },
		]);
	});

	it("ends the manager links: the replacement takes the orphaned report, the other manager becomes primary", async () => {
		const links = await managerLinks();
		const of = (employee: SeededEmployee) =>
			links
				.filter((row) => row.employee_id === employee.employeeId)
				.map((row) => ({ managerId: row.manager_id, isPrimary: row.is_primary }));
		expect(of(seeded.orphan)).toEqual([
			{ managerId: seeded.replacement.employeeId, isPrimary: true },
		]);
		expect(of(seeded.keepsManager)).toEqual([
			{ managerId: seeded.manager.employeeId, isPrimary: true },
		]);
		expect(of(seeded.person)).toEqual([]);
		expect(links.some((row) => row.manager_id === seeded.person.employeeId)).toBe(false);
	});

	it("hands approval duties to the replacement, and turns the rest into reviews", async () => {
		const tasks = await handoverTasks(deactivationId);
		for (const task of tasks) await deliver(task.id);

		expect(await pendingApprovers(seeded.duties.toReplacement.workflow)).toEqual([
			seeded.replacement.employeeId,
		]);
		const raised = await reviews(deactivationId);
		expect(raised).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					subject_id: seeded.duties.toReview.assignment,
					status: "open",
					metadata: expect.objectContaining({ reason: "no_replacement" }),
				}),
				expect.objectContaining({
					subject_id: seeded.duties.laterStage.stage,
					status: "open",
					metadata: expect.objectContaining({ reason: "future_stage_without_replacement" }),
				}),
			]),
		);
	});

	it("shows the deactivation's follow-up on the employee page and resolves a review with a replacement", async () => {
		const viewed = await getEmployeeOffboardingViewAction({ employeeId: seeded.person.employeeId });
		if (!viewed.success) throw new Error(viewed.error);
		expect(viewed.data.deactivation).toEqual({
			id: deactivationId,
			deactivatedAt: AT.toString(),
			timezone: ZONE,
		});
		expect(viewed.data.capabilities.resolve).toBe(true);
		const noReplacement = viewed.data.reviews.find((review) => review.reason === "no_replacement");
		expect(noReplacement?.handoverTaskId).toBeTruthy();
		expect(viewed.data.followUp.openReviews).toBe(2);

		const assigned = await assignDepartureReplacementAction({
			deactivationId,
			handoverTaskId: noReplacement?.handoverTaskId,
			replacementEmployeeId: seeded.replacement.employeeId,
			requestId: randomUUID(),
		});
		expect(assigned).toEqual({ success: true, data: undefined });
		await deliver(noReplacement?.handoverTaskId as string);

		expect(await pendingApprovers(seeded.duties.toReview.workflow)).toEqual([
			seeded.replacement.employeeId,
		]);
	});

	it("opens the future shift and keeps the past and running ones", async () => {
		const { rows } = await fixture.pool.query<{ id: string; employee_id: string | null }>(
			`select id, employee_id from shift where organization_id = $1 order by id`,
			[fixture.organizationId],
		);
		const byId = Object.fromEntries(rows.map((row) => [row.id, row.employee_id]));
		expect(byId[seeded.shifts.future]).toBeNull();
		expect(byId[seeded.shifts.past]).toBe(seeded.person.employeeId);
		expect(byId[seeded.shifts.running]).toBe(seeded.person.employeeId);
	});

	it("cancels the future absences through the normal path and keeps the spanning one", async () => {
		const state = async (absenceId: string) =>
			(
				await fixture.pool.query<{
					status: string | null;
					record: string | null;
					workflow: string | null;
				}>(
					`select a.status, r.id as record, w.status as workflow
					 from (select $1::uuid as id) probe
					 left join absence_entry a on a.id = probe.id
					 left join time_record r on r.id = a.canonical_record_id
					 left join approval_workflow w on w.source_type = 'absence_entry' and w.source_id = probe.id`,
					[absenceId],
				)
			).rows[0];
		// The absence and its record are gone, so the allowance they used is free again.
		for (const absenceId of [seeded.absences.pending, seeded.absences.approved]) {
			expect(await state(absenceId)).toEqual({ status: null, record: null, workflow: "cancelled" });
		}
		expect(await state(seeded.absences.spanning)).toMatchObject({
			status: "approved",
			workflow: "approved",
		});
		const balance = await fixture.pool.query<{ days: number }>(
			`select count(*)::int as days from absence_entry
			 where organization_id = $1 and employee_id = $2 and status in ('pending', 'approved')`,
			[fixture.organizationId, seeded.person.employeeId],
		);
		expect(balance.rows[0]?.days).toBe(1);
		// The deputy duty they held is released as before (#1014).
		const deputy = await fixture.pool.query<{ deputy_employee_id: string | null }>(
			`select deputy_employee_id from absence_entry where id = $1`,
			[seeded.deputyAbsenceId],
		);
		expect(deputy.rows[0]?.deputy_employee_id).toBeNull();
	});

	it("ends every grant, the driving authorizations (also suspended), the badge and the share link", async () => {
		const grants = await fixture.pool.query<{ is_active: boolean }>(
			`select is_active from expense_officer_grant where id = $1
			 union all select is_active from payroll_access_grant where id = $2
			 union all select is_active from personnel_file_officer_grant where id = $3`,
			[seeded.grants.expense, seeded.grants.payroll, seeded.grants.personnelFile],
		);
		expect(grants.rows.map((row) => row.is_active)).toEqual([false, false, false]);
		const verifier = await fixture.pool.query<{ revoked_at: Date | null }>(
			`select revoked_at from driving_licence_verifier_grant where id = $1`,
			[seeded.verifierGrantId],
		);
		expect(verifier.rows[0]?.revoked_at).toEqual(new Date(AT.epochMilliseconds));
		const authorizations = await fixture.pool.query<{ state: string }>(
			`select state from driving_authorization where id = any($1::uuid[])`,
			[seeded.authorizationIds],
		);
		expect(authorizations.rows.map((row) => row.state)).toEqual(["ended", "ended"]);
		const badge = await fixture.pool.query<{ revoked_at: Date | null }>(
			`select revoked_at from employee_kiosk_badge where id = $1`,
			[seeded.badgeId],
		);
		expect(badge.rows[0]?.revoked_at).toEqual(new Date(AT.epochMilliseconds));
		const link = await fixture.pool.query<{ revoke_reason: string | null }>(
			`select revoke_reason from report_share_link where id = $1`,
			[seeded.shareLinkId],
		);
		expect(link.rows[0]?.revoke_reason).toBe("creator_lost_access");
	});

	it("audits each consequence under the acting admin with the deactivation's reason", async () => {
		const audits = await deactivationAudits(deactivationId);
		expect(audits.map((audit) => audit.action).toSorted()).toEqual(
			[
				"absence.cancelled",
				"absence.cancelled",
				// Two current-stage duties handed over, one later stage turned into a review.
				"approval_duty.handed_over",
				"approval_duty.handed_over",
				"approval_duty.review_raised",
				"driving_authorization.ended",
				"driving_authorization.ended",
				"driving_licence.verifier_revoked",
				// The deactivation itself carries its id since #1441 (the history shows it once).
				"employee.deactivated",
				"expense_officer.grant_revoked",
				"kiosk_badge.revoked",
				"manager.assigned",
				"manager.primary_changed",
				"manager.removed",
				"manager.removed",
				"manager.removed",
				"payroll_access.grant_revoked",
				"personnel_file.grant_revoked",
				"report_share_link.auto_revoked",
				"shift.unassigned",
				"team.member_removed",
			].toSorted(),
		);
		for (const audit of audits) {
			expect(audit.performedBy).toBe(fixture.ownerUserId);
			expect(audit.metadata).toMatchObject({ reason: "employee_deactivated", deactivationId });
		}
		const deactivated = await fixture.pool.query(
			`select 1 from audit_log where organization_id = $1 and action = 'employee.deactivated'
			 and entity_id = $2`,
			[fixture.organizationId, seeded.person.employeeId],
		);
		expect(deactivated.rows).toHaveLength(1);
	});

	it("counts personnel file documents for retention from the deactivation instant", async () => {
		const employment = await loadRetentionEmployment(fixture.db, {
			organizationId: fixture.organizationId,
			employeeIds: [seeded.person.employeeId],
		});
		const periods = employment.get(seeded.person.employeeId) ?? [];
		expect(periods).toEqual([{ status: "closed", endedAt: AT }]);
		// A document of 2025 is kept from the start of the year after they left.
		expect(
			retentionStart({ periods, timezone: ZONE, documentDate: "2025-03-01" })?.toString(),
		).toBe("2027-01-01");
	});

	it("replays a retried request without applying anything twice", async () => {
		const audits = (await deactivationAudits(deactivationId)).length;
		const tasks = (await handoverTasks(deactivationId)).length;
		const reviewCount = (await reviews(deactivationId)).length;
		const links = await managerLinks();
		const history = await fixture.pool.query(
			`select 1 from employee_departure_event where organization_id = $1 and employee_id = $2`,
			[fixture.organizationId, seeded.person.employeeId],
		);
		const deactivatedAudits = await fixture.pool.query(
			`select 1 from audit_log where organization_id = $1 and action = 'employee.deactivated'`,
			[fixture.organizationId],
		);

		const result = await deactivateEmployeeAction({
			employeeId: seeded.person.employeeId,
			requestId,
			replacementManagers: { [seeded.orphan.employeeId]: seeded.replacement.employeeId },
		});

		expect(result).toEqual({ success: true, data: undefined });
		expect(await deactivationRows()).toHaveLength(1);
		expect(await deactivationAudits(deactivationId)).toHaveLength(audits);
		expect(await handoverTasks(deactivationId)).toHaveLength(tasks);
		expect(await reviews(deactivationId)).toHaveLength(reviewCount);
		expect(await managerLinks()).toEqual(links);
		expect(
			(
				await fixture.pool.query(
					`select 1 from employee_departure_event where organization_id = $1 and employee_id = $2`,
					[fixture.organizationId, seeded.person.employeeId],
				)
			).rows,
		).toHaveLength(history.rows.length);
		expect(
			(
				await fixture.pool.query(
					`select 1 from audit_log where organization_id = $1 and action = 'employee.deactivated'`,
					[fixture.organizationId],
				)
			).rows,
		).toHaveLength(deactivatedAudits.rows.length);
		// The planner notice is sent again under the same key, so the notification service keeps one.
		const shiftNotices = createNotification.mock.calls
			.map(([input]) => input as { type: string; idempotencyKey?: string; userId: string })
			.filter((input) => input.type === "employee_deactivation_shifts_opened");
		expect(shiftNotices).toEqual([
			expect.objectContaining({
				userId: seeded.manager.userId,
				idempotencyKey: `deactivation-shifts:${deactivationId}:${seeded.manager.userId}`,
			}),
		]);
	});

	it("refuses the same request ID with other choices", async () => {
		const result = await deactivateEmployeeAction({
			employeeId: seeded.person.employeeId,
			requestId,
			replacementManagers: { [seeded.orphan.employeeId]: seeded.manager.employeeId },
		});

		expect(result).toMatchObject({
			success: false,
			code: "ValidationError",
			refusal: "request_conflict",
		});
		expect(await deactivationRows()).toHaveLength(1);
	});

	it("never previews or deactivates an employee of another organization", async () => {
		const otherOrganizationId = await fixture.createOrganization();
		const otherOwner = await fixture.seedEmployee({
			organizationId: otherOrganizationId,
			role: "owner",
		});
		actAs(otherOwner.userId, otherOrganizationId);

		await expect(
			previewEmployeeDeactivationAction({ employeeId: seeded.keepsManager.employeeId }),
		).resolves.toMatchObject({ success: false, code: "NotFoundError" });
		await expect(
			deactivateEmployeeAction({
				employeeId: seeded.keepsManager.employeeId,
				requestId: randomUUID(),
				replacementManagers: {},
			}),
		).resolves.toMatchObject({ success: false, code: "NotFoundError" });
		const keeps = await fixture.pool.query<{ is_active: boolean }>(
			`select is_active from employee where id = $1`,
			[seeded.keepsManager.employeeId],
		);
		expect(keeps.rows[0]?.is_active).toBe(true);
	});

	// ---- #1441: reactivation restores nothing, records history, offers a checklist ----

	// 08:30 on Monday, 26 October 2026 in Berlin (after the switch to winter time).
	const REACTIVATED_AT = parseInstant("2026-10-26T07:30:00Z");

	/** Everything the deactivation ended, as stored. */
	async function endedState() {
		const one = async (text: string, values: unknown[]) =>
			(await fixture.pool.query(text, values)).rows;
		return {
			managerLinks: await managerLinks(),
			grants: await one(
				`select id, is_active from expense_officer_grant where organization_id = $1
				 union all select id, is_active from payroll_access_grant where organization_id = $1
				 union all select id, is_active from personnel_file_officer_grant where organization_id = $1
				 order by id`,
				[fixture.organizationId],
			),
			verifierGrants: await one(
				`select id, revoked_at from driving_licence_verifier_grant
				 where organization_id = $1 and verifier_employee_id = $2 order by id`,
				[fixture.organizationId, seeded.person.employeeId],
			),
			authorizations: await one(
				`select id, state from driving_authorization where organization_id = $1 and employee_id = $2
				 order by id`,
				[fixture.organizationId, seeded.person.employeeId],
			),
			badges: await one(
				`select id, revoked_at from employee_kiosk_badge where organization_id = $1 and employee_id = $2
				 order by id`,
				[fixture.organizationId, seeded.person.employeeId],
			),
			shareLinks: await one(
				`select id, revoked_at from report_share_link where organization_id = $1 order by id`,
				[fixture.organizationId],
			),
			shifts: await one(
				`select id, employee_id from shift where organization_id = $1 order by id`,
				[fixture.organizationId],
			),
			absences: await one(
				`select id, status from absence_entry where organization_id = $1 and employee_id = $2 order by id`,
				[fixture.organizationId, seeded.person.employeeId],
			),
			teams: await one(
				`select team_id from team_membership where organization_id = $1 and employee_id = $2`,
				[fixture.organizationId, seeded.person.employeeId],
			),
		};
	}

	it("reactivates without restoring any grant, badge, authorization, manager link, shift or absence", async () => {
		const before = await endedState();
		harness.now = REACTIVATED_AT.toString();
		clockNow = REACTIVATED_AT;

		const result = await reactivateEmployeeAction(seeded.person.employeeId);

		expect(result).toEqual({ success: true, data: undefined });
		expect(await endedState()).toEqual(before);
		expect(await personState()).toEqual({ is_active: true, deactivated_at: null, team_id: null });
		// The left-on instant is gone: they are on the current roster again.
		const leftAt = await fixture.pool.query<{ left_at: Date | null }>(
			`select employee_left_at(e.organization_id, e.id, e.deactivated_at, $2::timestamptz) as left_at
			 from employee e where e.id = $1`,
			[seeded.person.employeeId, new Date(REACTIVATED_AT.epochMilliseconds)],
		);
		expect(leftAt.rows[0]?.left_at).toBeNull();
		expect(
			await findEmployeesNotOnCurrentRoster(fixture.db, {
				organizationId: fixture.organizationId,
				employeeIds: [seeded.person.employeeId],
				now: REACTIVATED_AT,
			}),
		).toEqual([]);
		const ledger = await fixture.pool.query<{
			reactivated_at: Date | null;
			reactivated_by: string | null;
			reactivation_request_id: string | null;
		}>(
			`select reactivated_at, reactivated_by, reactivation_request_id from employee_deactivation
			 where organization_id = $1 and id = $2`,
			[fixture.organizationId, deactivationId],
		);
		expect(ledger.rows[0]).toMatchObject({
			reactivated_at: new Date(REACTIVATED_AT.epochMilliseconds),
			reactivated_by: fixture.ownerUserId,
			reactivation_request_id: expect.any(String),
		});
	});

	it("stops the personnel file retention clock", async () => {
		const employment = await loadRetentionEmployment(fixture.db, {
			organizationId: fixture.organizationId,
			employeeIds: [seeded.person.employeeId],
		});
		const periods = employment.get(seeded.person.employeeId) ?? [];
		expect(periods).toEqual([{ status: "open", endedAt: null }]);
		// No retention start, so no document of theirs is due.
		expect(retentionStart({ periods, timezone: ZONE, documentDate: "2025-03-01" })).toBeNull();
	});

	it("shows the deactivation and the reactivation in the employment history, with older audited ones", async () => {
		// A deactivation from before the events were recorded survives only in the audit log.
		for (const [action, timestamp] of [
			["employee.deactivated", "2026-03-02 09:15:00"],
			["employee.reactivated", "2026-03-09 09:15:00"],
		] as const) {
			await fixture.pool.query(
				`insert into audit_log (organization_id, entity_type, entity_id, action, performed_by, employee_id,
					changes, metadata, timestamp)
				 values ($1, 'employee', $2::text, $3, $4, $2::uuid, null, '{}', $5)`,
				[fixture.organizationId, seeded.person.employeeId, action, fixture.ownerUserId, timestamp],
			);
		}

		const result = await listEmployeeLifecycleHistoryAction(seeded.person.employeeId);

		expect(result).toEqual({
			success: true,
			data: {
				timeZone: ZONE,
				events: [
					{ kind: "reactivated", at: REACTIVATED_AT.toString() },
					{ kind: "deactivated", at: AT.toString() },
					{ kind: "reactivated", at: "2026-03-09T09:15:00Z" },
					{ kind: "deactivated", at: "2026-03-02T09:15:00Z" },
				],
			},
		});
	});

	it("offers a checklist of exactly what that deactivation ended, each linked to its settings page", async () => {
		const result = await getReactivationChecklistAction(seeded.person.employeeId);
		if (!result.success) throw new Error(result.error);
		const checklist = result.data;
		if (!checklist) throw new Error("no checklist");
		const person = seeded.person.employeeId;

		expect(checklist).toMatchObject({
			deactivationId,
			employeeId: person,
			deactivatedAt: AT.toString(),
			reactivatedAt: REACTIVATED_AT.toString(),
			timeZone: ZONE,
		});
		const grants = checklist.items.filter((item) => item.kind === "grant");
		expect(
			checklist.items.filter((item) => item.kind !== "grant" && item.kind !== "absence"),
		).toEqual([
			{
				group: "managers",
				kind: "report_moved",
				employeeId: seeded.orphan.employeeId,
				name: "Rita Report",
				newManagerName: "Anna Admin",
				href: `/settings/employees/${seeded.orphan.employeeId}`,
			},
			{
				group: "managers",
				kind: "report_link_ended",
				employeeId: seeded.keepsManager.employeeId,
				name: "Kim Keeps",
				href: `/settings/employees/${seeded.keepsManager.employeeId}`,
			},
			{
				group: "managers",
				kind: "own_manager",
				employeeId: seeded.manager.employeeId,
				name: "Mia Manager",
				href: `/settings/employees/${person}`,
			},
			{ group: "access", kind: "kiosk_badges", count: 1, href: `/settings/employees/${person}` },
			{
				group: "access",
				kind: "driving_authorizations",
				count: 2,
				href: `/driving-licence/checks/${person}`,
			},
			{
				group: "teams",
				kind: "team",
				id: seeded.teamId,
				name: "Floor team",
				href: `/settings/teams/${seeded.teamId}`,
			},
			{
				group: "shifts",
				kind: "shift",
				id: seeded.shifts.future,
				date: "2026-10-27",
				startTime: "09:00",
				endTime: "17:00",
				href: "/scheduling",
			},
			{
				group: "shareLinks",
				kind: "share_links",
				count: 1,
				href: "/settings/report-share-links",
			},
		]);
		expect(grants.map((item) => item.kind === "grant" && item.grant).toSorted()).toEqual([
			"driving_licence_verifier",
			"expense_officer",
			"payroll_access",
			"personnel_file_officer",
		]);
		expect(
			checklist.items
				.filter((item) => item.kind === "absence")
				.map((item) => (item.kind === "absence" ? [item.id, item.startDate, item.endDate] : null))
				.toSorted(),
		).toEqual(
			[
				[seeded.absences.pending, "2026-11-02", "2026-11-03"],
				[seeded.absences.approved, "2026-11-09", "2026-11-10"],
			].toSorted(),
		);
	});

	it("never shows or dismisses the checklist or history of another organization's employee", async () => {
		const otherOrganizationId = await fixture.createOrganization();
		const otherOwner = await fixture.seedEmployee({
			organizationId: otherOrganizationId,
			role: "owner",
		});
		actAs(otherOwner.userId, otherOrganizationId);

		expect(await getReactivationChecklistAction(seeded.person.employeeId)).toEqual({
			success: true,
			data: null,
		});
		await expect(
			listEmployeeLifecycleHistoryAction(seeded.person.employeeId),
		).resolves.toMatchObject({ success: false });
		await dismissReactivationChecklistAction({
			employeeId: seeded.person.employeeId,
			deactivationId,
		});

		actAs(fixture.ownerUserId);
		const still = await getReactivationChecklistAction(seeded.person.employeeId);
		expect(still.success && still.data?.deactivationId).toBe(deactivationId);
	});

	it("refuses the checklist to anyone but owners and admins", async () => {
		actAs(seeded.plainEmployee.userId);
		await expect(getReactivationChecklistAction(seeded.person.employeeId)).resolves.toMatchObject({
			success: false,
		});
		await expect(
			dismissReactivationChecklistAction({ employeeId: seeded.person.employeeId, deactivationId }),
		).resolves.toMatchObject({ success: false });
	});

	it("hides the checklist for every admin once one dismisses it", async () => {
		const dismissed = await dismissReactivationChecklistAction({
			employeeId: seeded.person.employeeId,
			deactivationId,
		});
		expect(dismissed).toEqual({ success: true, data: undefined });

		expect(await getReactivationChecklistAction(seeded.person.employeeId)).toEqual({
			success: true,
			data: null,
		});
		actAs(seeded.replacement.userId);
		expect(await getReactivationChecklistAction(seeded.person.employeeId)).toEqual({
			success: true,
			data: null,
		});
		const row = await fixture.pool.query<{ checklist_dismissed_by: string | null }>(
			`select checklist_dismissed_by from employee_deactivation where organization_id = $1 and id = $2`,
			[fixture.organizationId, deactivationId],
		);
		expect(row.rows[0]?.checklist_dismissed_by).toBe(fixture.ownerUserId);
	});
});
