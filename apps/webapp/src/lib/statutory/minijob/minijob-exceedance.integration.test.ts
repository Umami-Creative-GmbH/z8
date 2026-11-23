/**
 * #1989: occasional unforeseeable Minijob exceedances (§ 8 Abs. 1b SGB IV) — up to two months in
 * a rolling 12 months, each at most twice the month's cap, documented by an org admin. Anything
 * else, or any change to what an acknowledgement covered, is critical.
 */
import { Temporal } from "temporal-polyfill";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { integrationAdminPool } from "@/test/integration-database";
import { statutoryFixture } from "@/test/statutory-fixtures";
import { DEFAULT_STATUTORY_PREFERENCES } from "../preferences";
import { evaluateStatutoryScheduleFindings } from "../scheduling/evaluate";
import { acknowledgeMinijobExceedance } from "./acknowledge-minijob-exceedance";
import { evaluateMinijobEarnings } from "./evaluate-minijob";
import { minijobFixture } from "./minijob-database.test.fixture";
import { loadEmployeeMinijobMonitor } from "./minijob-monitor-view";
import { addMonths } from "./minijob-months";
import { loadMinijobExceedanceReviews } from "./minijob-reviews";
import { minijobScheduleContributor } from "./minijob-schedule-contributor";

const NOW = Temporal.Instant.from("2026-11-23T12:00:00Z");

