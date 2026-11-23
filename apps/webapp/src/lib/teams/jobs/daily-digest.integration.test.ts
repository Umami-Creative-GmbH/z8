/**
 * PostgreSQL contract (#942): the daily digest reads `shift.date` as the
 * organization's calendar day. It used to compare `DATE(shift.date)`, the UTC
 * date, with today and tomorrow.
 */
import { randomUUID } from "node:crypto";
import { Temporal } from "temporal-polyfill";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { complianceExceptionInboxScopesFor } from "@/lib/approvals/inbox/compliance-exception-inbox";
import {
	createShiftDatabaseFixture,
	SHIFT_TEST_TIMEZONES,
	type ShiftDatabaseFixture,
	type ShiftTestOrganization,
	STORED_SHIFT_DATES,
} from "@/lib/scheduling/testing/shift-database.test.fixture";
import { buildDailyDigestCard } from "../cards/daily-digest-card";
import { buildDigestDataForManager } from "./daily-digest";

/** The database with every query it starts counted, by relational table or builder method. */
function countingReads<Database extends { query: object }>(database: Database) {
	const counts: Record<string, number> = {};
	const bump = (key: string) => {
		counts[key] = (counts[key] ?? 0) + 1;
	};
	const query = new Proxy(database.query, {
		get(tables, table) {
			const builder = Reflect.get(tables, table) as Record<string, (input: unknown) => unknown>;
			return {
				findMany: (input: unknown) => {
					bump(`query.${String(table)}`);
					return builder.findMany(input);
				},
				findFirst: (input: unknown) => {
					bump(`query.${String(table)}`);
					return builder.findFirst(input);
				},
			};
		},
	});
	const counted = new Proxy(database, {
		get(target, property) {
			if (property === "query") return query;
			const value = Reflect.get(target, property, target);
			if (typeof value !== "function") return value;
			return (...args: unknown[]) => {
				bump(String(property));
				return value.apply(target, args);
			};
		},
	});
	return { database: counted, count: () => ({ ...counts }) };
}

/** Noon on 2026-10-09 in each zone, so today is 2026-10-09 and tomorrow 2026-10-10. */
const NOON = {
	"Europe/Berlin": "2026-10-09T10:00:00Z",
	"America/New_York": "2026-10-09T16:00:00Z",
	UTC: "2026-10-09T12:00:00Z",
} as const;

