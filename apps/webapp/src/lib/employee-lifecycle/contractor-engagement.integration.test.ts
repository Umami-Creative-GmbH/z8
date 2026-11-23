/**
 * #1995 (spec #1935): External Contractors as an engagement kind. One suite at
 * the lifecycle's interfaces against PostgreSQL: the engagement kind on the
 * employee and every employment period, the invariant refusing an in-place
 * change on an active period, contractor joining, conversion by ending the
 * period and starting a new one, billable seats, and contractor employment
 * ending without employee-only payroll reconciliation.
 */
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { type Instant, parseInstant } from "@/lib/datetime/temporal-core";

vi.mock("next/headers", async () => (await import("@/test/integration-harness")).nextHeaders());
vi.mock("next/cache", async (original) =>
	(await import("@/test/integration-harness")).nextCache(original),
);
vi.mock("@/lib/queue", async (original) =>
	(await import("@/test/integration-harness")).calendarSyncQueue(original),
);
vi.mock("@/lib/billing/seat-sync-trigger", () => ({
	reconcileBillingSeatsForOrganization: async () => undefined,
	syncBillingSeatsAfterMemberChange: async () => undefined,
}));
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

const { createDepartureCommands } = await import("./commands");
const { joinOrganization } = await import("./joining/joining");
const { previewPastDeparture } = await import("./queries");
const { deactivate } = await import("./deactivation/command");
const { db } = await import("@/db");
const { persistEmployeeInvitationDraft } = await import("@/lib/auth/employee-invitation-draft");
const { countBillableSeats, countBillableSeatsByType } =
	await import("@/lib/effect/services/billing/billable-seat-count");
const { createLifecycleDatabaseFixture } = await import("./testing/database.test.fixture");
const { isEngagementKindChangeRefusal } = await import("@/lib/engagement/engagement-kind");
type LifecycleDatabaseFixture = import("./testing/database.test.fixture").LifecycleDatabaseFixture;
type SeededEmployee = import("./testing/database.test.fixture").SeededEmployee;
type DepartureClockOutPort = import("./types").DepartureClockOutPort;

const clockOut: DepartureClockOutPort = {
	async close() {
		return { kind: "not_running" };
	},
};

const TODAY = parseInstant("2026-10-10T12:00:00Z");

