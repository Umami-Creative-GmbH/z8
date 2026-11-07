/**
 * #1629 (spec #1590, Organization ADR 0011): member removal and SCIM
 * deprovisioning are deactivations. Their hooks record a pending deactivation
 * at the removal moment; the follow-up deactivation then applies it with the
 * non-interactive runner, or withdraws it when the person came back first.
 */
import { randomUUID } from "node:crypto";
import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";

const { createNotification } = vi.hoisted(() => ({
	createNotification: vi.fn(),
}));
vi.mock("@/lib/notifications/notification-service", async (importOriginal) => ({
	...(await importOriginal<
		typeof import("@/lib/notifications/notification-service")
	>()),
	createNotification,
}));
vi.mock("@/lib/billing/seat-sync-trigger", () => ({
	reconcileBillingSeatsForOrganization: async () => undefined,
	syncBillingSeatsAfterMemberChange: async () => undefined,
}));
vi.mock("@/lib/queue", async (importOriginal) =>
	(await import("@/test/integration-harness")).calendarSyncQueue(
		importOriginal,
	),
);
vi.mock("@/lib/approvals/delivery/kick", async () =>
	(await import("@/test/integration-harness")).deliveryKick(),
);
vi.mock("@/lib/logger", async (importOriginal) => {
	const original = await importOriginal<typeof import("@/lib/logger")>();
	const quiet = {
		error: () => {},
		warn: () => {},
		info: () => {},
		debug: () => {},
	};
	return { ...original, createLogger: () => quiet };
});
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

const { db } = await import("@/db");
const { revokeRemovedMemberAccessInTransaction } = await import(
	"@/lib/auth/member-removal-cleanup"
);
const { ensureEmployeeForOrganizationMember } = await import(
	"@/lib/auth/organization-member-provisioning"
);
const { loadReactivationChecklist } = await import(
	"../reactivation-checklist-store"
);
const { runFollowUpDeactivations } = await import("./follow-up");
const { shiftStoredDate } = await import("@/lib/scheduling/shift-date");
const { createLifecycleDatabaseFixture } = await import(
	"../testing/database.test.fixture"
);
type LifecycleDatabaseFixture =
	import("../testing/database.test.fixture").LifecycleDatabaseFixture;
type SeededEmployee = import("../testing/database.test.fixture").SeededEmployee;
type RemovalTransaction = Parameters<
	typeof revokeRemovedMemberAccessInTransaction
>[0];

