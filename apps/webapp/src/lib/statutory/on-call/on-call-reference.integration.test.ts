/**
 * #1992: the read-only § 12 Abs. 4–5 TzBfG / § 4 EFZG reference-period calculator against real
 * PostgreSQL. Expected values are worked out by hand from the seeded calendar below.
 */
import { drizzle } from "drizzle-orm/node-postgres";
import { Temporal } from "temporal-polyfill";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import * as authSchema from "@/db/auth-schema";
import * as schema from "@/db/schema";
import { integrationAdminPool } from "@/test/integration-database";
import { statutoryFixture } from "@/test/statutory-fixtures";
import { calculateOnCallReferencePeriod, listOnCallReferenceEvents } from "./reference-period";
import { sickPayNoteOf } from "./sick-pay";
import { onCallFixture } from "./__tests__/on-call-fixture";
import { listOnCallPayrollReferenceRows, loadOnCallEmployeeStatus } from "./views";

describe("§ 12 TzBfG reference-period calculator (PostgreSQL)", () => {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
	const admin = integrationAdminPool();
	const fx = statutoryFixture(admin, "t1992-reference");
	const onCall = onCallFixture(admin, fx);

	beforeEach(fx.cleanup);
	afterAll(fx.cleanup);

	/**
	 * Hired 2026-04-01 (Berlin), on call throughout. 4 h worked on ten days; 3 h worked on 05-05
	 * during unpaid leave (05-04 … 05-08), which counts: no work was lost that day; vacation
	 * 05-18 … 05-19; public holiday 05-25; sick from 06-10.
	 */
	async function seededWorker() {
		const org = await onCall.organization("a");
		const worker = await fx.employee(org, "worker");
		const periodId = await onCall.employmentPeriod(org, worker, "2026-03-31T22:00:00Z");
		await onCall.onCallTerms(org, worker, {
			kind: "unspecified",
			from: "2026-04-01",
			employmentPeriodId: periodId,
		});
		for (const date of [
			"2026-04-07",
			"2026-04-14",
			"2026-04-21",
			"2026-04-28",
			"2026-05-12",
			"2026-05-26",
			"2026-06-02",
			"2026-06-03",
			"2026-06-04",
			"2026-06-05",
		]) {
			await onCall.work(org, worker, { date, startTime: "09:00", endTime: "13:00" });
		}
		await onCall.absence(org, worker, {
			type: "unpaid",
			startDate: "2026-05-04",
			endDate: "2026-05-08",
		});
		await onCall.work(org, worker, { date: "2026-05-05", startTime: "09:00", endTime: "12:00" });
		await onCall.absence(org, worker, {
			type: "vacation",
			startDate: "2026-05-18",
			endDate: "2026-05-19",
		});
		await onCall.holiday(org, worker, "2026-05-25");
		await onCall.absence(org, worker, {
			type: "sick",
			startDate: "2026-06-10",
			endDate: "2026-06-12",
		});
		// A rejected-to-be pending sick note is no event.
		await onCall.absence(org, worker, {
			type: "sick",
			startDate: "2026-06-20",
			endDate: "2026-06-20",
			status: "pending",
		});
		await onCall.holiday(org, worker, "2026-06-15");
		return { org, worker };
	}

	it("averages the 3 months before sick leave, leaving out pre-hire days and unworked absence", async () => {
		const { org, worker } = await seededWorker();

		const breakdown = await calculateOnCallReferencePeriod(db, {
			organizationId: org.id,
			employeeId: worker.employeeId,
			eventDate: "2026-06-10",
			method: "three_months",
		});

		expect(breakdown).toMatchObject({
			employeeId: worker.employeeId,
			eventDate: "2026-06-10",
			method: "three_months",
			referenceStart: "2026-03-10",
			referenceEndExclusive: "2026-06-10",
			calendarDays: 92,
			denominatorDays: 63,
			workedDays: 11,
			numeratorMinutes: 2580,
			averageMinutesPerDay: 41,
			averageMinutesPerWeek: 287,
			averageMinutesPerWorkedDay: 235,
			onCallOnEventDate: true,
			employmentShortened: true,
		});
		expect(breakdown.excludedPeriods).toEqual([
			{ from: "2026-03-10", untilExclusive: "2026-04-01", reason: "not_employed", days: 22 },
			{ from: "2026-05-04", untilExclusive: "2026-05-05", reason: "unpaid_absence", days: 1 },
			{ from: "2026-05-06", untilExclusive: "2026-05-09", reason: "unpaid_absence", days: 3 },
			{ from: "2026-05-18", untilExclusive: "2026-05-20", reason: "paid_absence", days: 2 },
			{ from: "2026-05-25", untilExclusive: "2026-05-26", reason: "public_holiday", days: 1 },
		]);
	});

	it("counts a worked public holiday and a worked half-day of vacation: only lost work is left out", async () => {
		const org = await onCall.organization("a");
		const worker = await fx.employee(org, "worker");
		const periodId = await onCall.employmentPeriod(org, worker, "2026-03-31T22:00:00Z");
		await onCall.onCallTerms(org, worker, {
			kind: "unspecified",
			from: "2026-04-01",
			employmentPeriodId: periodId,
		});
		// Easter Monday, worked 4 h.
		await onCall.holiday(org, worker, "2026-04-06");
		await onCall.work(org, worker, { date: "2026-04-06", startTime: "09:00", endTime: "13:00" });
		// A half-day of vacation, worked 2 h in the morning.
		await onCall.absence(org, worker, {
			type: "vacation",
			startDate: "2026-04-08",
			endDate: "2026-04-08",
		});
		await onCall.work(org, worker, { date: "2026-04-08", startTime: "09:00", endTime: "11:00" });
		// A holiday that was not worked is still left out.
		await onCall.holiday(org, worker, "2026-04-10");

		const breakdown = await calculateOnCallReferencePeriod(db, {
			organizationId: org.id,
			employeeId: worker.employeeId,
			eventDate: "2026-04-15",
			method: "three_months",
		});

		// Employed 04-01 … 04-14 (14 days), the unworked holiday left out: 13 days, 360 minutes.
		expect(breakdown).toMatchObject({
			denominatorDays: 13,
			workedDays: 2,
			numeratorMinutes: 360,
			averageMinutesPerDay: 28,
			averageMinutesPerWorkedDay: 180,
		});
		expect(breakdown.excludedPeriods).toEqual([
			{ from: "2026-01-15", untilExclusive: "2026-04-01", reason: "not_employed", days: 76 },
			{ from: "2026-04-10", untilExclusive: "2026-04-11", reason: "public_holiday", days: 1 },
		]);
	});

	it("offers the 13-week reference period", async () => {
		const { org, worker } = await seededWorker();

		const breakdown = await calculateOnCallReferencePeriod(db, {
			organizationId: org.id,
			employeeId: worker.employeeId,
			eventDate: "2026-06-10",
			method: "thirteen_weeks",
		});

		expect(breakdown).toMatchObject({
			referenceStart: "2026-03-11",
			referenceEndExclusive: "2026-06-10",
			calendarDays: 91,
			denominatorDays: 63,
			numeratorMinutes: 2580,
			averageMinutesPerDay: 41,
		});
		expect(breakdown.excludedPeriods[0]).toEqual({
			from: "2026-03-11",
			untilExclusive: "2026-04-01",
			reason: "not_employed",
			days: 21,
		});
	});

	it("lists approved sick-leave starts and public holidays with their reference periods", async () => {
		const { org, worker } = await seededWorker();

		const events = await listOnCallReferenceEvents(db, {
			organizationId: org.id,
			employeeId: worker.employeeId,
			from: "2026-06-01",
			untilExclusive: "2026-07-01",
			method: "three_months",
		});

		expect(events.map((event) => [event.kind, event.eventDate])).toEqual([
			["sick_leave", "2026-06-10"],
			["public_holiday", "2026-06-15"],
		]);
		expect(events[0]?.breakdown.averageMinutesPerDay).toBe(41);
		// The holiday's own reference period contains the three sick days.
		expect(events[1]?.breakdown.excludedPeriods).toContainEqual({
			from: "2026-06-10",
			untilExclusive: "2026-06-13",
			reason: "paid_absence",
			days: 3,
		});
	});

	it("lists only holidays on which work was lost; a holiday inside an illness is its own row, paid once", async () => {
		const org = await onCall.organization("a");
		const worker = await fx.employee(org, "worker");
		// Hired more than 4 weeks before the illness, so continued pay is owed (§ 3 Abs. 3 EFZG).
		const periodId = await onCall.employmentPeriod(org, worker, "2026-02-28T23:00:00Z");
		await onCall.onCallTerms(org, worker, {
			kind: "unspecified",
			from: "2026-03-01",
			employmentPeriodId: periodId,
		});
		// Good Friday, not worked: paid by § 12 Abs. 5 TzBfG, listed.
		await onCall.holiday(org, worker, "2026-04-03");
		// Easter Monday, worked anyway: no work was lost, nothing to pay.
		await onCall.holiday(org, worker, "2026-04-06");
		await onCall.work(org, worker, { date: "2026-04-06", startTime: "09:00", endTime: "13:00" });
		// A 10-day illness with a holiday on its third day: § 4 Abs. 2 EFZG pays that day by the
		// holiday rule, so it is its own row with the 3 months before the holiday itself.
		await onCall.absence(org, worker, {
			type: "sick",
			startDate: "2026-04-13",
			endDate: "2026-04-22",
		});
		await onCall.holiday(org, worker, "2026-04-15");

		const events = await listOnCallReferenceEvents(db, {
			organizationId: org.id,
			employeeId: worker.employeeId,
			from: "2026-04-01",
			untilExclusive: "2026-05-01",
			method: "three_months",
		});

		expect(events.map((event) => [event.kind, event.eventDate])).toEqual([
			["public_holiday", "2026-04-03"],
			["sick_leave", "2026-04-13"],
			["public_holiday", "2026-04-15"],
		]);
		const [, sick, holiday] = events;
		expect(sick?.breakdown).toMatchObject({
			referenceStart: "2026-01-13",
			referenceEndExclusive: "2026-04-13",
		});
		// The sick leave pays 04-13 … 04-22 except the holiday: 9 days.
		expect(sick?.paidSickDays).toEqual({
			from: "2026-04-13",
			untilExclusive: "2026-04-23",
			days: 9,
			holidaysPaidAsHolidays: ["2026-04-15"],
			// Within the six weeks: owed until the illness ends.
			continuedPay: { from: "2026-04-13", untilExclusive: "2026-04-23" },
		});
		expect(holiday?.paidSickDays).toBeUndefined();
		expect(holiday?.breakdown).toMatchObject({
			referenceStart: "2026-01-15",
			referenceEndExclusive: "2026-04-15",
			onCallOnEventDate: true,
		});
		expect(holiday?.breakdown.excludedPeriods).toContainEqual({
			from: "2026-04-13",
			untilExclusive: "2026-04-15",
			reason: "paid_absence",
			days: 2,
		});
	});

	/** Hired 2025-10-01 (Berlin), on call throughout, sick 2026-01-05 … 2026-03-31. */
	async function longIllness() {
		const org = await onCall.organization("a");
		const worker = await fx.employee(org, "worker");
		const periodId = await onCall.employmentPeriod(org, worker, "2025-09-30T22:00:00Z");
		await onCall.onCallTerms(org, worker, {
			kind: "unspecified",
			from: "2025-10-01",
			employmentPeriodId: periodId,
		});
		await onCall.absence(org, worker, {
			type: "sick",
			startDate: "2026-01-05",
			endDate: "2026-03-31",
		});
		const listed = (from: string, untilExclusive: string) =>
			listOnCallReferenceEvents(db, {
				organizationId: org.id,
				employeeId: worker.employeeId,
				from,
				untilExclusive,
				method: "three_months",
			});
		return { org, worker, listed };
	}

	it("pays an illness for at most 6 weeks from its first day (§ 3 Abs. 1 EFZG)", async () => {
		const { org, listed } = await longIllness();

		// 2026-01-05 + 42 days: continued pay ends with 2026-02-15.
		const whole = await listed("2026-01-01", "2026-04-01");
		expect(whole.map((event) => [event.kind, event.eventDate])).toEqual([
			["sick_leave", "2026-01-05"],
		]);
		expect(whole[0]?.paidSickDays).toEqual({
			from: "2026-01-05",
			untilExclusive: "2026-04-01",
			days: 42,
			holidaysPaidAsHolidays: [],
			continuedPay: { from: "2026-01-05", untilExclusive: "2026-02-16" },
		});

		// March is past the 6 weeks: the illness is listed, but nothing is owed for it.
		const march = await listed("2026-03-01", "2026-04-01");
		expect(march.map((event) => [event.kind, event.eventDate])).toEqual([
			["sick_leave", "2026-01-05"],
		]);
		expect(march[0]?.paidSickDays).toMatchObject({ from: "2026-03-01", days: 0 });

		const payroll = await listOnCallPayrollReferenceRows(db, {
			organizationId: org.id,
			startDate: "2026-03-01",
			endDate: "2026-03-31",
			method: "three_months",
		});
		expect(payroll.map((row) => [row.kind, row.eventDate, row.paidSickDays?.days])).toEqual([
			["sick_leave", "2026-01-05", 0],
		]);
	});

	it("pays no holiday inside an illness after its 6 weeks of continued pay (§ 4 Abs. 2 EFZG)", async () => {
		const { org, worker, listed } = await longIllness();
		// In week 1: paid by the holiday rule. After week 6: nothing is owed for it.
		await onCall.holiday(org, worker, "2026-01-06");
		await onCall.holiday(org, worker, "2026-03-20");

		const whole = await listed("2026-01-01", "2026-04-01");
		expect(whole.map((event) => [event.kind, event.eventDate])).toEqual([
			["sick_leave", "2026-01-05"],
			["public_holiday", "2026-01-06"],
		]);
		expect(whole[0]?.paidSickDays).toMatchObject({
			days: 41,
			holidaysPaidAsHolidays: ["2026-01-06"],
		});

		const march = await listed("2026-03-01", "2026-04-01");
		expect(march.map((event) => [event.kind, event.eventDate])).toEqual([
			["sick_leave", "2026-01-05"],
		]);
		expect(march[0]?.paidSickDays).toMatchObject({ days: 0, holidaysPaidAsHolidays: [] });
	});

	it("owes nothing in the first 4 weeks of employment, then pays from day 29 (§ 3 Abs. 3 EFZG)", async () => {
		const org = await onCall.organization("a");
		const worker = await fx.employee(org, "worker");
		// Hired 2026-03-02: the 4 weeks end with 2026-03-29.
		const periodId = await onCall.employmentPeriod(org, worker, "2026-03-01T23:00:00Z");
		await onCall.onCallTerms(org, worker, {
			kind: "unspecified",
			from: "2026-03-02",
			employmentPeriodId: periodId,
		});
		await onCall.absence(org, worker, {
			type: "sick",
			startDate: "2026-03-10",
			endDate: "2026-05-31",
		});
		// Inside the illness but in the waiting time: no holiday pay either.
		await onCall.holiday(org, worker, "2026-03-20");
		const listed = (untilExclusive: string) =>
			listOnCallReferenceEvents(db, {
				organizationId: org.id,
				employeeId: worker.employeeId,
				from: "2026-03-01",
				untilExclusive,
				method: "three_months",
			});

		const untilWaitingEnds = await listed("2026-03-30");
		expect(untilWaitingEnds.map((event) => [event.kind, event.eventDate])).toEqual([
			["sick_leave", "2026-03-10"],
		]);
		expect(untilWaitingEnds[0]?.paidSickDays).toEqual({
			from: "2026-03-10",
			untilExclusive: "2026-03-30",
			days: 0,
			holidaysPaidAsHolidays: [],
			// Six weeks from the day the entitlement arises.
			continuedPay: { from: "2026-03-30", untilExclusive: "2026-05-11" },
		});

		const march = await listed("2026-04-01");
		expect(march.map((event) => [event.kind, event.eventDate])).toEqual([
			["sick_leave", "2026-03-10"],
		]);
		expect(march[0]?.paidSickDays).toMatchObject({ days: 2 });
	});

	it("tells payroll the claim is still to come when a follow-up certificate continues the illness past the period", async () => {
		const org = await onCall.organization("a");
		const worker = await fx.employee(org, "worker");
		const colleague = await fx.employee(org, "colleague");
		// Both hired 2026-03-09: the claim arises on 2026-04-06 (§ 3 Abs. 3 EFZG).
		for (const employee of [worker, colleague]) {
			const periodId = await onCall.employmentPeriod(org, employee, "2026-03-08T23:00:00Z");
			await onCall.onCallTerms(org, employee, {
				kind: "unspecified",
				from: "2026-03-09",
				employmentPeriodId: periodId,
			});
		}
		// Sick 03-20 … 03-31, then a follow-up certificate 04-01 … 04-20: one illness, reaching the
		// claim.
		await onCall.absence(org, worker, {
			type: "sick",
			startDate: "2026-03-20",
			endDate: "2026-03-31",
		});
		await onCall.absence(org, worker, {
			type: "sick",
			startDate: "2026-04-01",
			endDate: "2026-04-20",
		});
		// The colleague's illness genuinely ends inside the first four weeks; a later one after a gap
		// does not continue it.
		await onCall.absence(org, colleague, {
			type: "sick",
			startDate: "2026-03-20",
			endDate: "2026-03-31",
		});
		await onCall.absence(org, colleague, {
			type: "sick",
			startDate: "2026-04-02",
			endDate: "2026-04-20",
		});
		const notes = async (startDate: string, endDate: string) =>
			new Map(
				(
					await listOnCallPayrollReferenceRows(db, {
						organizationId: org.id,
						startDate,
						endDate,
						method: "three_months",
					})
				).flatMap((row) =>
					row.kind === "sick_leave" && row.paidSickDays
						? [[`${row.employeeId} ${row.eventDate}`, sickPayNoteOf(row.paidSickDays)] as const]
						: [],
				),
			);

		const march = await notes("2026-03-01", "2026-03-31");
		expect(march.get(`${worker.employeeId} 2026-03-20`)).toEqual({
			kind: "waiting",
			claimArises: "2026-04-06",
		});
		expect(march.get(`${colleague.employeeId} 2026-03-20`)).toEqual({ kind: "not_owed" });

		const april = await notes("2026-04-01", "2026-04-30");
		expect(april.get(`${worker.employeeId} 2026-03-20`)).toEqual({
			kind: "paid",
			days: 15,
			limitedTo: { from: "2026-04-06", lastDay: "2026-04-20" },
		});
	});

	it("lists no holiday during parental or unpaid leave: no work is lost to it", async () => {
		const org = await onCall.organization("a");
		const worker = await fx.employee(org, "worker");
		const periodId = await onCall.employmentPeriod(org, worker, "2025-10-31T23:00:00Z");
		await onCall.onCallTerms(org, worker, {
			kind: "unspecified",
			from: "2025-11-01",
			employmentPeriodId: periodId,
		});
		await onCall.absence(org, worker, {
			type: "parental",
			startDate: "2025-12-01",
			endDate: "2026-01-31",
		});
		await onCall.absence(org, worker, {
			type: "unpaid",
			startDate: "2026-02-09",
			endDate: "2026-02-13",
		});
		for (const date of ["2025-12-25", "2025-12-26", "2026-01-01", "2026-02-10"]) {
			await onCall.holiday(org, worker, date);
		}
		// An ordinary holiday not worked is still listed.
		await onCall.holiday(org, worker, "2026-02-16");

		const events = await listOnCallReferenceEvents(db, {
			organizationId: org.id,
			employeeId: worker.employeeId,
			from: "2025-12-01",
			untilExclusive: "2026-03-01",
			method: "three_months",
		});

		expect(events.map((event) => [event.kind, event.eventDate])).toEqual([
			["public_holiday", "2026-02-16"],
		]);
	});

	it("lists sick leave that started before the period and runs into it, from its own start", async () => {
		const { org, worker } = await seededWorker();
		await onCall.absence(org, worker, {
			type: "sick",
			startDate: "2026-05-29",
			endDate: "2026-06-01",
		});
		// Over before the period began: not one of the period's events.
		await onCall.absence(org, worker, {
			type: "sick",
			startDate: "2026-04-20",
			endDate: "2026-04-22",
		});

		const events = await listOnCallReferenceEvents(db, {
			organizationId: org.id,
			employeeId: worker.employeeId,
			from: "2026-06-01",
			untilExclusive: "2026-07-01",
			method: "three_months",
		});

		expect(events.map((event) => [event.kind, event.eventDate])).toEqual([
			["sick_leave", "2026-05-29"],
			["sick_leave", "2026-06-10"],
			["public_holiday", "2026-06-15"],
		]);
		const fromMay = await calculateOnCallReferencePeriod(db, {
			organizationId: org.id,
			employeeId: worker.employeeId,
			eventDate: "2026-05-29",
			method: "three_months",
		});
		expect(events[0]?.breakdown).toEqual(fromMay);
		expect(fromMay.referenceStart).toBe("2026-02-28");
	});

	it("dates a continued illness recorded as back-to-back sick leave from its first day", async () => {
		const org = await onCall.organization("a");
		const worker = await fx.employee(org, "worker");
		const periodId = await onCall.employmentPeriod(org, worker, "2025-11-30T23:00:00Z");
		await onCall.onCallTerms(org, worker, {
			kind: "unspecified",
			from: "2025-12-01",
			employmentPeriodId: periodId,
		});
		// 4 h on every Tuesday from 2025-12-02 through 2026-02-24 (13 days).
		for (let day = Temporal.PlainDate.from("2025-12-02"); day.toString() < "2026-03-01";) {
			await onCall.work(org, worker, {
				date: day.toString(),
				startTime: "09:00",
				endTime: "13:00",
			});
			day = day.add({ days: 7 });
		}
		await onCall.absence(org, worker, {
			type: "sick",
			startDate: "2026-03-02",
			endDate: "2026-03-08",
		});
		await onCall.absence(org, worker, {
			type: "sick",
			startDate: "2026-03-09",
			endDate: "2026-03-15",
		});
		// A new illness after a gap day is a new event.
		await onCall.absence(org, worker, {
			type: "sick",
			startDate: "2026-03-17",
			endDate: "2026-03-18",
		});

		const fromMarch2 = await calculateOnCallReferencePeriod(db, {
			organizationId: org.id,
			employeeId: worker.employeeId,
			eventDate: "2026-03-02",
			method: "three_months",
		});
		// 2025-12-02 … 2026-03-01: 30 + 31 + 28 + 1 = 90 days, 13 Tuesdays × 240 minutes.
		expect(fromMarch2).toMatchObject({
			referenceStart: "2025-12-02",
			denominatorDays: 90,
			numeratorMinutes: 3120,
			averageMinutesPerDay: 35,
		});

		const listed = (from: string) =>
			listOnCallReferenceEvents(db, {
				organizationId: org.id,
				employeeId: worker.employeeId,
				from,
				untilExclusive: "2026-04-01",
				method: "three_months",
			});
		// Both leaves in the range, and only the second one running into it.
		for (const from of ["2026-03-01", "2026-03-10"]) {
			const events = await listed(from);
			expect(events.map((event) => [event.kind, event.eventDate])).toEqual([
				["sick_leave", "2026-03-02"],
				["sick_leave", "2026-03-17"],
			]);
			expect(events[0]?.breakdown).toEqual(fromMarch2);
		}
		// A payroll period starting with the second leave lists the illness once, from its start.
		const payroll = await listOnCallPayrollReferenceRows(db, {
			organizationId: org.id,
			startDate: "2026-03-09",
			endDate: "2026-03-31",
			method: "three_months",
		});
		expect(payroll.map((row) => [row.kind, row.eventDate])).toEqual([
			["sick_leave", "2026-03-02"],
			["sick_leave", "2026-03-17"],
		]);
		expect(payroll[0]?.breakdown).toEqual(fromMarch2);
	});

	/**
	 * Hired 2025-12-01 (Berlin), on call throughout. A child's sickness is § 45 SGB V
	 * (Kinderkrankengeld), not the employee's own illness: no § 3 EFZG continued pay and no
	 * § 12 Abs. 4 TzBfG event.
	 */
	async function childSickWorker() {
		const org = await onCall.organization("a");
		const worker = await fx.employee(org, "worker");
		const periodId = await onCall.employmentPeriod(org, worker, "2025-11-30T23:00:00Z");
		await onCall.onCallTerms(org, worker, {
			kind: "unspecified",
			from: "2025-12-01",
			employmentPeriodId: periodId,
		});
		return { org, worker };
	}

	it("dates own illness after child-sick days from its own first day (§ 45 SGB V is no illness)", async () => {
		const { org, worker } = await childSickWorker();
		// Child sick Mon 03-02 … Wed 03-04, then ill themself Thu 03-05 … 04-30.
		await onCall.absence(org, worker, {
			type: "sick",
			sickDetail: "child_sick",
			startDate: "2026-03-02",
			endDate: "2026-03-04",
		});
		await onCall.absence(org, worker, {
			type: "sick",
			sickDetail: "with_certificate",
			startDate: "2026-03-05",
			endDate: "2026-04-30",
		});

		const payroll = await listOnCallPayrollReferenceRows(db, {
			organizationId: org.id,
			startDate: "2026-03-01",
			endDate: "2026-04-30",
			method: "three_months",
		});

		expect(payroll.map((row) => [row.kind, row.eventDate])).toEqual([["sick_leave", "2026-03-05"]]);
		// Six weeks from Thursday: 03-05 + 42 days.
		expect(payroll[0]?.paidSickDays).toMatchObject({
			from: "2026-03-05",
			days: 42,
			continuedPay: { from: "2026-03-05", untilExclusive: "2026-04-16" },
		});
		expect(payroll[0]?.breakdown).toMatchObject({
			referenceStart: "2025-12-05",
			referenceEndExclusive: "2026-03-05",
		});
		// The child-sick days released the employee without pay: left out of the average.
		expect(payroll[0]?.breakdown.excludedPeriods).toContainEqual({
			from: "2026-03-02",
			untilExclusive: "2026-03-05",
			reason: "unpaid_absence",
			days: 3,
		});

		// A payroll period starting inside the illness does not walk back into the child-sick days.
		const april = await listOnCallPayrollReferenceRows(db, {
			organizationId: org.id,
			startDate: "2026-04-01",
			endDate: "2026-04-30",
			method: "three_months",
		});
		expect(april.map((row) => [row.kind, row.eventDate])).toEqual([["sick_leave", "2026-03-05"]]);
	});

	it("lists no sick-leave row and no holiday pay for child-sick days alone", async () => {
		const { org, worker } = await childSickWorker();
		await onCall.absence(org, worker, {
			type: "sick",
			sickDetail: "child_sick",
			startDate: "2026-03-02",
			endDate: "2026-03-06",
		});
		// Released without pay for the child already: no work is lost to the holiday.
		await onCall.holiday(org, worker, "2026-03-04");

		const payroll = await listOnCallPayrollReferenceRows(db, {
			organizationId: org.id,
			startDate: "2026-03-01",
			endDate: "2026-03-31",
			method: "three_months",
		});

		expect(payroll).toEqual([]);
	});

	it("lists no event for days after the employment ended, though the on-call terms run on", async () => {
		const org = await onCall.organization("a");
		const worker = await fx.employee(org, "worker");
		const periodId = await onCall.employmentPeriod(
			org,
			worker,
			"2026-03-31T22:00:00Z",
			"2026-06-12T22:00:00Z",
		);
		await onCall.onCallTerms(org, worker, {
			kind: "unspecified",
			from: "2026-04-01",
			employmentPeriodId: periodId,
		});
		await onCall.work(org, worker, { date: "2026-06-02", startTime: "09:00", endTime: "13:00" });
		await onCall.holiday(org, worker, "2026-06-04");
		await onCall.holiday(org, worker, "2026-06-15");
		await onCall.absence(org, worker, {
			type: "sick",
			startDate: "2026-06-16",
			endDate: "2026-06-17",
		});

		const events = await listOnCallReferenceEvents(db, {
			organizationId: org.id,
			employeeId: worker.employeeId,
			from: "2026-06-01",
			untilExclusive: "2026-07-01",
			method: "three_months",
		});
		const afterLeaving = await calculateOnCallReferencePeriod(db, {
			organizationId: org.id,
			employeeId: worker.employeeId,
			eventDate: "2026-06-15",
			method: "three_months",
		});

		expect(events.map((event) => [event.kind, event.eventDate])).toEqual([
			["public_holiday", "2026-06-04"],
		]);
		expect(afterLeaving.onCallOnEventDate).toBe(false);

		const status = await loadOnCallEmployeeStatus(db, {
			organizationId: org.id,
			employeeId: worker.employeeId,
			timezone: org.timezone,
			now: Temporal.Instant.from("2026-06-20T10:00:00Z"),
			audience: "full",
			selfView: false,
			method: "three_months",
		});
		expect(status).toMatchObject({ hasOnCallTerms: true, terms: null });
		expect(status.referenceEvents.map((event) => event.eventDate)).toEqual(["2026-06-04"]);
	});

	it("never writes: it runs inside a READ ONLY transaction and leaves settled days untouched", async () => {
		const { org, worker } = await seededWorker();
		await admin.query(
			`INSERT INTO payroll_settled_day (organization_id, employee_id, date, timezone, credited_minutes, method)
			 VALUES ($1, $2, '2026-04-07', 'Europe/Berlin', 240, 'manual')`,
			[org.id, worker.employeeId],
		);
		const before = await admin.query(
			`SELECT * FROM payroll_settled_day WHERE organization_id = $1 ORDER BY id`,
			[org.id],
		);

		const client = await admin.connect();
		try {
			await client.query("BEGIN READ ONLY");
			const readOnly = drizzle({ client, schema: { ...authSchema, ...schema } });
			const breakdown = await calculateOnCallReferencePeriod(readOnly as unknown as typeof db, {
				organizationId: org.id,
				employeeId: worker.employeeId,
				eventDate: "2026-06-10",
				method: "three_months",
			});
			expect(breakdown.numeratorMinutes).toBe(2580);
			await client.query("COMMIT");
		} finally {
			client.release();
		}

		const after = await admin.query(
			`SELECT * FROM payroll_settled_day WHERE organization_id = $1 ORDER BY id`,
			[org.id],
		);
		expect(after.rows).toEqual(before.rows);
	});

	it("refuses an employee of another organization", async () => {
		const { worker } = await seededWorker();
		const other = await onCall.organization("b");

		await expect(
			calculateOnCallReferencePeriod(db, {
				organizationId: other.id,
				employeeId: worker.employeeId,
				eventDate: "2026-06-10",
				method: "three_months",
			}),
		).rejects.toMatchObject({ _tag: "NotFoundError" });
	});
});