describe("Minijob unforeseeable exceedances (PostgreSQL)", () => {
	vi.setConfig({ testTimeout: 120_000, hookTimeout: 60_000 });
	const admin = integrationAdminPool();
	const fx = statutoryFixture(admin, "t1989-exceed");
	const mj = minijobFixture(admin, fx);

	beforeEach(async () => {
		mj.reset();
		await fx.cleanup();
	});
	afterAll(fx.cleanup);

	async function setup(hourlyRate = 10) {
		const org = await fx.organization("a");
		const owner = await fx.user("owner");
		await fx.membership(org, owner, "owner");
		const worker = await fx.employee(org, "worker", { contractType: "hourly" });
		// 10 € an hour by default; the 2026 cap is 603 €, twice the cap 1,206 €.
		await mj.terms(worker, owner, { from: "2026-01-01", hourlyRate });
		return { org, owner, worker };
	}
	type Setup = Awaited<ReturnType<typeof setup>>;

	async function monthly({ org, worker }: Setup, from: string, until: string, now = NOW) {
		const { findings } = await evaluateMinijobEarnings(db, {
			organizationId: org.id,
			timezone: org.timezone,
			employeeIds: [worker.employeeId],
			months: { from, until },
			preferences: DEFAULT_STATUTORY_PREFERENCES,
			now,
		});
		return findings
			.filter((f) => f.kind === "minijob_monthly_cap" && f.summary.tier === "exceeded")
			.map((f) => [f.subjectKey, f.severity, f.adminDetail?.facts?.exceedanceStatus]);
	}

	/** The fingerprint and total an org admin is shown for the month. */
	async function shownFigures({ org, worker }: Setup, month: string) {
		const { employees } = await evaluateMinijobEarnings(db, {
			organizationId: org.id,
			timezone: org.timezone,
			employeeIds: [worker.employeeId],
			months: { from: month, until: addMonths(month, 1) },
			preferences: DEFAULT_STATUTORY_PREFERENCES,
			now: NOW,
		});
		const shown = employees.get(worker.employeeId)?.find((m) => m.month === month);
		return { fingerprint: shown?.fingerprint ?? "", totalCents: shown?.totalCents ?? 0 };
	}

	async function acknowledge(
		s: Setup,
		month: string,
		reason = "Covered a sick colleague",
		shown?: { fingerprint: string; totalCents: number },
	) {
		const figures = shown ?? (await shownFigures(s, month));
		return acknowledgeMinijobExceedance(db, {
			organizationId: s.org.id,
			actorUserId: s.owner.userId,
			employeeId: s.worker.employeeId,
			month,
			reason,
			expectedFingerprint: figures.fingerprint,
			expectedTotalCents: figures.totalCents,
			now: NOW,
		});
	}

	it("refuses to acknowledge figures that changed since they were shown", async () => {
		const s = await setup();
		await mj.monthWork(s.org, s.worker, "2026-01", 4200);
		const shown = await shownFigures(s, "2026-01");

		await mj.work(s.org, s.worker, "2026-01-28", 60);

		await expect(acknowledge(s, "2026-01", "Sick cover", shown)).rejects.toMatchObject({
			refusal: "minijob_exceedance_changed",
		});
		expect(await monthly(s, "2026-01", "2026-02")).toEqual([
			["2026-01", "critical", "unacknowledged"],
		]);
	});

	it("lets two acknowledged exceedances pass and makes the third critical", async () => {
		const s = await setup();
		for (const month of ["2026-01", "2026-03", "2026-05"]) {
			await mj.monthWork(s.org, s.worker, month, 4200); // 700 €
		}

		expect(await monthly(s, "2026-01", "2026-06")).toEqual([
			["2026-01", "critical", "unacknowledged"],
			["2026-03", "critical", "unacknowledged"],
			["2026-05", "critical", "too_many_exceedances"],
		]);

		await acknowledge(s, "2026-01");
		await acknowledge(s, "2026-03");
		await expect(acknowledge(s, "2026-05")).rejects.toMatchObject({
			refusal: "minijob_exceedance_not_acknowledgeable",
		});

		expect(await monthly(s, "2026-01", "2026-06")).toEqual([
			["2026-01", "info", "acknowledged"],
			["2026-03", "info", "acknowledged"],
			["2026-05", "critical", "too_many_exceedances"],
		]);
	});

	it("tells scoped managers on Employee Detail which exceeded months are documented, wage-free", async () => {
		const s = await setup();
		await mj.monthWork(s.org, s.worker, "2026-01", 4200);
		await mj.monthWork(s.org, s.worker, "2026-03", 4200);
		await acknowledge(s, "2026-01");

		const view = await loadEmployeeMinijobMonitor(db, {
			organizationId: s.org.id,
			employeeId: s.worker.employeeId,
			audience: "restricted",
			now: NOW,
		});

		const month = (key: string) => view.months.find((m) => m.month === key);
		expect(month("2026-01")).toEqual({
			month: "2026-01",
			isMinijob: true,
			tier: "exceeded",
			rollingTier: expect.any(String),
			documented: true,
		});
		expect(month("2026-03")).toMatchObject({ tier: "exceeded", documented: false });
		expect(month("2026-02")).toMatchObject({ documented: false });
	});

	it("leaves the excess of acknowledged months out of the rolling 12 months", async () => {
		const s = await setup();
		await mj.monthWork(s.org, s.worker, "2026-01", 4200);
		await mj.monthWork(s.org, s.worker, "2026-03", 4200);
		await acknowledge(s, "2026-01");
		await acknowledge(s, "2026-03");

		const { employees } = await evaluateMinijobEarnings(db, {
			organizationId: s.org.id,
			timezone: s.org.timezone,
			employeeIds: [s.worker.employeeId],
			months: { from: "2026-03", until: "2026-04" },
			preferences: DEFAULT_STATUTORY_PREFERENCES,
			now: NOW,
		});

		// January–March 2026 are the only Minijob months: 3 × 603 € of caps; 1,400 € earned, of
		// which 2 × 97 € is acknowledged excess.
		expect(employees.get(s.worker.employeeId)?.at(-1)?.rolling).toMatchObject({
			fromMonth: "2025-04",
			capCents: 180_900,
			totalCents: 120_600,
			excludedCents: 19_400,
			minijobMonths: 3,
		});
	});

	it("never accepts a month above twice the cap", async () => {
		const s = await setup();
		await mj.monthWork(s.org, s.worker, "2026-02", 7300); // 1,216.67 €

		await expect(acknowledge(s, "2026-02")).rejects.toMatchObject({
			refusal: "minijob_exceedance_not_acknowledgeable",
		});
		expect(await monthly(s, "2026-02", "2026-03")).toEqual([
			["2026-02", "critical", "over_double_cap"],
		]);
	});

	it("refuses to acknowledge a month within the cap", async () => {
		const s = await setup();
		await mj.monthWork(s.org, s.worker, "2026-02", 600);

		await expect(acknowledge(s, "2026-02")).rejects.toMatchObject({
			refusal: "minijob_not_exceeded",
		});
	});

	it("turns an acknowledgement stale when more work is recorded in the month", async () => {
		const s = await setup();
		await mj.monthWork(s.org, s.worker, "2026-01", 4200);
		await acknowledge(s, "2026-01");
		expect(await monthly(s, "2026-01", "2026-02")).toEqual([["2026-01", "info", "acknowledged"]]);

		await mj.work(s.org, s.worker, "2026-01-28", 60);

		expect(await monthly(s, "2026-01", "2026-02")).toEqual([["2026-01", "critical", "stale"]]);
	});

	it("turns an acknowledgement stale when another shift is planned in the month", async () => {
		const s = await setup();
		for (const date of [
			"2026-12-01",
			"2026-12-02",
			"2026-12-03",
			"2026-12-04",
			"2026-12-07",
			"2026-12-08",
			"2026-12-09",
		]) {
			await mj.shift(s.org, s.worker, s.owner, { date, startTime: "08:00", endTime: "18:00" });
		}
		expect(await monthly(s, "2026-12", "2027-01")).toEqual([
			["2026-12", "critical", "unacknowledged"],
		]);
		const record = await acknowledge(s, "2026-12", "Christmas cover agreed after a resignation");
		expect(record).toMatchObject({
			kind: "minijob_unforeseeable_exceedance",
			findingKind: "minijob_monthly_cap",
			subjectKey: "2026-12",
			reason: "Christmas cover agreed after a resignation",
		});
		expect(await monthly(s, "2026-12", "2027-01")).toEqual([["2026-12", "info", "acknowledged"]]);

		await mj.shift(s.org, s.worker, s.owner, {
			date: "2026-12-10",
			startTime: "08:00",
			endTime: "10:00",
		});

		expect(await monthly(s, "2026-12", "2027-01")).toEqual([["2026-12", "critical", "stale"]]);
	});

	it("keeps an acknowledgement current while a planned shift is worked as planned", async () => {
		const s = await setup();
		const days = ["2026-12-01", "2026-12-02", "2026-12-03", "2026-12-04", "2026-12-07"];
		for (const date of [...days, "2026-12-08", "2026-12-09"]) {
			await mj.shift(s.org, s.worker, s.owner, { date, startTime: "08:00", endTime: "18:00" });
		}
		// 70 planned hours, 700 €: documented before the month starts.
		await acknowledge(s, "2026-12", "Christmas cover agreed after a resignation");
		const december = (now: string) => monthly(s, "2026-12", "2027-01", Temporal.Instant.from(now));

		// 1 December, 10:00 Berlin: clocked in on time for the first shift.
		const work = await mj.openWork(s.org, s.worker, "2026-12-01", "08:00");
		expect(await december("2026-12-01T09:00:00Z")).toEqual([["2026-12", "info", "acknowledged"]]);

		// 19:00 Berlin: clocked out on time.
		await mj.closeWork(work, 600);
		expect(await december("2026-12-01T18:00:00Z")).toEqual([["2026-12", "info", "acknowledged"]]);

		// The rest of the week is worked exactly as planned too.
		for (const date of days.slice(1)) await mj.work(s.org, s.worker, date, 600);
		expect(await december("2026-12-07T20:00:00Z")).toEqual([["2026-12", "info", "acknowledged"]]);

		// Another shift is new work: the acknowledgement no longer covers the month.
		await mj.shift(s.org, s.worker, s.owner, {
			date: "2026-12-10",
			startTime: "08:00",
			endTime: "10:00",
		});
		expect(await december("2026-12-07T20:00:00Z")).toEqual([["2026-12", "critical", "stale"]]);
	});

	it.each([
		{
			note: "one clock-in over back-to-back shifts across the month end",
			// 31 Jan 18:00 → 1 Feb 06:00: six hours belong to January, six to February.
			async record(s: Setup) {
				await mj.shift(s.org, s.worker, s.owner, {
					date: "2026-01-31",
					startTime: "18:00",
					endTime: "00:00",
				});
				await mj.shift(s.org, s.worker, s.owner, {
					date: "2026-02-01",
					startTime: "00:00",
					endTime: "06:00",
				});
				await mj.work(s.org, s.worker, "2026-01-31", 720, "18:00");
			},
			// 70 h + 6 h at 10 €.
			januaryCents: 76_000,
		},
		{
			note: "a night shift with a clocked-out break across midnight",
			// Clocked out at 00:30 for a break, back from 01:00 to 06:00: all of it is January's shift.
			async record(s: Setup) {
				await mj.shift(s.org, s.worker, s.owner, {
					date: "2026-01-31",
					startTime: "22:00",
					endTime: "06:00",
				});
				await mj.work(s.org, s.worker, "2026-01-31", 150, "22:00");
				await mj.work(s.org, s.worker, "2026-02-01", 300, "01:00");
			},
			// 70 h + 7.5 h at 10 €.
			januaryCents: 77_500,
		},
	])("gives every caller the same January for $note", async ({ record, januaryCents }) => {
		const s = await setup();
		const now = Temporal.Instant.from("2026-02-10T12:00:00Z");
		await mj.monthWork(s.org, s.worker, "2026-01", 4200);
		await record(s);
		const january = (reviews: Awaited<ReturnType<typeof loadMinijobExceedanceReviews>>) =>
			reviews.find((review) => review.month === "2026-01");
		const monitorJanuary = async () => {
			const view = await loadEmployeeMinijobMonitor(db, {
				organizationId: s.org.id,
				employeeId: s.worker.employeeId,
				audience: "full",
				now,
			});
			return view.audience === "full"
				? view.months.find((month) => month.month === "2026-01")
				: undefined;
		};
		const scheduling = (window: { start: string; endExclusive: string }) =>
			evaluateStatutoryScheduleFindings(
				db,
				{
					organizationId: s.org.id,
					timezone: s.org.timezone,
					window,
					employeeIds: [s.worker.employeeId],
					now,
				},
				[minijobScheduleContributor],
			);

		// Reviews & Conflicts (through March) and Employee Detail (through February).
		const shown = january(
			await loadMinijobExceedanceReviews(db, { organizationId: s.org.id, now }),
		);
		expect(shown?.totalCents).toBe(januaryCents);
		expect((await monitorJanuary())?.totalCents).toBe(januaryCents);

		// The acknowledgement re-evaluates January alone and finds what Reviews showed.
		const acknowledged = await acknowledgeMinijobExceedance(db, {
			organizationId: s.org.id,
			actorUserId: s.owner.userId,
			employeeId: s.worker.employeeId,
			month: "2026-01",
			reason: "Covered a sick colleague",
			expectedFingerprint: shown?.inputFingerprint ?? "",
			expectedTotalCents: shown?.totalCents ?? 0,
			now,
		});
		expect(acknowledged.inputFingerprint).toBe(shown?.inputFingerprint);
		expect(acknowledged.metadata.amountsCents).toMatchObject({ total: januaryCents });

		// Each caller's range: the acknowledgement and a Scheduling week ending in January (until
		// February), a Scheduling week into February (until March), Employee Detail and Reviews
		// (until April).
		for (const until of ["2026-02", "2026-03", "2026-04"]) {
			const { employees } = await evaluateMinijobEarnings(db, {
				organizationId: s.org.id,
				timezone: s.org.timezone,
				employeeIds: [s.worker.employeeId],
				months: { from: "2026-01", until },
				preferences: DEFAULT_STATUTORY_PREFERENCES,
				now,
			});
			const month = employees.get(s.worker.employeeId)?.find((m) => m.month === "2026-01");
			expect({ until, total: month?.totalCents, fingerprint: month?.fingerprint }).toEqual({
				until,
				total: januaryCents,
				fingerprint: shown?.inputFingerprint,
			});
		}

		const after = january(
			await loadMinijobExceedanceReviews(db, {
				organizationId: s.org.id,
				now,
				includeAcknowledged: true,
			}),
		);
		expect(after).toMatchObject({
			totalCents: januaryCents,
			acknowledgement: { status: "current" },
		});
		expect((await monitorJanuary())?.exceedance?.status).toBe("acknowledged");
		// Scheduling weeks ending in January and running into February.
		for (const window of [
			{ start: "2026-01-26", endExclusive: "2026-02-01" },
			{ start: "2026-01-29", endExclusive: "2026-02-04" },
		]) {
			expect(
				(await scheduling(window)).filter(
					(finding) =>
						finding.subjectKey === "2026-01" && finding.statutoryKind === "minijob_monthly_cap",
				),
			).toEqual([expect.objectContaining({ acknowledgementStatus: "current", severity: "info" })]);
		}
	});

	it.each([
		{ worked: 610, status: ["2026-12", "info", "acknowledged"], note: "a few minutes over" },
		{ worked: 720, status: ["2026-12", "critical", "stale"], note: "two hours over" },
	])("judges a shift worked $note against the acknowledgement", async ({ worked, status }) => {
		const s = await setup();
		for (const date of ["2026-12-01", "2026-12-02", "2026-12-03", "2026-12-04", "2026-12-07"]) {
			await mj.shift(s.org, s.worker, s.owner, { date, startTime: "08:00", endTime: "18:00" });
		}
		for (const date of ["2026-12-08", "2026-12-09"]) {
			await mj.shift(s.org, s.worker, s.owner, { date, startTime: "08:00", endTime: "18:00" });
		}
		await acknowledge(s, "2026-12");

		await mj.work(s.org, s.worker, "2026-12-01", worked);

		expect(
			await monthly(s, "2026-12", "2027-01", Temporal.Instant.from("2026-12-01T20:00:00Z")),
		).toEqual([status]);
	});

	describe("work recorded for a missed or short shift", () => {
		/** 2 December, 13:00 Berlin: the 1 December shift is over. */
		const AFTER_FIRST_SHIFT = Temporal.Instant.from("2026-12-02T12:00:00Z");

		/** 60 planned hours in December at 13 € an hour (780 €), the first an 8-hour shift on the 1st. */
		async function december() {
			const s = await setup(13);
			await mj.shift(s.org, s.worker, s.owner, {
				date: "2026-12-01",
				startTime: "08:00",
				endTime: "16:00",
			});
			for (const date of ["2026-12-02", "2026-12-03", "2026-12-04", "2026-12-07", "2026-12-08"]) {
				await mj.shift(s.org, s.worker, s.owner, { date, startTime: "08:00", endTime: "18:00" });
			}
			await mj.shift(s.org, s.worker, s.owner, {
				date: "2026-12-09",
				startTime: "08:00",
				endTime: "10:00",
			});
			return s;
		}

		async function reviewedDecember(s: Setup, now: Temporal.Instant) {
			const reviews = await loadMinijobExceedanceReviews(db, {
				organizationId: s.org.id,
				now,
				includeAcknowledged: true,
			});
			return reviews.find((review) => review.month === "2026-12");
		}

		/** Documents December as an org admin was shown it in Reviews & Conflicts. */
		function acknowledgeShown(
			s: Setup,
			shown: Awaited<ReturnType<typeof reviewedDecember>>,
			now: Temporal.Instant,
		) {
			return acknowledgeMinijobExceedance(db, {
				organizationId: s.org.id,
				actorUserId: s.owner.userId,
				employeeId: s.worker.employeeId,
				month: "2026-12",
				reason: "Christmas cover agreed after a resignation",
				expectedFingerprint: shown?.inputFingerprint ?? "",
				expectedTotalCents: shown?.totalCents ?? 0,
				now,
			});
		}

		/** Documents December as an org admin shown it at `now`. */
		async function acknowledgeDecember(s: Setup, now: Temporal.Instant) {
			return acknowledgeShown(s, await reviewedDecember(s, now), now);
		}

		/** December's state on every surface: monitor, Reviews & Conflicts and Scheduling. */
		async function decemberEverywhere(s: Setup, now: Temporal.Instant) {
			const [[, severity, status] = []] = await monthly(s, "2026-12", "2027-01", now);
			const view = await loadEmployeeMinijobMonitor(db, {
				organizationId: s.org.id,
				employeeId: s.worker.employeeId,
				audience: "full",
				now,
			});
			const detail =
				view.audience === "full" ? view.months.find((m) => m.month === "2026-12") : undefined;
			const review = await reviewedDecember(s, now);
			const scheduled = (
				await evaluateStatutoryScheduleFindings(
					db,
					{
						organizationId: s.org.id,
						timezone: s.org.timezone,
						window: { start: "2026-12-07", endExclusive: "2026-12-14" },
						employeeIds: [s.worker.employeeId],
						now,
					},
					[minijobScheduleContributor],
				)
			).find((f) => f.subjectKey === "2026-12" && f.statutoryKind === "minijob_monthly_cap");
			return {
				totalCents: detail?.totalCents,
				evaluated: [severity, status],
				monitor: detail?.exceedance?.status,
				reviews: [review?.status, review?.acknowledgement.status],
				scheduling: [scheduled?.severity, scheduled?.acknowledgementStatus],
			};
		}

		const documented = {
			evaluated: ["info", "acknowledged"],
			monitor: "acknowledged",
			reviews: ["acknowledged", "current"],
			scheduling: ["info", "current"],
		};
		const outdated = {
			evaluated: ["critical", "stale"],
			monitor: "stale",
			reviews: ["stale", "stale"],
			scheduling: ["critical", "stale"],
		};

		it("turns the acknowledgement stale when a forgotten entry is added for a lapsed shift", async () => {
			const s = await december();
			// The 1 December shift lapsed unworked: 52 hours, 676 €, documented as such.
			await acknowledgeDecember(s, AFTER_FIRST_SHIFT);
			expect(await decemberEverywhere(s, AFTER_FIRST_SHIFT)).toEqual({
				totalCents: 67_600,
				...documented,
			});

			// A manager adds the forgotten 8 hours: 780 €, more than the admin documented.
			await mj.work(s.org, s.worker, "2026-12-01", 480);
			expect(await decemberEverywhere(s, AFTER_FIRST_SHIFT)).toEqual({
				totalCents: 78_000,
				...outdated,
			});

			// Documenting the new figures makes the month current again.
			await acknowledgeDecember(s, AFTER_FIRST_SHIFT);
			expect(await decemberEverywhere(s, AFTER_FIRST_SHIFT)).toEqual({
				totalCents: 78_000,
				...documented,
			});
		});

		it("refuses to document a total that rose after the admin was shown it", async () => {
			const s = await december();
			// The 1 December shift lapsed unworked: the admin is shown 52 hours, 676 €.
			const shown = await reviewedDecember(s, AFTER_FIRST_SHIFT);
			expect(shown?.totalCents).toBe(67_600);

			// Before they click, a manager adds the forgotten 8 hours: 780 €, same fingerprint.
			await mj.work(s.org, s.worker, "2026-12-01", 480);
			expect((await reviewedDecember(s, AFTER_FIRST_SHIFT))?.inputFingerprint).toBe(
				shown?.inputFingerprint,
			);

			await expect(acknowledgeShown(s, shown, AFTER_FIRST_SHIFT)).rejects.toMatchObject({
				refusal: "minijob_exceedance_changed",
			});
			expect(await decemberEverywhere(s, AFTER_FIRST_SHIFT)).toMatchObject({
				totalCents: 78_000,
				monitor: "unacknowledged",
			});

			// After reloading, the admin documents the 780 € they now see.
			const reloaded = await reviewedDecember(s, AFTER_FIRST_SHIFT);
			const record = await acknowledgeShown(s, reloaded, AFTER_FIRST_SHIFT);
			expect(record.metadata.amountsCents).toMatchObject({ total: 78_000 });
			expect(await decemberEverywhere(s, AFTER_FIRST_SHIFT)).toEqual({
				totalCents: 78_000,
				...documented,
			});
		});

		it("turns the acknowledgement stale when a short work period is corrected upward", async () => {
			const s = await december();
			// Four of the eight hours recorded: 56 hours, 728 €, documented as such.
			const work = await mj.work(s.org, s.worker, "2026-12-01", 240);
			await acknowledgeDecember(s, AFTER_FIRST_SHIFT);
			expect(await decemberEverywhere(s, AFTER_FIRST_SHIFT)).toEqual({
				totalCents: 72_800,
				...documented,
			});

			await mj.closeWork(work, 480);

			expect(await decemberEverywhere(s, AFTER_FIRST_SHIFT)).toEqual({
				totalCents: 78_000,
				...outdated,
			});
		});

		it("keeps the acknowledgement current when the shift is worked as planned", async () => {
			const s = await december();
			await acknowledgeDecember(s, NOW);

			await mj.work(s.org, s.worker, "2026-12-01", 480);

			expect(await decemberEverywhere(s, AFTER_FIRST_SHIFT)).toEqual({
				totalCents: 78_000,
				...documented,
			});
		});

		it("keeps the acknowledgement current when a lapsed shift lowers the total", async () => {
			const s = await december();
			await acknowledgeDecember(s, NOW);

			expect(await decemberEverywhere(s, AFTER_FIRST_SHIFT)).toEqual({
				totalCents: 67_600,
				...documented,
			});
		});
	});
});