describe("member removal and SCIM deprovisioning are follow-up deactivations (#1629)", () => {
	let fixture: LifecycleDatabaseFixture;
	let subareaId: string;

	beforeAll(async () => {
		fixture = await createLifecycleDatabaseFixture();
		const locationId = randomUUID();
		subareaId = randomUUID();
		await fixture.pool.query(
			`insert into location (id, organization_id, name, created_by, updated_at) values ($1, $2, 'Store', $3, now())`,
			[locationId, fixture.organizationId, fixture.ownerUserId],
		);
		await fixture.pool.query(
			`insert into location_subarea (id, location_id, name, created_by, updated_at) values ($1, $2, 'Floor', $3, now())`,
			[subareaId, locationId, fixture.ownerUserId],
		);
	});

	afterAll(async () => {
		await fixture?.close();
	});

	beforeEach(() => {
		createNotification.mockReset();
		createNotification.mockResolvedValue({ id: "notification" });
	});

	/** An admin removes the member: the membership goes, then the removal hook runs. */
	async function removeMember(person: SeededEmployee, actorUserId?: string) {
		await fixture.pool.query("delete from member where id = $1", [
			person.memberId,
		]);
		return fixture.db.transaction((tx) =>
			revokeRemovedMemberAccessInTransaction(
				tx as unknown as RemovalTransaction,
				person.userId,
				fixture.organizationId,
				actorUserId ? { actorUserId } : {},
			),
		);
	}

	async function deactivations(person: SeededEmployee) {
		return (
			await fixture.pool.query(
				`select d.status, d.reason, d.deactivated_at, d.created_by, d.employment_period_id, d.metadata,
					d.applied is not null as applied, d.reactivated_at is not null as reactivated,
					-- Readers of a deactivation in effect match the instants in SQL, to the microsecond.
					d.deactivated_at = e.deactivated_at as at_removal
				 from employee_deactivation d join employee e on e.id = d.employee_id
				 where d.employee_id = $1 order by d.created_at`,
				[person.employeeId],
			)
		).rows;
	}

	async function leftAt(person: SeededEmployee): Promise<Date> {
		const result = await fixture.pool.query<{ deactivated_at: Date }>(
			"select deactivated_at from employee where id = $1",
			[person.employeeId],
		);
		return result.rows[0]?.deactivated_at as Date;
	}

	async function named(name: string) {
		const seeded = await fixture.seedEmployee();
		await fixture.pool.query(`update "user" set name = $2 where id = $1`, [
			seeded.userId,
			name,
		]);
		return seeded;
	}

	/**
	 * Someone who manages a report alone, holds the equipment officer grant,
	 * stands in as deputy for a colleague's later absence, is in a team and has a
	 * later shift.
	 */
	async function seedHoldings() {
		const person = await named(`Fred Former ${randomUUID()}`);
		const report = await named(`Rhea Report ${randomUUID()}`);
		const colleague = await fixture.seedEmployee();
		await fixture.pool.query(
			`insert into employee_managers (employee_id, manager_id, is_primary, assigned_by)
			 values ($1, $2, true, $3)`,
			[report.employeeId, person.employeeId, fixture.ownerUserId],
		);
		await fixture.pool.query(
			`insert into equipment_officer_grant (organization_id, employee_id, scope, updated_by)
			 values ($1, $2, 'all', $3)`,
			[fixture.organizationId, person.employeeId, fixture.ownerUserId],
		);
		const category = await fixture.pool.query<{ id: string }>(
			`insert into absence_category
			 (organization_id, type, name, requires_approval, counts_against_vacation, deputy_required,
				is_active, updated_at)
			 values ($1, 'vacation', $2, true, false, true, true, now()) returning id`,
			[fixture.organizationId, `Vacation ${randomUUID()}`],
		);
		const absence = await fixture.pool.query<{ id: string }>(
			`insert into absence_entry
			 (employee_id, category_id, start_date, end_date, status, organization_id, deputy_employee_id,
				updated_at)
			 values ($1, $2, '2027-03-01', '2027-03-05', 'approved', $3, $4, now()) returning id`,
			[
				colleague.employeeId,
				category.rows[0]?.id,
				fixture.organizationId,
				person.employeeId,
			],
		);
		const teamId = randomUUID();
		await fixture.pool.query(
			`insert into team (id, organization_id, name, updated_at) values ($1, $2, $3, now())`,
			[teamId, fixture.organizationId, `Team ${teamId}`],
		);
		await fixture.pool.query(
			`insert into team_membership (organization_id, team_id, employee_id) values ($1, $2, $3)`,
			[fixture.organizationId, teamId, person.employeeId],
		);
		const shiftId = randomUUID();
		await fixture.pool.query(
			`insert into shift
			 (id, organization_id, employee_id, subarea_id, date, start_time, end_time, status, created_by, updated_at)
			 values ($1, $2, $3, $4, $5, '08:00', '16:00', 'published', $6, now())`,
			[
				shiftId,
				fixture.organizationId,
				person.employeeId,
				subareaId,
				shiftStoredDate("2027-03-10", "UTC"),
				fixture.ownerUserId,
			],
		);
		return {
			person,
			report,
			absenceId: absence.rows[0]?.id as string,
			teamId,
			shiftId,
		};
	}

	async function holdings(seeded: Awaited<ReturnType<typeof seedHoldings>>) {
		const one = async <T>(text: string, params: unknown[]) =>
			(await fixture.pool.query(text, params)).rows[0] as T;
		return {
			grant: await one(
				`select revoked_at from equipment_officer_grant where employee_id = $1`,
				[seeded.person.employeeId],
			),
			deputy: await one(
				`select deputy_employee_id from absence_entry where id = $1`,
				[seeded.absenceId],
			),
			shift: await one(`select employee_id from shift where id = $1`, [
				seeded.shiftId,
			]),
			teams: (
				await fixture.pool.query(
					`select team_id from team_membership where employee_id = $1`,
					[seeded.person.employeeId],
				)
			).rows,
			managerLinks: (
				await fixture.pool.query(
					`select employee_id from employee_managers where manager_id = $1`,
					[seeded.person.employeeId],
				)
			).rows,
		};
	}

	function adminNotices() {
		return createNotification.mock.calls
			.map(([params]) => params)
			.filter(
				(params) => params.type === "former_employee_reports_without_manager",
			);
	}

	describe("the follow-up applies the deactivation", () => {
		it("ends what they hold and applies the roster areas at the removal moment", async () => {
			const seeded = await seedHoldings();
			await removeMember(seeded.person, fixture.ownerUserId);
			const removedAt = await leftAt(seeded.person);

			await runFollowUpDeactivations(db);

			expect(await deactivations(seeded.person)).toEqual([
				expect.objectContaining({
					status: "applied",
					reason: "member_removed",
					deactivated_at: removedAt,
					created_by: fixture.ownerUserId,
					applied: true,
					reactivated: false,
					at_removal: true,
				}),
			]);
			expect(await leftAt(seeded.person)).toEqual(removedAt);
			expect(await holdings(seeded)).toEqual({
				grant: { revoked_at: expect.any(Date) },
				deputy: { deputy_employee_id: null },
				shift: { employee_id: null },
				teams: [],
				// Never refuses: the report keeps their only manager link.
				managerLinks: [{ employee_id: seeded.report.employeeId }],
			});
			// The organization's admins hear about the report once.
			expect(adminNotices()).toEqual([
				expect.objectContaining({
					userId: fixture.ownerUserId,
					organizationId: fixture.organizationId,
					entityId: seeded.report.employeeId,
				}),
			]);
		});
	});

	describe("a durable, idempotent follow-up", () => {
		it("changes nothing and tells nobody again when run a second time", async () => {
			const seeded = await seedHoldings();
			await removeMember(seeded.person, fixture.ownerUserId);
			await runFollowUpDeactivations(db);
			const before = {
				deactivations: await deactivations(seeded.person),
				holdings: await holdings(seeded),
				audit: (
					await fixture.pool.query(
						"select count(*)::int as count from audit_log where organization_id = $1",
						[fixture.organizationId],
					)
				).rows,
			};
			createNotification.mockClear();

			await runFollowUpDeactivations(db);

			expect({
				deactivations: await deactivations(seeded.person),
				holdings: await holdings(seeded),
				audit: (
					await fixture.pool.query(
						"select count(*)::int as count from audit_log where organization_id = $1",
						[fixture.organizationId],
					)
				).rows,
			}).toEqual(before);
			expect(adminNotices()).toEqual([]);
		});

		it("retries a failed follow-up on the next run", async () => {
			const seeded = await seedHoldings();
			await removeMember(seeded.person, fixture.ownerUserId);
			let failing = true;
			const flaky = new Proxy(db, {
				get(target, property, receiver) {
					if (property === "transaction" && failing) {
						return () => Promise.reject(new Error("connection lost"));
					}
					return Reflect.get(target, property, receiver);
				},
			});

			const failed = await runFollowUpDeactivations(flaky);

			expect(failed.failed).toBeGreaterThanOrEqual(1);
			expect(await deactivations(seeded.person)).toEqual([
				expect.objectContaining({ status: "pending", applied: false }),
			]);
			expect((await holdings(seeded)).grant).toEqual({ revoked_at: null });

			failing = false;
			await runFollowUpDeactivations(flaky);

			expect(await deactivations(seeded.person)).toEqual([
				expect.objectContaining({ status: "applied", applied: true }),
			]);
			expect((await holdings(seeded)).grant).toEqual({
				revoked_at: expect.any(Date),
			});
		});
	});

	/** They are invited back and accept: provisioning switches them on again (#1628). */
	async function reAdd(person: SeededEmployee) {
		await fixture.pool.query(
			`insert into member (id, organization_id, user_id, role, status, created_at)
			 values ($1, $2, $3, 'member', 'approved', now())`,
			[randomUUID(), fixture.organizationId, person.userId],
		);
		await ensureEmployeeForOrganizationMember(db, {
			mode: "membershipAccepted",
			userId: person.userId,
			organizationId: fixture.organizationId,
			memberRole: "member",
		});
	}

	describe("a person who came back before the follow-up ran", () => {
		it("keeps everything, and the deactivation is closed as withdrawn", async () => {
			const seeded = await seedHoldings();
			await removeMember(seeded.person, fixture.ownerUserId);
			const kept = await holdings(seeded);
			await reAdd(seeded.person);

			const result = await runFollowUpDeactivations(db);

			expect(result.withdrawn).toBeGreaterThanOrEqual(1);
			expect(await deactivations(seeded.person)).toEqual([
				expect.objectContaining({
					status: "withdrawn",
					reason: "member_removed",
					applied: false,
					reactivated: true,
				}),
			]);
			expect(await holdings(seeded)).toEqual(kept);
			expect(kept.grant).toEqual({ revoked_at: null });
			expect(adminNotices()).toEqual([]);
			// Nothing ended, so there is nothing to grant again.
			expect(
				await loadReactivationChecklist(db, {
					organizationId: fixture.organizationId,
					employeeId: seeded.person.employeeId,
				}),
			).toBeNull();
		});
	});

	describe("the removal records a pending deactivation", () => {
		it("at the removal moment, under the removing admin", async () => {
			const person = await fixture.seedEmployee();

			await removeMember(person, fixture.ownerUserId);

			expect(await deactivations(person)).toEqual([
				{
					status: "pending",
					reason: "member_removed",
					deactivated_at: await leftAt(person),
					created_by: fixture.ownerUserId,
					employment_period_id: person.employmentPeriodId,
					metadata: { actorKind: "system" },
					applied: false,
					reactivated: false,
					at_removal: true,
				},
			]);
		});

		it("under the removed member's own user, once, when the cleanup is retried", async () => {
			const person = await fixture.seedEmployee();

			await removeMember(person);
			// The retry path runs the cleanup again once the membership is gone.
			await fixture.db.transaction((tx) =>
				revokeRemovedMemberAccessInTransaction(
					tx as unknown as RemovalTransaction,
					person.userId,
					fixture.organizationId,
				),
			);

			expect(await deactivations(person)).toEqual([
				expect.objectContaining({
					status: "pending",
					reason: "member_removed",
					created_by: person.userId,
				}),
			]);
		});

		it("records nothing for someone already switched off", async () => {
			const person = await fixture.seedEmployee({ isActive: false });

			await removeMember(person, fixture.ownerUserId);

			expect(await deactivations(person)).toEqual([]);
		});
	});
});