describe("daily digest shifts", () => {
	let fixture: ShiftDatabaseFixture;

	beforeAll(async () => {
		fixture = await createShiftDatabaseFixture();
	});

	afterAll(async () => {
		await fixture?.close();
	});

	it.each(SHIFT_TEST_TIMEZONES)(
		"summarizes the %s organization's shifts of today and tomorrow",
		async (timezone) => {
			const org = await fixture.organization(timezone);
			const stored = STORED_SHIFT_DATES[timezone];
			const manager = await fixture.seedEmployee({ organizationId: org.organizationId });
			const [scheduled, scheduledYesterday] = await Promise.all(
				[1, 2].map(() => fixture.seedEmployee({ organizationId: org.organizationId })),
			);
			await fixture.pool.query(
				`insert into employee_managers (employee_id, manager_id, is_primary, assigned_by)
				 values ($1, $3, true, $4), ($2, $3, true, $4)`,
				[
					scheduled.employeeId,
					scheduledYesterday.employeeId,
					manager.employeeId,
					org.creator.userId,
				],
			);
			await fixture.shift(org, { employeeId: null, stored: stored.previous });
			await fixture.shift(org, { employeeId: null, stored: stored.day });
			await fixture.shift(org, { employeeId: null, stored: stored.day });
			await fixture.shift(org, { employeeId: null, stored: stored.day, status: "draft" });
			await fixture.shift(org, { employeeId: null, stored: stored.next });
			await fixture.shift(org, { employeeId: scheduled.employeeId, stored: stored.day });
			await fixture.shift(org, {
				employeeId: scheduledYesterday.employeeId,
				stored: stored.previous,
			});

			const digest = await buildDigestDataForManager(
				manager.employeeId,
				org.organizationId,
				timezone,
				"en",
				null,
				Temporal.Instant.from(NOON[timezone]),
			);

			expect(digest).toMatchObject({
				openShiftsToday: 2,
				openShiftsTomorrow: 1,
				coverageGaps: [
					{
						subareaName: "Floor",
						timeSlot: "08:00-16:00",
						scheduled: 1,
						actual: 0,
						shortage: 1,
					},
				],
			});
		},
	);

	describe("pending compliance exceptions (#1977)", () => {
		const now = Temporal.Instant.from(NOON.UTC);

		async function directReport(org: ShiftTestOrganization, managerEmployeeId: string) {
			const report = await fixture.seedEmployee({ organizationId: org.organizationId });
			await fixture.pool.query(
				`insert into employee_managers (employee_id, manager_id, is_primary, assigned_by)
				 values ($1, $2, true, $3)`,
				[report.employeeId, managerEmployeeId, org.creator.userId],
			);
			return report;
		}

		async function manager(org: ShiftTestOrganization) {
			const person = await fixture.seedEmployee({ organizationId: org.organizationId });
			await fixture.pool.query("update employee set role = 'manager' where id = $1", [
				person.employeeId,
			]);
			return person;
		}

		async function exception(
			org: ShiftTestOrganization,
			employeeId: string,
			validFrom: Temporal.Instant = now.subtract({ hours: 2 }),
		) {
			await fixture.pool.query(
				`insert into compliance_exception
				 (id, organization_id, employee_id, exception_type, status, reason, valid_from, valid_until,
				  created_at, created_by, updated_at)
				 values ($1, $2, $3, 'overtime_daily', 'pending', 'Inventory', $4, $5, $4, $6, $4)`,
				[
					randomUUID(),
					org.organizationId,
					employeeId,
					validFrom.toString(),
					validFrom.add({ hours: 24 }).toString(),
					org.creator.userId,
				],
			);
		}

		/** The digest of a recipient, scoped as the tenant run scopes its recipients. */
		async function digestFor(
			org: ShiftTestOrganization,
			recipient: { employeeId: string; userId: string },
		) {
			const scopes = complianceExceptionInboxScopesFor({
				organizationId: org.organizationId,
				userIds: [recipient.userId],
			});
			return buildDigestDataForManager(
				recipient.employeeId,
				org.organizationId,
				"UTC",
				"en",
				await scopes.of(recipient),
				now,
			);
		}

		it("counts only those whose validity window is still open", async () => {
			const org = await fixture.organization("UTC");
			const lead = await manager(org);
			const report = await directReport(org, lead.employeeId);
			await exception(org, report.employeeId);
			// Lapsed an hour ago: the Approval inbox lists it as expired, not pending.
			await exception(org, report.employeeId, now.subtract({ hours: 25 }));

			expect((await digestFor(org, lead)).compliancePending).toBe(1);
		});

		it("counts and links every pending exception of the organization for a recipient who manages Compliance", async () => {
			const org = await fixture.organization("UTC");
			// An org admin manages Compliance; their own report has nothing pending.
			const admin = await fixture.seedEmployee({
				organizationId: org.organizationId,
				role: "admin",
			});
			await directReport(org, admin.employeeId);
			const lead = await manager(org);
			const report = await directReport(org, lead.employeeId);
			await exception(org, report.employeeId);
			await exception(org, report.employeeId);

			const digest = await digestFor(org, admin);

			expect(digest.compliancePending).toBe(2);
			expect(JSON.stringify(buildDailyDigestCard(digest, "https://z8.test", "en"))).toContain(
				"https://z8.test/approvals/inbox?types=compliance_exception",
			);
			// The manager still counts only their own eligible scope.
			expect((await digestFor(org, lead)).compliancePending).toBe(2);
			const otherLead = await manager(org);
			await directReport(org, otherLead.employeeId);
			expect((await digestFor(org, otherLead)).compliancePending).toBeUndefined();
		});

		it("reads the organization's eligibility and its recipients' permissions once per tenant run", async () => {
			const org = await fixture.organization("UTC");
			const recipients = await Promise.all([manager(org), manager(org), manager(org)]);
			for (const recipient of recipients) {
				await exception(org, (await directReport(org, recipient.employeeId)).employeeId);
			}
			const admin = await fixture.seedEmployee({
				organizationId: org.organizationId,
				role: "admin",
			});
			recipients.push(admin);

			async function readsFor(people: { employeeId: string; userId: string }[]) {
				const reads = countingReads(fixture.db);
				const scopes = complianceExceptionInboxScopesFor({
					organizationId: org.organizationId,
					userIds: people.map((person) => person.userId),
					database: reads.database,
				});
				const resolved = await Promise.all(people.map((person) => scopes.of(person)));
				return { resolved, reads: reads.count() };
			}

			const one = await readsFor(recipients.slice(0, 1));
			const all = await readsFor(recipients);

			// The organization's employees are read once, however many recipients there are.
			expect(one.reads["query.employee"]).toBe(1);
			expect(all.reads).toEqual(one.reads);
			expect(all.resolved.map((scope) => scope?.kind)).toEqual([
				"managed",
				"managed",
				"managed",
				"organization",
			]);
		});

		it("counts a team member without a direct manager for the team's primary manager, as the inbox does", async () => {
			const org = await fixture.organization("UTC");
			const lead = await manager(org);
			// A direct report too, so this manager receives a digest at all.
			await directReport(org, lead.employeeId);
			const member = await fixture.seedEmployee({ organizationId: org.organizationId });
			const teamId = randomUUID();
			await fixture.pool.query(
				`insert into team (id, organization_id, name, primary_manager_id, updated_at)
				 values ($1, $2, 'Floor team', $3, now())`,
				[teamId, org.organizationId, lead.employeeId],
			);
			await fixture.pool.query("update employee set team_id = $2 where id = $1", [
				member.employeeId,
				teamId,
			]);
			await exception(org, member.employeeId);

			expect((await digestFor(org, lead)).compliancePending).toBe(1);
		});

		it("counts none for an employee-role user with a direct report, who is no eligible manager", async () => {
			const org = await fixture.organization("UTC");
			const linked = await fixture.seedEmployee({ organizationId: org.organizationId });
			const report = await directReport(org, linked.employeeId);
			await exception(org, report.employeeId);

			expect((await digestFor(org, linked)).compliancePending).toBeUndefined();
		});
	});
});
