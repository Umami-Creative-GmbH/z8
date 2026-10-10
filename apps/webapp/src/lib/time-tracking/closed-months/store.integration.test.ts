/**
 * PostgreSQL contract (#762, Time Tracking ADR-0004): closing a month fixes each
 * covered employee's range in their timezone, a team close covers the
 * employees whose primary team it is at close, an organization close covers
 * employees added later, a close is refused while requests or live work about
 * the month are open, and a reopening needs a reason and lifts the close only
 * for the employees it names. Close and reopening are audited in their own
 * transaction.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseInstant } from "@/lib/datetime/temporal-core";
import { MonthClosedError } from "@/lib/effect/errors";
import {
	assertWorkOpen,
	closedRangesForEmployee,
	closeMonth,
	monthClosureStatuses,
	reopenMonth,
	workInterval,
} from "./store";
import {
	type ClosedMonthDatabaseFixture,
	createClosedMonthDatabaseFixture,
} from "./testing/closed-month-database.test.fixture";

const now = parseInstant("2026-04-10T12:00:00Z");
const marchShift = workInterval(new Date("2026-03-10T08:00:00Z"), new Date("2026-03-10T16:00:00Z"));

describe("closing and reopening months on PostgreSQL", () => {
	let fixture: ClosedMonthDatabaseFixture;

	beforeAll(async () => {
		fixture = await createClosedMonthDatabaseFixture();
	});

	afterAll(async () => {
		await fixture?.close();
	});

	async function auditActions(organizationId: string) {
		const result = await fixture.pool.query<{ action: string; performed_by: string }>(
			"select action, performed_by from audit_log where organization_id = $1 and entity_type = 'closed_month' order by timestamp",
			[organizationId],
		);
		return result.rows;
	}

	it("fixes each employee's March in their own timezone and audits the close", async () => {
		const org = await fixture.organization("Europe/Berlin");
		const berlin = await fixture.employee({ organizationId: org.organizationId });
		const newYork = await fixture.employee({
			organizationId: org.organizationId,
			timezone: "America/New_York",
		});

		const result = await closeMonth(fixture.db, {
			organizationId: org.organizationId,
			month: "2026-03",
			scope: { kind: "organization" },
			actor: { kind: "user", userId: org.ownerUserId },
			now,
		});

		expect(result).toMatchObject({ kind: "closed", month: "2026-03" });
		const [berlinRange] = await closedRangesForEmployee(fixture.db, {
			organizationId: org.organizationId,
			employeeId: berlin.employeeId,
		});
		const [newYorkRange] = await closedRangesForEmployee(fixture.db, {
			organizationId: org.organizationId,
			employeeId: newYork.employeeId,
		});
		expect(berlinRange.start.toString()).toBe("2026-02-28T23:00:00Z");
		expect(berlinRange.endExclusive.toString()).toBe("2026-03-31T22:00:00Z");
		expect(newYorkRange.start.toString()).toBe("2026-03-01T05:00:00Z");
		expect(newYorkRange.endExclusive.toString()).toBe("2026-04-01T04:00:00Z");
		expect(await auditActions(org.organizationId)).toEqual([
			{ action: "closed_month.closed", performed_by: org.ownerUserId },
		]);
	});

	it("keeps an employee's frozen instants when their timezone changes after the close", async () => {
		const org = await fixture.organization("UTC");
		const person = await fixture.employee({
			organizationId: org.organizationId,
			timezone: "Europe/Berlin",
		});
		await closeMonth(fixture.db, {
			organizationId: org.organizationId,
			month: "2026-03",
			scope: { kind: "organization" },
			actor: { kind: "user", userId: org.ownerUserId },
			now,
		});

		await fixture.setUserTimezone(person.userId, "Pacific/Auckland");

		const [range] = await closedRangesForEmployee(fixture.db, {
			organizationId: org.organizationId,
			employeeId: person.employeeId,
		});
		expect(range.start.toString()).toBe("2026-02-28T23:00:00Z");
		// 31 March 23:30 UTC is April in Auckland, but still Berlin's March as frozen.
		await expect(
			assertWorkOpen(fixture.db, {
				organizationId: org.organizationId,
				employeeId: person.employeeId,
				intervals: [
					workInterval(new Date("2026-03-31T21:30:00Z"), new Date("2026-03-31T21:45:00Z")),
				],
			}),
		).rejects.toBeInstanceOf(MonthClosedError);
	});

	it("covers exactly the primary team at close, and a later move does not reopen it", async () => {
		const org = await fixture.organization();
		const teamA = await fixture.team(org.organizationId, "A");
		const teamB = await fixture.team(org.organizationId, "B");
		const inA = await fixture.employee({ organizationId: org.organizationId, teamId: teamA });
		const inB = await fixture.employee({ organizationId: org.organizationId, teamId: teamB });

		const result = await closeMonth(fixture.db, {
			organizationId: org.organizationId,
			month: "2026-03",
			scope: { kind: "team", teamId: teamA },
			actor: { kind: "user", userId: org.ownerUserId },
			now,
		});

		expect(result).toMatchObject({ kind: "closed", employeeIds: [inA.employeeId] });
		await fixture.setEmployeeTeam(inA.employeeId, teamB);
		await expect(
			assertWorkOpen(fixture.db, {
				organizationId: org.organizationId,
				employeeId: inA.employeeId,
				intervals: [marchShift],
			}),
		).rejects.toMatchObject({ _tag: "MonthClosedError", month: "2026-03" });
		await expect(
			assertWorkOpen(fixture.db, {
				organizationId: org.organizationId,
				employeeId: inB.employeeId,
				intervals: [marchShift],
			}),
		).resolves.toBeUndefined();
	});

	it("covers an employee added after an organization close, in their timezone", async () => {
		const org = await fixture.organization("America/New_York");
		await closeMonth(fixture.db, {
			organizationId: org.organizationId,
			month: "2026-03",
			scope: { kind: "organization" },
			actor: { kind: "user", userId: org.ownerUserId },
			now,
		});

		const late = await fixture.employee({ organizationId: org.organizationId });

		const ranges = await closedRangesForEmployee(fixture.db, {
			organizationId: org.organizationId,
			employeeId: late.employeeId,
		});
		expect(ranges.map((range) => [range.month, range.start.toString()])).toEqual([
			["2026-03", "2026-03-01T05:00:00Z"],
		]);
	});

	it("refuses a close while requests or live work about the month are open, listing them", async () => {
		const org = await fixture.organization("UTC");
		const person = await fixture.employee({ organizationId: org.organizationId });
		const absenceId = await fixture.absence({
			organizationId: org.organizationId,
			employeeId: person.employeeId,
			startDate: "2026-03-30",
			endDate: "2026-04-02",
			status: "pending",
		});
		const pending = await fixture.work({
			organizationId: org.organizationId,
			employeeId: person.employeeId,
			userId: person.userId,
			start: "2026-03-05T08:00:00Z",
			end: "2026-03-05T12:00:00Z",
			approvalStatus: "pending",
		});
		const live = await fixture.work({
			organizationId: org.organizationId,
			employeeId: person.employeeId,
			userId: person.userId,
			start: "2026-03-31T20:00:00Z",
			end: null,
		});

		const result = await closeMonth(fixture.db, {
			organizationId: org.organizationId,
			month: "2026-03",
			scope: { kind: "organization" },
			actor: { kind: "user", userId: org.ownerUserId },
			now,
		});

		expect(result.kind).toBe("blocked");
		expect(result.kind === "blocked" && result.blockers).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ kind: "absence_request", absenceId }),
				expect.objectContaining({ kind: "time_request", workPeriodId: pending.workPeriodId }),
				expect.objectContaining({ kind: "live_work", workPeriodId: live.workPeriodId }),
			]),
		);
		expect(
			await closedRangesForEmployee(fixture.db, {
				organizationId: org.organizationId,
				employeeId: person.employeeId,
			}),
		).toEqual([]);
	});

	it("refuses closing both months a pending weekly submission touches, and only those", async () => {
		const org = await fixture.organization("UTC");
		const person = await fixture.employee({ organizationId: org.organizationId });
		await fixture.submissionCadence({
			organizationId: org.organizationId,
			cadence: "weekly",
			changedAt: "2026-01-01T00:00:00Z",
			changedBy: org.ownerUserId,
		});
		const submissionId = await fixture.periodSubmission({
			organizationId: org.organizationId,
			employeeId: person.employeeId,
			submittedBy: person.userId,
			cadence: "weekly",
			startDate: "2026-03-30",
			endDate: "2026-04-05",
		});
		const close = (month: "2026-02" | "2026-03" | "2026-04") =>
			closeMonth(fixture.db, {
				organizationId: org.organizationId,
				month,
				scope: { kind: "organization" },
				actor: { kind: "user", userId: org.ownerUserId },
				now: parseInstant("2026-05-10T12:00:00Z"),
			});

		const march = await close("2026-03");
		const april = await close("2026-04");

		for (const result of [march, april]) {
			expect(result.kind === "blocked" && result.blockers).toEqual([
				{
					kind: "period_submission",
					employeeId: person.employeeId,
					employeeName: expect.any(String),
					submissionId,
					startDate: "2026-03-30",
					endDate: "2026-04-05",
				},
			]);
		}
		expect((await close("2026-02")).kind).toBe("closed");
	});

	it("does not block a close on decided or withdrawn submissions, or another organization's", async () => {
		const org = await fixture.organization("UTC");
		const other = await fixture.organization("UTC");
		const person = await fixture.employee({ organizationId: org.organizationId });
		const stranger = await fixture.employee({ organizationId: other.organizationId });
		for (const status of ["approved", "rejected", "withdrawn", "outdated"] as const) {
			await fixture.periodSubmission({
				organizationId: org.organizationId,
				employeeId: person.employeeId,
				submittedBy: person.userId,
				cadence: "monthly",
				startDate: "2026-03-01",
				endDate: "2026-03-31",
				status,
			});
		}
		await fixture.periodSubmission({
			organizationId: other.organizationId,
			employeeId: stranger.employeeId,
			submittedBy: stranger.userId,
			cadence: "monthly",
			startDate: "2026-03-01",
			endDate: "2026-03-31",
		});

		const result = await closeMonth(fixture.db, {
			organizationId: org.organizationId,
			month: "2026-03",
			scope: { kind: "organization" },
			actor: { kind: "user", userId: org.ownerUserId },
			now,
		});

		expect(result.kind).toBe("closed");
	});

	it("refuses to close a month that has not ended yet", async () => {
		const org = await fixture.organization("UTC");
		await fixture.employee({ organizationId: org.organizationId });

		const result = await closeMonth(fixture.db, {
			organizationId: org.organizationId,
			month: "2026-04",
			scope: { kind: "organization" },
			actor: { kind: "user", userId: org.ownerUserId },
			now,
		});

		expect(result.kind === "blocked" && result.blockers[0].kind).toBe("month_not_ended");
	});

	it("covers only employees still open when a partly closed month is closed", async () => {
		const org = await fixture.organization();
		const teamA = await fixture.team(org.organizationId, "A");
		const inA = await fixture.employee({ organizationId: org.organizationId, teamId: teamA });
		const other = await fixture.employee({ organizationId: org.organizationId });
		const close = (scope: Parameters<typeof closeMonth>[1]["scope"]) =>
			closeMonth(fixture.db, {
				organizationId: org.organizationId,
				month: "2026-03",
				scope,
				actor: { kind: "user", userId: org.ownerUserId },
				now,
			});
		await close({ kind: "team", teamId: teamA });

		const [partly] = await monthClosureStatuses(fixture.db, {
			organizationId: org.organizationId,
			months: ["2026-03"],
		});
		expect(partly.state).toBe("partly_closed");

		const result = await close({ kind: "organization" });

		expect(result.kind === "closed" && result.employeeIds).not.toContain(inA.employeeId);
		expect(result.kind === "closed" && result.employeeIds).toContain(other.employeeId);
		const [closed] = await monthClosureStatuses(fixture.db, {
			organizationId: org.organizationId,
			months: ["2026-03"],
		});
		expect(closed.state).toBe("closed");
	});

	it("refuses a reopening without a reason", async () => {
		const org = await fixture.organization();

		expect(
			await reopenMonth(fixture.db, {
				organizationId: org.organizationId,
				month: "2026-03",
				scope: { kind: "all" },
				reason: "   ",
				actorUserId: org.ownerUserId,
			}),
		).toEqual({ kind: "reason_required" });
	});

	it("reopens one employee while everyone else stays closed, and audits it", async () => {
		const org = await fixture.organization();
		const reopened = await fixture.employee({ organizationId: org.organizationId });
		const stays = await fixture.employee({ organizationId: org.organizationId });
		await closeMonth(fixture.db, {
			organizationId: org.organizationId,
			month: "2026-03",
			scope: { kind: "organization" },
			actor: { kind: "user", userId: org.ownerUserId },
			now,
		});

		const result = await reopenMonth(fixture.db, {
			organizationId: org.organizationId,
			month: "2026-03",
			scope: { kind: "employees", employeeIds: [reopened.employeeId] },
			reason: "Missed sick day",
			actorUserId: org.ownerUserId,
		});

		expect(result).toMatchObject({ kind: "reopened", employeeIds: [reopened.employeeId] });
		await expect(
			assertWorkOpen(fixture.db, {
				organizationId: org.organizationId,
				employeeId: reopened.employeeId,
				intervals: [marchShift],
			}),
		).resolves.toBeUndefined();
		await expect(
			assertWorkOpen(fixture.db, {
				organizationId: org.organizationId,
				employeeId: stays.employeeId,
				intervals: [marchShift],
			}),
		).rejects.toBeInstanceOf(MonthClosedError);
		expect((await auditActions(org.organizationId)).map((row) => row.action)).toEqual([
			"closed_month.closed",
			"closed_month.reopened",
		]);
	});

	it("stops covering employees added later once everything is reopened", async () => {
		const org = await fixture.organization();
		await fixture.employee({ organizationId: org.organizationId });
		await closeMonth(fixture.db, {
			organizationId: org.organizationId,
			month: "2026-03",
			scope: { kind: "organization" },
			actor: { kind: "user", userId: org.ownerUserId },
			now,
		});
		await reopenMonth(fixture.db, {
			organizationId: org.organizationId,
			month: "2026-03",
			scope: { kind: "all" },
			reason: "Payroll rerun",
			actorUserId: org.ownerUserId,
		});

		const late = await fixture.employee({ organizationId: org.organizationId });

		expect(
			await closedRangesForEmployee(fixture.db, {
				organizationId: org.organizationId,
				employeeId: late.employeeId,
			}),
		).toEqual([]);
	});
});