describe("external contractor engagement kind (#1995)", () => {
	let fixture: LifecycleDatabaseFixture;
	let now: Instant = TODAY;
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

	function ownerActor() {
		return { userId: fixture.ownerUserId, organizationId: fixture.organizationId };
	}

	/** A current contractor: the employee and its open period carry `contractor`. */
	function seedContractor(): Promise<SeededEmployee> {
		return fixture.seedEmployee({ engagementKind: "contractor" });
	}

	async function engagementOf(employeeId: string) {
		const employeeRow = await fixture.pool.query<{ engagement_kind: string }>(
			"select engagement_kind from employee where id = $1",
			[employeeId],
		);
		const periods = await fixture.pool.query<{
			id: string;
			status: string;
			engagement_kind: string;
		}>(
			`select id, status, engagement_kind from employee_employment_period
			 where employee_id = $1 order by started_at nulls first, created_at`,
			[employeeId],
		);
		return { employee: employeeRow.rows[0]?.engagement_kind, periods: periods.rows };
	}

	async function refusalOf(statement: Promise<unknown>) {
		try {
			await statement;
		} catch (error) {
			return error;
		}
		throw new Error("expected the statement to be refused");
	}

	describe("engagement kind on the employee and its employment periods", () => {
		it("defaults existing and new employees and their periods to employee", async () => {
			const person = await fixture.seedEmployee();

			expect(await engagementOf(person.employeeId)).toEqual({
				employee: "employee",
				periods: [{ id: person.employmentPeriodId, status: "open", engagement_kind: "employee" }],
			});
		});

		it("gives a lazily backfilled legacy period the employee's engagement kind", async () => {
			const person = await fixture.seedEmployee({
				withPeriod: false,
				engagementKind: "contractor",
			});
			await fixture.pool.query("select employee_employment_period_backfill_legacy($1, $2::uuid)", [
				fixture.organizationId,
				person.employeeId,
			]);

			const engagement = await engagementOf(person.employeeId);
			expect(engagement.employee).toBe("contractor");
			expect(engagement.periods).toEqual([
				expect.objectContaining({ status: "open", engagement_kind: "contractor" }),
			]);
		});

		it("rejects an engagement kind other than employee or contractor", async () => {
			const person = await fixture.seedEmployee();
			await expect(
				fixture.pool.query(
					`insert into employee_employment_period
					 (organization_id, employee_id, status, started_at, ended_at, start_provenance, engagement_kind)
					 values ($1, $2, 'closed', '2025-01-01T00:00:00Z', '2025-02-01T00:00:00Z', 'recorded', 'freelancer')`,
					[fixture.organizationId, person.employeeId],
				),
			).rejects.toThrow(/check constraint/);
		});
	});

	describe("no in-place change of the engagement kind on an active period", () => {
		it("refuses switching an active contractor to employee on the employee row", async () => {
			const contractor = await seedContractor();

			const refusal = await refusalOf(
				fixture.pool.query(`update employee set engagement_kind = 'employee' where id = $1`, [
					contractor.employeeId,
				]),
			);

			expect(isEngagementKindChangeRefusal(refusal)).toBe(true);
			expect((await engagementOf(contractor.employeeId)).employee).toBe("contractor");
		});

		it("refuses switching an employee whose first period is not backfilled yet", async () => {
			const person = await fixture.seedEmployee({ withPeriod: false });

			const refusal = await refusalOf(
				fixture.pool.query(`update employee set engagement_kind = 'contractor' where id = $1`, [
					person.employeeId,
				]),
			);

			expect(isEngagementKindChangeRefusal(refusal)).toBe(true);
		});

		it("refuses switching an active employee to contractor on the employee row", async () => {
			const person = await fixture.seedEmployee();

			const refusal = await refusalOf(
				// Through Drizzle, as application code reaches PostgreSQL.
				fixture.db.execute(
					sql`update employee set engagement_kind = 'contractor' where id = ${person.employeeId}::uuid`,
				),
			);

			expect(isEngagementKindChangeRefusal(refusal)).toBe(true);
		});

		it("never rewrites the engagement kind of a period, open or closed", async () => {
			const contractor = await seedContractor();

			const openRefusal = await refusalOf(
				fixture.pool.query(
					`update employee_employment_period set engagement_kind = 'employee' where id = $1`,
					[contractor.employmentPeriodId],
				),
			);
			await fixture.pool.query(
				`update employee_employment_period set status = 'closed', ended_at = '2026-02-01T00:00:00Z'
				 where id = $1`,
				[contractor.employmentPeriodId],
			);
			const closedRefusal = await refusalOf(
				fixture.pool.query(
					`update employee_employment_period set engagement_kind = 'employee' where id = $1`,
					[contractor.employmentPeriodId],
				),
			);

			expect(isEngagementKindChangeRefusal(openRefusal)).toBe(true);
			expect(isEngagementKindChangeRefusal(closedRefusal)).toBe(true);
		});

		it("refuses switching a former employee whose periods are all closed", async () => {
			const person = await fixture.seedEmployee();
			await fixture.pool.query(
				`update employee_employment_period set status = 'closed', ended_at = '2026-02-01T00:00:00Z'
				 where id = $1`,
				[person.employmentPeriodId],
			);

			const refusal = await refusalOf(
				fixture.pool.query(`update employee set engagement_kind = 'contractor' where id = $1`, [
					person.employeeId,
				]),
			);

			expect(isEngagementKindChangeRefusal(refusal)).toBe(true);
			expect((await engagementOf(person.employeeId)).employee).toBe("employee");
		});

		it("keeps an unrelated employee update working for a contractor", async () => {
			const contractor = await seedContractor();
			await fixture.pool.query(
				`update employee set position = 'Consultant', engagement_kind = 'contractor' where id = $1`,
				[contractor.employeeId],
			);
			expect((await engagementOf(contractor.employeeId)).employee).toBe("contractor");
		});
	});

	describe("joining as an External Contractor", () => {
		async function seedTeam() {
			const { rows } = await fixture.pool.query<{ id: string }>(
				`insert into team (organization_id, name, updated_at) values ($1, $2, now()) returning id`,
				[fixture.organizationId, `Delivery ${randomUUID()}`],
			);
			return rows[0]?.id as string;
		}

		async function seedProject() {
			const { rows } = await fixture.pool.query<{ id: string }>(
				`insert into project (organization_id, name, created_by, updated_at)
				 values ($1, $2, $3, now()) returning id`,
				[fixture.organizationId, `Client rollout ${randomUUID()}`, fixture.ownerUserId],
			);
			return rows[0]?.id as string;
		}

		/** A user who just accepted a contractor invitation and holds an approved membership. */
		async function acceptedContractorInvitation(draft: {
			teamId: string | null;
			projectIds: string[];
			plannedEndDate: string | null;
		}) {
			const userId = randomUUID();
			const memberId = randomUUID();
			const email = `${userId}@contractor.test`;
			await fixture.pool.query(
				`insert into "user" (id, name, email, created_at, updated_at) values ($1, 'Contractor', $2, now(), now())`,
				[userId, email],
			);
			await fixture.pool.query(
				`insert into member (id, organization_id, user_id, role, status, created_at)
				 values ($1, $2, $3, 'member', 'approved', now())`,
				[memberId, fixture.organizationId, userId],
			);
			const invitationId = randomUUID();
			await fixture.pool.query(
				`insert into invitation (id, organization_id, email, role, status, expires_at, inviter_id)
				 values ($1, $2, $3, 'member', 'accepted', now() + interval '7 days', $4)`,
				[invitationId, fixture.organizationId, email, fixture.ownerUserId],
			);
			// Employee-only values on the draft (an hourly wage) must not be applied.
			await fixture.pool.query(
				`insert into employee_invitation_draft
				   (invitation_id, organization_id, normalized_email, team_id, role, first_name,
				    contract_type, current_hourly_rate, engagement_kind, contractor_company_name,
				    contractor_vat_id, contractor_reference_code, planned_end_date, project_ids, updated_by)
				 values ($1, $2, $3, $4, 'employee', 'Grace', 'hourly', '95.00', 'contractor',
				         'Hopper Consulting GmbH', 'DE123456789', 'PO-4711', $5, $6::uuid[], $7)`,
				[
					invitationId,
					fixture.organizationId,
					email,
					draft.teamId,
					draft.plannedEndDate,
					draft.projectIds,
					fixture.ownerUserId,
				],
			);
			return { userId, memberId, invitationId };
		}

		it("creates a contractor with its contracting details, team and projects, and no employee terms", async () => {
			const teamId = await seedTeam();
			const projectId = await seedProject();
			const joiner = await acceptedContractorInvitation({
				teamId,
				projectIds: [projectId],
				plannedEndDate: null,
			});

			const joining = await fixture.db.transaction((tx) =>
				joinOrganization(tx, {
					organizationId: fixture.organizationId,
					userId: joiner.userId,
					membership: { id: joiner.memberId, role: "member" },
					invitation: { id: joiner.invitationId },
				}),
			);
			await joining.afterCommit.run();

			expect(joining.outcome.kind).toBe("joined");
			const employeeId = joining.outcome.employee.id;
			expect(joining.outcome.employee.engagementKind).toBe("contractor");
			const { rows } = await fixture.pool.query(
				`select e.engagement_kind, e.team_id,
				   (select count(*)::int from employee_employment_history h where h.employee_id = e.id) as terms,
				   (select row_to_json(p) from (
				      select company_name, vat_id, reference_code from employee_contractor_profile
				      where organization_id = e.organization_id and employee_id = e.id) p) as profile,
				   (select coalesce(array_agg(a.project_id::text), '{}') from project_assignment a
				      where a.employee_id = e.id and a.organization_id = e.organization_id) as projects
				 from employee e where e.id = $1`,
				[employeeId],
			);
			expect(rows[0]).toEqual({
				engagement_kind: "contractor",
				team_id: teamId,
				terms: 0,
				profile: {
					company_name: "Hopper Consulting GmbH",
					vat_id: "DE123456789",
					reference_code: "PO-4711",
				},
				projects: [projectId],
			});
			await fixture.pool.query("select employee_employment_period_backfill_legacy($1, $2::uuid)", [
				fixture.organizationId,
				employeeId,
			]);
			expect((await engagementOf(employeeId)).periods).toEqual([
				expect.objectContaining({ status: "open", engagement_kind: "contractor" }),
			]);
		});

		it("joins a contractor from the draft a contractor invitation persisted, and a resend keeps it", async () => {
			const projectId = await seedProject();
			const userId = randomUUID();
			const email = `${userId}@contractor.test`;
			const invitationId = randomUUID();
			await fixture.pool.query(
				`insert into invitation (id, organization_id, email, role, status, expires_at, inviter_id)
				 values ($1, $2, $3, 'member', 'pending', now() + interval '7 days', $4)`,
				[invitationId, fixture.organizationId, email, fixture.ownerUserId],
			);
			const draftInput = {
				organizationId: fixture.organizationId,
				normalizedEmail: email,
				invitationId,
				canCreateOrganizations: false,
				targetTeamId: null,
				initialRole: "employee" as const,
				updatedBy: fixture.ownerUserId,
			};
			await persistEmployeeInvitationDraft(db, {
				...draftInput,
				engagement: {
					kind: "contractor",
					contractor: {
						companyName: "Lovelace Analytics Ltd",
						vatId: null,
						referenceCode: "CC-200",
						projectIds: [projectId],
						plannedEndDate: null,
					},
				},
			});
			// A resend names no engagement and must keep the contractor's.
			await persistEmployeeInvitationDraft(db, draftInput);

			await fixture.pool.query(
				`insert into "user" (id, name, email, created_at, updated_at) values ($1, 'Ada', $2, now(), now())`,
				[userId, email],
			);
			const memberId = randomUUID();
			await fixture.pool.query(
				`insert into member (id, organization_id, user_id, role, status, created_at)
				 values ($1, $2, $3, 'member', 'approved', now())`,
				[memberId, fixture.organizationId, userId],
			);
			await fixture.pool.query(`update invitation set status = 'accepted' where id = $1`, [
				invitationId,
			]);
			const joining = await fixture.db.transaction((tx) =>
				joinOrganization(tx, {
					organizationId: fixture.organizationId,
					userId,
					membership: { id: memberId, role: "member" },
					invitation: { id: invitationId },
				}),
			);
			await joining.afterCommit.run();

			expect(joining.outcome.employee.engagementKind).toBe("contractor");
			const { rows } = await fixture.pool.query(
				`select p.company_name, p.vat_id, p.reference_code,
				   exists (select 1 from project_assignment a where a.employee_id = p.employee_id
				     and a.project_id = $2) as assigned
				 from employee_contractor_profile p where p.employee_id = $1`,
				[joining.outcome.employee.id, projectId],
			);
			expect(rows).toEqual([
				{
					company_name: "Lovelace Analytics Ltd",
					vat_id: null,
					reference_code: "CC-200",
					assigned: true,
				},
			]);
		});

		it("brings a deactivated employee back as an employee, applying neither the contractor draft nor its stale employee terms", async () => {
			const projectId = await seedProject();
			const person = await fixture.seedEmployee({ isActive: false });
			const email = `${person.userId}@lifecycle.test`;
			const invitationId = randomUUID();
			await fixture.pool.query(
				`insert into invitation (id, organization_id, email, role, status, expires_at, inviter_id)
				 values ($1, $2, $3, 'member', 'accepted', now() + interval '7 days', $4)`,
				[invitationId, fixture.organizationId, email, fixture.ownerUserId],
			);
			// A contractor invitation over an older hourly draft: its wage is still on the row.
			const { rows: drafts } = await fixture.pool.query<{ id: string }>(
				`insert into employee_invitation_draft
				   (invitation_id, organization_id, normalized_email, role, contract_type,
				    current_hourly_rate, engagement_kind, contractor_company_name, planned_end_date,
				    project_ids, updated_by)
				 values ($1, $2, $3, 'employee', 'hourly', '95.00', 'contractor', 'Hopper Consulting GmbH',
				         '2099-06-30', $4::uuid[], $5)
				 returning id`,
				[invitationId, fixture.organizationId, email, [projectId], fixture.ownerUserId],
			);

			const joining = await fixture.db.transaction((tx) =>
				joinOrganization(tx, {
					organizationId: fixture.organizationId,
					userId: person.userId,
					membership: { id: person.memberId, role: "member" },
					invitation: { id: invitationId },
				}),
			);
			await joining.afterCommit.run();

			expect(joining.outcome).toMatchObject({
				kind: "reactivated",
				employee: { engagementKind: "employee", contractType: "fixed" },
			});
			const { rows } = await fixture.pool.query(
				`select
				   (select count(*)::int from employee_employment_history h where h.employee_id = e.id) as terms,
				   (select count(*)::int from employee_contractor_profile p where p.employee_id = e.id) as profiles,
				   (select count(*)::int from project_assignment a where a.employee_id = e.id) as projects,
				   (select count(*)::int from employee_departure d where d.employee_id = e.id) as departures
				 from employee e where e.id = $1`,
				[person.employeeId],
			);
			expect(rows[0]).toEqual({ terms: 0, profiles: 0, projects: 0, departures: 0 });
			// The open employee period stays; converting needs an ended period and a rehire.
			expect(await engagementOf(person.employeeId)).toEqual({
				employee: "employee",
				periods: [{ id: person.employmentPeriodId, status: "open", engagement_kind: "employee" }],
			});
			const { rows: audits } = await fixture.pool.query<{ metadata: string }>(
				`select metadata from audit_log where organization_id = $1 and entity_id = $2
				 and action = 'employee.invitation_draft_not_applied'`,
				[fixture.organizationId, drafts[0]?.id],
			);
			expect(audits.map((audit) => JSON.parse(audit.metadata))).toEqual([
				expect.objectContaining({
					reason: "engagement_kind_differs",
					draftEngagementKind: "contractor",
					employeeEngagementKind: "employee",
				}),
			]);
		});

		it("clears a draft's employee-only terms when a contractor invitation replaces it, and its contracting details when an employee invitation does", async () => {
			const projectId = await seedProject();
			const email = `${randomUUID()}@draft.test`;
			async function invite() {
				const invitationId = randomUUID();
				await fixture.pool.query(
					`insert into invitation (id, organization_id, email, role, status, expires_at, inviter_id)
					 values ($1, $2, $3, 'member', 'pending', now() + interval '7 days', $4)`,
					[invitationId, fixture.organizationId, email, fixture.ownerUserId],
				);
				return {
					organizationId: fixture.organizationId,
					normalizedEmail: email,
					invitationId,
					canCreateOrganizations: false,
					targetTeamId: null,
					initialRole: "employee" as const,
					updatedBy: fixture.ownerUserId,
				};
			}
			async function draftTerms() {
				const { rows } = await fixture.pool.query(
					`select engagement_kind, contract_type, current_hourly_rate, contractor_company_name,
					   planned_end_date::text, project_ids::text[]
					 from employee_invitation_draft where organization_id = $1 and normalized_email = $2`,
					[fixture.organizationId, email],
				);
				return rows[0];
			}

			await persistEmployeeInvitationDraft(db, {
				...(await invite()),
				engagement: { kind: "employee", contractor: null },
			});
			await fixture.pool.query(
				`update employee_invitation_draft set contract_type = 'hourly', current_hourly_rate = '95.00'
				 where organization_id = $1 and normalized_email = $2`,
				[fixture.organizationId, email],
			);
			await persistEmployeeInvitationDraft(db, {
				...(await invite()),
				engagement: {
					kind: "contractor",
					contractor: {
						companyName: "Hopper Consulting GmbH",
						vatId: null,
						referenceCode: null,
						projectIds: [projectId],
						plannedEndDate: "2099-06-30",
					},
				},
			});
			const asContractor = await draftTerms();
			await persistEmployeeInvitationDraft(db, {
				...(await invite()),
				engagement: { kind: "employee", contractor: null },
			});

			expect(asContractor).toEqual({
				engagement_kind: "contractor",
				contract_type: "fixed",
				current_hourly_rate: null,
				contractor_company_name: "Hopper Consulting GmbH",
				planned_end_date: "2099-06-30",
				project_ids: [projectId],
			});
			expect(await draftTerms()).toEqual({
				engagement_kind: "employee",
				contract_type: "fixed",
				current_hourly_rate: null,
				contractor_company_name: null,
				planned_end_date: null,
				project_ids: [],
			});
		});

		it("schedules the planned engagement end as a departure once the contractor joined", async () => {
			const joiner = await acceptedContractorInvitation({
				teamId: null,
				projectIds: [],
				plannedEndDate: "2099-06-30",
			});

			const joining = await fixture.db.transaction((tx) =>
				joinOrganization(tx, {
					organizationId: fixture.organizationId,
					userId: joiner.userId,
					membership: { id: joiner.memberId, role: "member" },
					invitation: { id: joiner.invitationId },
				}),
			);
			const { rows: before } = await fixture.pool.query(
				"select 1 from employee_departure where employee_id = $1",
				[joining.outcome.employee.id],
			);
			await joining.afterCommit.run();

			expect(before).toEqual([]);
			const { rows } = await fixture.pool.query(
				`select mode, status, last_working_day::text, created_by from employee_departure
				 where organization_id = $1 and employee_id = $2`,
				[fixture.organizationId, joining.outcome.employee.id],
			);
			expect(rows).toEqual([
				{
					mode: "scheduled",
					status: "pending",
					last_working_day: "2099-06-30",
					created_by: fixture.ownerUserId,
				},
			]);
		});
	});

	describe("converting by ending the period and starting a new one", () => {
		async function seedWorkPolicy() {
			const { rows } = await fixture.pool.query<{ id: string }>(
				`insert into work_policy (organization_id, name, schedule_enabled, regulation_enabled,
				   presence_enabled, is_active, created_by, updated_at)
				 values ($1, $2, true, false, false, true, $3, now()) returning id`,
				[fixture.organizationId, `Policy ${randomUUID()}`, fixture.ownerUserId],
			);
			return rows[0]?.id as string;
		}

		async function offboardNow(person: SeededEmployee) {
			const result = await commands().offboardNow(ownerActor(), {
				employeeId: person.employeeId,
				requestId: randomUUID(),
				replacementEmployeeId: null,
				acknowledgeUnassignedDuties: true,
			});
			expect(result.status).toBe("effective");
		}

		const employeeTerms = {
			role: "employee" as const,
			teamId: null,
			primaryManagerId: null,
			weeklyContractMinutes: 2400,
			contractType: "fixed" as const,
			workModel: "onsite" as const,
			hourlyRate: null,
			currency: "EUR",
			probationStartsOn: null,
			probationEndsOn: null,
			changeReason: null,
		};

		async function termsOf(employeeId: string) {
			const { rows } = await fixture.pool.query<{ employment_period_id: string }>(
				`select employment_period_id from employee_employment_history where employee_id = $1`,
				[employeeId],
			);
			return rows.map((row) => row.employment_period_id);
		}

		it("hires a former contractor as an employee on a new period, keeping the contractor stint", async () => {
			now = parseInstant("2026-03-02T10:00:00Z");
			const contractor = await seedContractor();
			const workPolicyId = await seedWorkPolicy();
			await offboardNow(contractor);

			now = parseInstant("2026-04-01T09:00:00Z");
			const rehired = await commands().rehireEmployee(ownerActor(), {
				...employeeTerms,
				employeeId: contractor.employeeId,
				requestId: randomUUID(),
				previousEmploymentPeriodId: contractor.employmentPeriodId,
				engagementKind: "employee",
				workPolicyId,
			});

			expect(await engagementOf(contractor.employeeId)).toEqual({
				employee: "employee",
				periods: [
					{ id: contractor.employmentPeriodId, status: "closed", engagement_kind: "contractor" },
					{ id: rehired.employmentPeriodId, status: "open", engagement_kind: "employee" },
				],
			});
			expect(await termsOf(contractor.employeeId)).toEqual([rehired.employmentPeriodId]);
		});

		it("engages a former employee as a contractor without employee terms or work policy", async () => {
			now = parseInstant("2026-03-02T10:00:00Z");
			const person = await fixture.seedEmployee();
			await offboardNow(person);

			now = parseInstant("2026-04-01T09:00:00Z");
			const rehired = await commands().rehireEmployee(ownerActor(), {
				...employeeTerms,
				employeeId: person.employeeId,
				requestId: randomUUID(),
				previousEmploymentPeriodId: person.employmentPeriodId,
				engagementKind: "contractor",
				workPolicyId: null,
			});

			expect(await engagementOf(person.employeeId)).toEqual({
				employee: "contractor",
				periods: [
					{ id: person.employmentPeriodId, status: "closed", engagement_kind: "employee" },
					{ id: rehired.employmentPeriodId, status: "open", engagement_kind: "contractor" },
				],
			});
			expect(await termsOf(person.employeeId)).toEqual([]);
			const { rows } = await fixture.pool.query(
				`select 1 from work_policy_assignment where employee_id = $1 and is_active`,
				[person.employeeId],
			);
			expect(rows).toEqual([]);
		});

		it("refuses converting in place even while a departure is only scheduled", async () => {
			now = parseInstant("2026-03-02T10:00:00Z");
			const contractor = await seedContractor();
			await commands().scheduleDeparture(ownerActor(), {
				employeeId: contractor.employeeId,
				requestId: randomUUID(),
				expectedRevision: null,
				lastWorkingDay: "2026-03-31",
				replacementEmployeeId: null,
				acknowledgeUnassignedDuties: true,
			});

			const refusal = await refusalOf(
				fixture.pool.query(`update employee set engagement_kind = 'employee' where id = $1`, [
					contractor.employeeId,
				]),
			);
			expect(isEngagementKindChangeRefusal(refusal)).toBe(true);
		});

		it("still requires a work policy to rehire as an employee", async () => {
			now = parseInstant("2026-03-02T10:00:00Z");
			const contractor = await seedContractor();
			await offboardNow(contractor);

			now = parseInstant("2026-04-01T09:00:00Z");
			await expect(
				commands().rehireEmployee(ownerActor(), {
					...employeeTerms,
					employeeId: contractor.employeeId,
					requestId: randomUUID(),
					previousEmploymentPeriodId: contractor.employmentPeriodId,
					engagementKind: "employee",
					workPolicyId: null,
				}),
			).rejects.toMatchObject({ code: "rehire_terms_invalid" });
			expect((await engagementOf(contractor.employeeId)).employee).toBe("contractor");
		});
	});

	describe("billable seats", () => {
		// A seat count at the test's own instant, on its own organization.
		async function seats(organizationId: string) {
			return {
				total: await countBillableSeats(fixture.db, organizationId, { now }),
				byType: await countBillableSeatsByType(fixture.db, organizationId, {
					now,
					kioskSeats: true,
				}),
			};
		}

		it("counts an active contractor as a full seat and drops it the moment a departure ends the engagement", async () => {
			now = parseInstant("2026-03-02T10:00:00Z");
			const organizationId = await fixture.createOrganization();
			await fixture.seedEmployee({ organizationId, role: "owner" });
			const contractor = await fixture.seedEmployee({
				organizationId,
				engagementKind: "contractor",
			});
			expect(await seats(organizationId)).toEqual({ total: 2, byType: { full: 2, kiosk: 0 } });

			const owner = await fixture.pool.query<{ user_id: string }>(
				`select m.user_id from member m where m.organization_id = $1 and m.role = 'owner'`,
				[organizationId],
			);
			const departed = await commands().offboardNow(
				{ userId: owner.rows[0]?.user_id as string, organizationId },
				{
					employeeId: contractor.employeeId,
					requestId: randomUUID(),
					replacementEmployeeId: null,
					acknowledgeUnassignedDuties: true,
				},
			);

			expect(departed.status).toBe("effective");
			expect(await seats(organizationId)).toEqual({ total: 1, byType: { full: 1, kiosk: 0 } });
			// The durable seat sync of the departure reconciles Stripe.
			const { rows } = await fixture.pool.query(
				`select kind from employee_departure_task
				 where organization_id = $1 and employee_id = $2 and kind = 'billing_sync'`,
				[organizationId, contractor.employeeId],
			);
			expect(rows).toHaveLength(1);
		});

		it("drops a contractor's seat on deactivation and recounts seats after commit", async () => {
			now = parseInstant("2026-03-02T10:00:00Z");
			const organizationId = await fixture.createOrganization();
			const owner = await fixture.seedEmployee({ organizationId, role: "owner" });
			const contractor = await fixture.seedEmployee({
				organizationId,
				engagementKind: "contractor",
			});
			expect((await seats(organizationId)).total).toBe(2);
			const reconcileSeats = vi.fn(async () => undefined);

			const outcome = await deactivate(
				db,
				{
					organizationId,
					actorUserId: owner.userId,
					employeeId: contractor.employeeId,
					requestId: randomUUID(),
					replacementManagers: {},
				},
				{
					clock,
					effects: {
						revokeSessions: async () => undefined,
						reconcileSeats,
						pauseOwnedExports: async () => undefined,
					},
				},
			);

			expect(outcome.kind).toBe("deactivated");
			expect((await seats(organizationId)).total).toBe(1);
			expect(reconcileSeats).toHaveBeenCalledWith(organizationId);
		});
	});

	describe("ending a contractor engagement", () => {
		async function seedSettledPayrollDay(person: SeededEmployee, date: string) {
			await fixture.pool.query(
				`insert into payroll_settled_day
				 (id, organization_id, employee_id, date, timezone, credited_minutes, absences, method, settled_by, settled_at)
				 values ($1, $2, $3, $4, 'UTC', 480, '[]'::jsonb, 'manual', $5, '2026-09-03T00:00:00Z')`,
				[randomUUID(), fixture.organizationId, person.employeeId, date, fixture.ownerUserId],
			);
		}

		async function reviewKinds(departureId: string) {
			const { rows } = await fixture.pool.query<{ kind: string }>(
				`select kind from employee_departure_review where departure_id = $1 order by kind`,
				[departureId],
			);
			return rows.map((row) => row.kind);
		}

		it("records a retrospective end date for a contractor without a payroll reconciliation review", async () => {
			now = TODAY;
			const contractor = await seedContractor();
			const employee = await fixture.seedEmployee();
			for (const person of [contractor, employee])
				await seedSettledPayrollDay(person, "2026-08-22");

			const contractorEnd = await commands().recordPastDeparture(ownerActor(), {
				employeeId: contractor.employeeId,
				requestId: randomUUID(),
				lastWorkingDay: "2026-08-15",
				replacementEmployeeId: null,
				acknowledgeUnassignedDuties: true,
			});
			const employeeEnd = await commands().recordPastDeparture(ownerActor(), {
				employeeId: employee.employeeId,
				requestId: randomUUID(),
				lastWorkingDay: "2026-08-15",
				replacementEmployeeId: null,
				acknowledgeUnassignedDuties: true,
			});

			expect(contractorEnd).toMatchObject({
				status: "effective",
				payrollReconciliationReviewOpened: false,
			});
			expect(await reviewKinds(contractorEnd.departureId)).not.toContain("payroll_reconciliation");
			// The same history for an employee still opens one.
			expect(employeeEnd).toMatchObject({ payrollReconciliationReviewOpened: true });
			expect(await reviewKinds(employeeEnd.departureId)).toContain("payroll_reconciliation");
		});

		it("previews a contractor's retrospective end without the payroll reconciliation exception", async () => {
			now = TODAY;
			const contractor = await seedContractor();
			await seedSettledPayrollDay(contractor, "2026-08-22");

			const preview = await previewPastDeparture(fixture.db, {
				organizationId: fixture.organizationId,
				actorUserId: fixture.ownerUserId,
				employeeId: contractor.employeeId,
				lastWorkingDay: "2026-08-15",
				replacementEmployeeId: null,
				now,
			});

			expect(preview.preview?.exceptions ?? []).not.toContain("payroll_reconciliation");
		});

		it("ends a contractor's access through canonical employment ending", async () => {
			now = parseInstant("2026-03-02T10:00:00Z");
			const contractor = await seedContractor();

			await commands().offboardNow(ownerActor(), {
				employeeId: contractor.employeeId,
				requestId: randomUUID(),
				replacementEmployeeId: null,
				acknowledgeUnassignedDuties: true,
			});

			const { rows } = await fixture.pool.query<{ is_active: boolean; ended: boolean }>(
				`select e.is_active,
				   employee_employment_ended_without_rehire(e.organization_id, e.id) as ended
				 from employee e where e.id = $1`,
				[contractor.employeeId],
			);
			expect(rows[0]).toEqual({ is_active: false, ended: true });
			// A membership return cannot switch the ended engagement back on (migration 0073).
			const { rows: afterReturn } = await fixture.pool.query<{ is_active: boolean }>(
				`update employee set is_active = true where id = $1 returning is_active`,
				[contractor.employeeId],
			);
			expect(afterReturn[0]?.is_active).toBe(false);
		});
	});
});
