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
import { type Instant, parseInstant, systemClock } from "@/lib/datetime/temporal-core";
import type { InvitationEngagement } from "@/lib/auth/employee-invitation-draft";
import { todayInOrganization } from "@/lib/personnel-file/organization-day";

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
const { listContractsReviewQueue } = await import("@/lib/contracts/contract-reviews");
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
			/** The admin who prepared the invitation; the owner unless named, nobody when null. */
			preparedBy?: string | null;
			/** The invitation's first compensation terms, as `sendInvitation` stores them (#1935). */
			compensation?: Record<string, unknown> | null;
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
				    contractor_vat_id, contractor_reference_code, planned_end_date, project_ids, updated_by,
				    contractor_compensation)
				 values ($1, $2, $3, $4, 'employee', 'Grace', 'hourly', '95.00', 'contractor',
				         'Hopper Consulting GmbH', 'DE123456789', 'PO-4711', $5, $6::uuid[], $7, $8::jsonb)`,
				[
					invitationId,
					fixture.organizationId,
					email,
					draft.teamId,
					draft.plannedEndDate,
					draft.projectIds,
					draft.preparedBy === undefined ? fixture.ownerUserId : draft.preparedBy,
					draft.compensation ? JSON.stringify(draft.compensation) : null,
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

		it("keeps a pending contractor invitation's engagement when it is sent again as an employee, while still repairing its team and organization creation", async () => {
			const projectId = await seedProject();
			const teamId = await seedTeam();
			const email = `${randomUUID()}@pending.test`;
			const invitationId = randomUUID();
			await fixture.pool.query(
				`insert into invitation (id, organization_id, email, role, status, expires_at, inviter_id)
				 values ($1, $2, $3, 'member', 'pending', now() + interval '7 days', $4)`,
				[invitationId, fixture.organizationId, email, fixture.ownerUserId],
			);
			const pendingInvitation = {
				organizationId: fixture.organizationId,
				normalizedEmail: email,
				invitationId,
				initialRole: "employee" as const,
				updatedBy: fixture.ownerUserId,
			};
			await persistEmployeeInvitationDraft(db, {
				...pendingInvitation,
				canCreateOrganizations: false,
				targetTeamId: null,
				engagement: {
					kind: "contractor",
					contractor: {
						companyName: "Hopper Consulting GmbH",
						vatId: "DE123456789",
						referenceCode: "PO-4711",
						projectIds: [projectId],
						plannedEndDate: "2099-06-30",
					},
				},
			});
			await fixture.pool.query(
				`update employee_invitation_draft set first_name = 'Grace'
				 where organization_id = $1 and normalized_email = $2`,
				[fixture.organizationId, email],
			);

			// Another admin invites the same email while the invitation is pending, as an employee.
			await persistEmployeeInvitationDraft(db, {
				...pendingInvitation,
				canCreateOrganizations: true,
				targetTeamId: teamId,
				engagement: { kind: "employee", contractor: null },
			});

			const { rows } = await fixture.pool.query(
				`select d.engagement_kind, d.contract_type, d.contractor_company_name, d.contractor_vat_id,
				   d.contractor_reference_code, d.planned_end_date::text, d.project_ids::text[], d.first_name,
				   d.can_create_organizations, i.target_team_id
				 from employee_invitation_draft d join invitation i on i.id = d.invitation_id
				 where d.organization_id = $1 and d.normalized_email = $2`,
				[fixture.organizationId, email],
			);
			expect(rows).toEqual([
				{
					engagement_kind: "contractor",
					contract_type: "fixed",
					contractor_company_name: "Hopper Consulting GmbH",
					contractor_vat_id: "DE123456789",
					contractor_reference_code: "PO-4711",
					planned_end_date: "2099-06-30",
					project_ids: [projectId],
					first_name: "Grace",
					can_create_organizations: true,
					target_team_id: teamId,
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

		it("credits a replaced draft to the admin whose invitation replaced it, so joining acts as them", async () => {
			const email = `${randomUUID()}@draft.test`;
			const firstAdmin = await fixture.seedEmployee();
			async function inviteBy(updatedBy: string, engagement: InvitationEngagement) {
				const invitationId = randomUUID();
				await fixture.pool.query(
					`insert into invitation (id, organization_id, email, role, status, expires_at, inviter_id)
					 values ($1, $2, $3, 'member', 'pending', now() + interval '7 days', $4)`,
					[invitationId, fixture.organizationId, email, updatedBy],
				);
				await persistEmployeeInvitationDraft(db, {
					organizationId: fixture.organizationId,
					normalizedEmail: email,
					invitationId,
					canCreateOrganizations: false,
					targetTeamId: null,
					initialRole: "employee",
					updatedBy,
					engagement,
				});
			}

			await inviteBy(firstAdmin.userId, { kind: "employee", contractor: null });
			await inviteBy(fixture.ownerUserId, {
				kind: "contractor",
				contractor: {
					companyName: null,
					vatId: null,
					referenceCode: null,
					projectIds: [],
					plannedEndDate: "2099-06-30",
				},
			});

			const { rows } = await fixture.pool.query(
				`select engagement_kind, updated_by from employee_invitation_draft
				 where organization_id = $1 and normalized_email = $2`,
				[fixture.organizationId, email],
			);
			expect(rows).toEqual([{ engagement_kind: "contractor", updated_by: fixture.ownerUserId }]);
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

		async function joinAndSettle(joiner: {
			userId: string;
			memberId: string;
			invitationId: string;
		}) {
			const joining = await fixture.db.transaction((tx) =>
				joinOrganization(tx, {
					organizationId: fixture.organizationId,
					userId: joiner.userId,
					membership: { id: joiner.memberId, role: "member" },
					invitation: { id: joiner.invitationId },
				}),
			);
			await joining.afterCommit.run();
			return joining.outcome.employee.id;
		}

		async function plannedEndFollowUp(employeeId: string) {
			const { rows: departures } = await fixture.pool.query(
				`select status, last_working_day::text from employee_departure
				 where organization_id = $1 and employee_id = $2`,
				[fixture.organizationId, employeeId],
			);
			const { rows: audits } = await fixture.pool.query<{ metadata: string }>(
				`select metadata from audit_log where organization_id = $1 and employee_id = $2
				 and action = 'employee.planned_engagement_end_not_applied'`,
				[fixture.organizationId, employeeId],
			);
			const { rows: notices } = await fixture.pool.query<{ user_id: string; type: string }>(
				`select user_id, type from notification
				 where organization_id = $1 and entity_type = 'employee' and entity_id = $2`,
				[fixture.organizationId, employeeId],
			);
			return {
				departures,
				audits: audits.map((audit) => JSON.parse(audit.metadata)),
				notices,
			};
		}

		it("schedules a planned end that passed before the contractor joined for today, and tells the admins", async () => {
			const joiner = await acceptedContractorInvitation({
				teamId: null,
				projectIds: [],
				plannedEndDate: "2020-01-31",
			});
			const { rows: organization } = await fixture.pool.query<{ timezone: string | null }>(
				"select timezone from organization where id = $1",
				[fixture.organizationId],
			);
			const today = todayInOrganization(
				systemClock.nowInstant(),
				organization[0]?.timezone,
			).toString();

			const employeeId = await joinAndSettle(joiner);

			const followUp = await plannedEndFollowUp(employeeId);
			expect(followUp.departures).toEqual([{ status: "pending", last_working_day: today }]);
			expect(followUp.audits).toEqual([
				expect.objectContaining({
					reason: "planned_end_passed",
					plannedEndDate: "2020-01-31",
					scheduledLastWorkingDay: today,
				}),
			]);
			expect(followUp.notices).toContainEqual({
				user_id: fixture.ownerUserId,
				type: "employee_offboarding_review",
			});
		});

		it("never drops a planned end silently when it cannot be scheduled, and tells the admins", async () => {
			// The admin who prepared the invitation is no longer one when the contractor joins.
			const formerAdmin = await fixture.seedEmployee();
			const joiner = await acceptedContractorInvitation({
				teamId: null,
				projectIds: [],
				plannedEndDate: "2099-06-30",
				preparedBy: formerAdmin.userId,
			});

			const employeeId = await joinAndSettle(joiner);

			const followUp = await plannedEndFollowUp(employeeId);
			expect(followUp.departures).toEqual([]);
			expect(followUp.audits).toEqual([
				expect.objectContaining({
					reason: "schedule_refused",
					refusal: "actor_not_authorized",
					plannedEndDate: "2099-06-30",
				}),
			]);
			expect(followUp.notices).toContainEqual({
				user_id: fixture.ownerUserId,
				type: "employee_offboarding_review",
			});
			expect(followUp.notices.map((notice) => notice.user_id)).not.toContain(formerAdmin.userId);
		});

		const dailyRate = {
			compensationBasis: "daily",
			rateAmount: "650.00",
			currency: "EUR",
			dayUnitRule: "half_and_full_day",
			halfDayThresholdMinutes: 300,
			standardDayMinutes: null,
			capAtOneDay: null,
		};

		async function termsFollowUp(employeeId: string) {
			const { rows: terms } = await fixture.pool.query(
				`select t.compensation_basis, t.rate_amount::text, t.currency, t.day_unit_rule,
				   t.half_day_threshold_minutes, t.effective_from::text, t.effective_to::text,
				   t.created_by, p.engagement_kind, p.status
				 from contractor_compensation_terms t
				 join employee_employment_period p on p.id = t.employment_period_id
				 where t.organization_id = $1 and t.employee_id = $2`,
				[fixture.organizationId, employeeId],
			);
			const { rows: audits } = await fixture.pool.query<{
				action: string;
				metadata: string | null;
			}>(
				`select action, metadata from audit_log where organization_id = $1 and employee_id = $2
				 and action in ('employee.invitation_contractor_terms_not_applied',
				                'employee.contractor_terms_set')
				 order by timestamp`,
				[fixture.organizationId, employeeId],
			);
			const { rows: notices } = await fixture.pool.query<{ user_id: string; message: string }>(
				`select user_id, message from notification
				 where organization_id = $1 and entity_type = 'employee' and entity_id = $2`,
				[fixture.organizationId, employeeId],
			);
			return {
				terms,
				audits: audits.map((audit) => ({
					action: audit.action,
					metadata: audit.metadata ? JSON.parse(audit.metadata) : null,
				})),
				notices,
			};
		}

		it("writes the invitation's rate as the new engagement's first terms from its start, as the admin who prepared it (#1935)", async () => {
			const joiner = await acceptedContractorInvitation({
				teamId: null,
				projectIds: [],
				plannedEndDate: null,
				compensation: dailyRate,
			});

			const employeeId = await joinAndSettle(joiner);

			const { rows: periods } = await fixture.pool.query<{ started_at: Date | null }>(
				`select started_at from employee_employment_period
				 where organization_id = $1 and employee_id = $2 and status = 'open'`,
				[fixture.organizationId, employeeId],
			);
			const { rows: organization } = await fixture.pool.query<{ timezone: string | null }>(
				"select timezone from organization where id = $1",
				[fixture.organizationId],
			);
			// The engagement's earliest terms day: its start at UTC−14:00, or today without one.
			const startedAt = periods[0]?.started_at;
			const effectiveFrom = startedAt
				? parseInstant(startedAt.toISOString())
						.toZonedDateTimeISO("-14:00")
						.toPlainDate()
						.toString()
				: todayInOrganization(systemClock.nowInstant(), organization[0]?.timezone).toString();
			const followUp = await termsFollowUp(employeeId);
			expect(followUp.terms).toEqual([
				{
					compensation_basis: "daily",
					rate_amount: "650.000",
					currency: "EUR",
					day_unit_rule: "half_and_full_day",
					half_day_threshold_minutes: 300,
					effective_from: effectiveFrom,
					effective_to: null,
					created_by: fixture.ownerUserId,
					engagement_kind: "contractor",
					status: "open",
				},
			]);
			expect(followUp.audits.map((audit) => audit.action)).toEqual([
				"employee.contractor_terms_set",
			]);
			expect(followUp.notices).toEqual([]);

			// Run again (a replayed step) with other terms: the first terms are never replaced.
			const { applyInvitationContractorTerms } =
				await import("./joining/invitation-contractor-terms");
			await applyInvitationContractorTerms({
				organizationId: fixture.organizationId,
				employeeId,
				userId: joiner.userId,
				compensation: { ...dailyRate, rateAmount: "999.00" },
				draftId: randomUUID(),
				invitationId: joiner.invitationId,
				actorUserId: fixture.ownerUserId,
			});
			const replayed = await termsFollowUp(employeeId);
			expect(replayed.terms).toEqual(followUp.terms);
			expect(replayed.audits.at(-1)).toEqual({
				action: "employee.invitation_contractor_terms_not_applied",
				metadata: expect.objectContaining({ reason: "refused", refusal: "terms_exist" }),
			});
			expect(replayed.notices).toContainEqual(
				expect.objectContaining({ user_id: fixture.ownerUserId }),
			);
		});

		it("never drops the invitation's rate silently when nobody can be named to set it (#1935)", async () => {
			const joiner = await acceptedContractorInvitation({
				teamId: null,
				projectIds: [],
				plannedEndDate: null,
				preparedBy: null,
				compensation: dailyRate,
			});

			const employeeId = await joinAndSettle(joiner);

			const followUp = await termsFollowUp(employeeId);
			expect(followUp.terms).toEqual([]);
			expect(followUp.audits).toEqual([
				{
					action: "employee.invitation_contractor_terms_not_applied",
					metadata: expect.objectContaining({
						reason: "no_admin_actor",
						actorKind: "system",
						compensation: dailyRate,
					}),
				},
			]);
			expect(followUp.notices).toContainEqual(
				expect.objectContaining({ user_id: fixture.ownerUserId }),
			);
		});

		it("records a planned end nobody prepared as a system finding, not as the contractor's own action", async () => {
			const joiner = await acceptedContractorInvitation({
				teamId: null,
				projectIds: [],
				plannedEndDate: "2099-06-30",
				preparedBy: null,
			});

			const employeeId = await joinAndSettle(joiner);

			const followUp = await plannedEndFollowUp(employeeId);
			expect(followUp.departures).toEqual([]);
			expect(followUp.audits).toEqual([
				expect.objectContaining({
					reason: "no_admin_actor",
					actorKind: "system",
					plannedEndDate: "2099-06-30",
				}),
			]);
			expect(followUp.notices).toContainEqual({
				user_id: fixture.ownerUserId,
				type: "employee_offboarding_review",
			});
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

		it("keeps a migration conflict on the kind of the stint its terms belong to after the person converts", async () => {
			now = parseInstant("2026-03-02T10:00:00Z");
			const person = await fixture.seedEmployee();
			const { rows: terms } = await fixture.pool.query<{ id: string }>(
				`insert into employee_employment_history (organization_id, employee_id, employment_period_id,
				   valid_from, valid_from_date, weekly_contract_minutes, review_state, created_by, updated_at)
				 select $1, $2, p.id, coalesce(p.started_at, '2026-01-01'),
				   coalesce(p.started_at, '2026-01-01')::date, 2400, 'confirmed', $3, now()
				 from employee_employment_period p where p.id = $4
				 returning id`,
				[fixture.organizationId, person.employeeId, fixture.ownerUserId, person.employmentPeriodId],
			);
			const { rows: conflicts } = await fixture.pool.query<{ id: string }>(
				`insert into contract_migration_conflict (organization_id, employee_id, employment_history_id,
				   conflict_kind, dedupe_key)
				 values ($1, $2, $3, 'legacy_terms_overlap', $4) returning id`,
				[fixture.organizationId, person.employeeId, terms[0]?.id, randomUUID()],
			);
			await offboardNow(person);

			now = parseInstant("2026-04-01T09:00:00Z");
			await commands().rehireEmployee(ownerActor(), {
				...employeeTerms,
				employeeId: person.employeeId,
				requestId: randomUUID(),
				previousEmploymentPeriodId: person.employmentPeriodId,
				engagementKind: "contractor",
				workPolicyId: null,
			});

			const queue = await listContractsReviewQueue(fixture.db, fixture.organizationId);

			expect((await engagementOf(person.employeeId)).employee).toBe("contractor");
			expect(
				queue.migrationConflicts
					.filter((conflict) => conflict.id === conflicts[0]?.id)
					.map((conflict) => conflict.engagementKind),
			).toEqual(["employee"]);
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

		it("counts a contractor holding a kiosk seat as a kiosk seat until departure or deactivation ends it", async () => {
			now = parseInstant("2026-03-02T10:00:00Z");
			const organizationId = await fixture.createOrganization();
			const owner = await fixture.seedEmployee({ organizationId, role: "owner" });
			// No kiosk-only contractor can be created in the app yet: seeded directly.
			const kioskContractor = async () => {
				const contractor = await fixture.seedEmployee({
					organizationId,
					engagementKind: "contractor",
				});
				await fixture.pool.query(`update "user" set email = $2 where id = $1`, [
					contractor.userId,
					`${randomUUID()}@kiosk.invalid`,
				]);
				return contractor;
			};
			const departing = await kioskContractor();
			const deactivated = await kioskContractor();
			expect(await seats(organizationId)).toEqual({ total: 3, byType: { full: 1, kiosk: 2 } });

			const departed = await commands().offboardNow(
				{ userId: owner.userId, organizationId },
				{
					employeeId: departing.employeeId,
					requestId: randomUUID(),
					replacementEmployeeId: null,
					acknowledgeUnassignedDuties: true,
				},
			);
			expect(departed.status).toBe("effective");
			expect(await seats(organizationId)).toEqual({ total: 2, byType: { full: 1, kiosk: 1 } });

			const outcome = await deactivate(
				db,
				{
					organizationId,
					actorUserId: owner.userId,
					employeeId: deactivated.employeeId,
					requestId: randomUUID(),
					replacementManagers: {},
				},
				{
					clock,
					effects: {
						revokeSessions: async () => undefined,
						reconcileSeats: async () => undefined,
						pauseOwnedExports: async () => undefined,
					},
				},
			);
			expect(outcome.kind).toBe("deactivated");
			expect(await seats(organizationId)).toEqual({ total: 1, byType: { full: 1, kiosk: 0 } });
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

		it("keeps a review on the kind of the stint it is about after the person converts", async () => {
			now = TODAY;
			const person = await fixture.seedEmployee();
			await seedSettledPayrollDay(person, "2026-08-22");
			const end = await commands().recordPastDeparture(ownerActor(), {
				employeeId: person.employeeId,
				requestId: randomUUID(),
				lastWorkingDay: "2026-08-15",
				replacementEmployeeId: null,
				acknowledgeUnassignedDuties: true,
			});
			await commands().rehireEmployee(ownerActor(), {
				role: "employee",
				teamId: null,
				primaryManagerId: null,
				weeklyContractMinutes: 2400,
				contractType: "fixed",
				workModel: "onsite",
				hourlyRate: null,
				currency: "EUR",
				probationStartsOn: null,
				probationEndsOn: null,
				changeReason: null,
				employeeId: person.employeeId,
				requestId: randomUUID(),
				previousEmploymentPeriodId: person.employmentPeriodId,
				engagementKind: "contractor",
				workPolicyId: null,
			});

			const queue = await listContractsReviewQueue(fixture.db, fixture.organizationId);

			expect(
				queue.departureReviews
					.filter((review) => review.departureId === end.departureId)
					.map((review) => ({ kind: review.kind, engagementKind: review.engagementKind })),
			).toEqual([{ kind: "payroll_reconciliation", engagementKind: "employee" }]);
		});

		it("previews a contractor's retrospective end without the payroll reconciliation exception", async () => {
			now = TODAY;
			const contractor = await seedContractor();
			const employee = await fixture.seedEmployee();
			for (const person of [contractor, employee])
				await seedSettledPayrollDay(person, "2026-08-22");
			const previewOf = (person: SeededEmployee) =>
				previewPastDeparture(fixture.db, {
					organizationId: fixture.organizationId,
					actorUserId: fixture.ownerUserId,
					employeeId: person.employeeId,
					lastWorkingDay: "2026-08-15",
					replacementEmployeeId: null,
					now,
				});

			const contractorPreview = (await previewOf(contractor)).preview;
			const employeePreview = (await previewOf(employee)).preview;

			expect(contractorPreview).toMatchObject({ exceptions: expect.any(Array) });
			expect(contractorPreview?.exceptions).not.toContain("payroll_reconciliation");
			// The same settled day for an employee does show the exception.
			expect(employeePreview).toMatchObject({
				exceptions: expect.arrayContaining(["payroll_reconciliation"]),
			});
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
