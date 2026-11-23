/**
 * #1993: JArbSchG youth protection in Scheduling (real PostgreSQL): youth findings for under-18
 * shifts and the exact 18th-birthday switch, the optional publish block and its lifting by an
 * acknowledged sector exception, and `executive_exempt` adults without adult ArbZG findings.
 */
import { Effect, Layer } from "effect";
import { Temporal } from "temporal-polyfill";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { type Instant, systemClock } from "@/lib/datetime/temporal-core";
import { DatabaseServiceLive } from "@/lib/effect/services/database.service";
import {
	ScheduleComplianceService,
	ScheduleComplianceServiceLive,
} from "@/lib/effect/services/schedule-compliance.service";
import { ShiftService, ShiftServiceLive } from "@/lib/effect/services/shift.service";
import {
	ShiftRequestService,
	ShiftRequestServiceLive,
} from "@/lib/effect/services/shift-request.service";
import {
	StaffingSuggestionService,
	StaffingSuggestionServiceLive,
} from "@/lib/effect/services/staffing-suggestion.service";
import {
	WorkPolicyService,
	WorkPolicyServiceLive,
} from "@/lib/effect/services/work-policy.service";
import { shiftDateBounds } from "@/lib/scheduling/shift-date";
import { integrationAdminPool } from "@/test/integration-database";
import {
	type FixtureEmployee,
	type FixtureOrganization,
	statutoryFixture,
} from "@/test/statutory-fixtures";
import {
	recordStatutoryAcknowledgement,
	statutoryAcknowledgementSubjectOf,
} from "../acknowledgements";
import { recordApprenticeRelease } from "../employee-context";
import { loadOrganizationStatutoryPreferences } from "../preferences";
import { STATUTORY_PUBLICATION_BLOCKED } from "../scheduling/publication-block";
import { jarbschgScheduleContributor } from "./jarbschg-contributor";
import { localInstant, youthSeed } from "./testing/youth-seed";

const caller = vi.hoisted(() => ({ userId: "", organizationId: "" }));

vi.mock("@/lib/effect/runtime", async () => {
	const { Layer } = await import("effect");
	const { db } = await import("@/db");
	const { ShiftServiceLive } = await import("@/lib/effect/services/shift.service");
	const { CoverageServiceLive } = await import("@/lib/effect/services/coverage.service");
	const { WorkPolicyServiceLive } = await import("@/lib/effect/services/work-policy.service");
	const { organizationActionStubLayer } = await import("@/test/organization-action");
	const boundary = organizationActionStubLayer(
		() => ({
			userId: caller.userId,
			activeOrganizationId: caller.organizationId,
			membershipRole: "owner",
			employee: null,
		}),
		{ db },
	);
	return (await import("@/test/effect-runtime")).runtimeModuleOver(
		Layer.mergeAll(ShiftServiceLive, CoverageServiceLive, WorkPolicyServiceLive).pipe(
			Layer.provideMerge(boundary),
		),
	);
});

const { publishShifts, upsertShift } =
	await import("@/app/[locale]/(app)/scheduling/actions/shift-actions");

const WEEK = { startDate: "2027-03-01", endDateExclusive: "2027-03-08" };

const complianceLayer = ScheduleComplianceServiceLive.pipe(
	Layer.provide(WorkPolicyServiceLive),
	Layer.provide(DatabaseServiceLive),
);

describe("JArbSchG in Scheduling (PostgreSQL)", () => {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
	const admin = integrationAdminPool();
	const fx = statutoryFixture(admin, "t1993sc");
	const seed = youthSeed(admin);
	let org: FixtureOrganization;
	let owner: FixtureEmployee;
	let subareaId: string;

	beforeEach(async () => {
		await fx.cleanup();
		org = await fx.organization("a");
		owner = await fx.employee(org, "owner", { role: "admin" });
		await fx.membership(org, owner, "owner");
		subareaId = await seed.subarea(org, owner);
		caller.userId = owner.userId;
		caller.organizationId = org.id;
	});
	afterAll(fx.cleanup);

	const shift = (who: FixtureEmployee, date: string, startTime: string, endTime: string) =>
		seed.shift(org, who, { subareaId, creatorUserId: owner.userId, date, startTime, endTime });

	const evaluateWeek = () =>
		Effect.runPromise(
			Effect.gen(function* () {
				const service = yield* ScheduleComplianceService;
				return yield* service.evaluateScheduleWindow({
					organizationId: org.id,
					startDate: shiftDateBounds(WEEK.startDate, org.timezone).start,
					endDateExclusive: shiftDateBounds(WEEK.endDateExclusive, org.timezone).start,
					timezone: org.timezone,
				});
			}).pipe(Effect.provide(complianceLayer)),
		);

	async function acknowledgeSectorExceptions(who: FixtureEmployee, week = WEEK) {
		const findings = await jarbschgScheduleContributor.evaluate({
			db,
			organizationId: org.id,
			timezone: org.timezone,
			window: { start: week.startDate, endExclusive: week.endDateExclusive },
			employeeIds: [who.employeeId],
			proposedShifts: [],
			replacesShiftId: null,
			preferences: await loadOrganizationStatutoryPreferences(db, org.id),
			now: systemClock.nowInstant(),
		});
		for (const finding of findings) {
			const subject = statutoryAcknowledgementSubjectOf(finding);
			if (!subject) continue;
			await recordStatutoryAcknowledgement(db, {
				...subject,
				organizationId: org.id,
				actorUserId: owner.userId,
				inputFingerprint: finding.inputFingerprint,
				reason: "Hospitality: § 14 Abs. 2 Nr. 1 JArbSchG allows work until 22:00 at 16+",
			});
		}
		return findings;
	}

	const shiftStatus = async (id: string) =>
		(await admin.query<{ status: string }>("select status from shift where id = $1", [id])).rows[0]
			?.status;

	it("judges under-18 shifts by youth limits and switches to adult rules on the 18th birthday", async () => {
		const turning = await fx.employee(org, "turning", { birthday: "2009-03-03" });
		const minor = await fx.employee(org, "minor", { birthday: "2011-01-01" });
		const tuesday = await shift(turning, "2027-03-02", "17:00", "21:00");
		await shift(turning, "2027-03-03", "17:00", "21:00"); // 18th birthday.
		const sunday = await shift(minor, "2027-03-07", "10:00", "14:00");

		const result = await evaluateWeek();
		const statutory = result.findings.filter((finding) => finding.type === "statutory");
		expect(statutory).toHaveLength(2);
		expect(statutory).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					employeeId: turning.employeeId,
					statutoryKind: "jarbschg_night_work",
					domain: "youth_protection",
					subjectKey: `shift:${tuesday}`,
					legalReference: "§ 14 JArbSchG",
					summary: {
						tier: "exceeded",
						used: { unit: "minutes", value: 60 },
						limit: { unit: "minutes", value: 0 },
					},
					acknowledgementStatus: "none",
					blocksPublication: false,
				}),
				expect.objectContaining({
					employeeId: minor.employeeId,
					statutoryKind: "jarbschg_sunday_work",
					subjectKey: `shift:${sunday}`,
				}),
			]),
		);
		expect(result.summary.byType.statutory).toBe(2);
	});

	it("refuses to publish blocked youth findings until the sector exception is acknowledged", async () => {
		await seed.blockJarbschgPublish(org);
		const minor = await fx.employee(org, "late", { birthday: "2011-01-01" });
		const late = await shift(minor, "2027-03-02", "17:00", "21:00");

		const refused = await publishShifts(WEEK);
		expect(refused).toMatchObject({ success: false, code: "ValidationError" });
		expect(refused.success ? "" : refused.error).toMatch(/youth protection/);
		expect(await shiftStatus(late)).toBe("draft");
		expect((await evaluateWeek()).findings).toContainEqual(
			expect.objectContaining({ statutoryKind: "jarbschg_night_work", blocksPublication: true }),
		);

		await acknowledgeSectorExceptions(minor);
		const handshake = await publishShifts(WEEK);
		if (!handshake.success || handshake.data.published) {
			throw new Error(`expected the compliance handshake, got ${JSON.stringify(handshake)}`);
		}
		expect((await evaluateWeek()).findings).toContainEqual(
			expect.objectContaining({
				statutoryKind: "jarbschg_night_work",
				acknowledgementStatus: "current",
				blocksPublication: false,
			}),
		);
		const published = await publishShifts(WEEK, {
			evaluationFingerprint: handshake.data.evaluationFingerprint,
		});
		expect(published).toMatchObject({ success: true, data: { published: true, count: 1 } });
		expect(await shiftStatus(late)).toBe("published");
	});

	it("publishes another employee's drafts past a minor's already published blocked shift", async () => {
		await seed.blockJarbschgPublish(org);
		const minor = await fx.employee(org, "saturday", { birthday: "2011-01-01" });
		const adult = await fx.employee(org, "weekday", { birthday: "1990-01-01" });
		await seed.shift(org, minor, {
			subareaId,
			creatorUserId: owner.userId,
			date: "2027-03-06",
			startTime: "18:00",
			endTime: "23:00",
			status: "published",
		});
		const draft = await shift(adult, "2027-03-02", "09:00", "17:00");
		expect((await evaluateWeek()).findings).toContainEqual(
			expect.objectContaining({ employeeId: minor.employeeId, blocksPublication: true }),
		);

		const handshake = await publishShifts(WEEK);
		if (!handshake.success) throw new Error(`publish refused: ${handshake.error}`);
		const published = handshake.data.published
			? handshake
			: await publishShifts(WEEK, { evaluationFingerprint: handshake.data.evaluationFingerprint });
		expect(published).toMatchObject({ success: true, data: { published: true, count: 1 } });
		expect(await shiftStatus(draft)).toBe("published");
	});

	it("refuses publishing a draft that newly breaks a limit on a published shift", async () => {
		await seed.blockJarbschgPublish(org);
		const minor = await fx.employee(org, "early", { birthday: "2011-01-01" });
		await seed.shift(org, minor, {
			subareaId,
			creatorUserId: owner.userId,
			date: "2027-03-02",
			startTime: "06:00",
			endTime: "10:00",
			status: "published",
		});
		// Monday until 19:30 leaves 10.5 h of rest before Tuesday 06:00: the breach lies on Tuesday.
		const monday = await shift(minor, "2027-03-01", "15:30", "19:30");
		expect((await evaluateWeek()).findings).toContainEqual(
			expect.objectContaining({ statutoryKind: "jarbschg_rest_period", blocksPublication: true }),
		);
		expect(await publishShifts(WEEK)).toMatchObject({
			success: false,
			refusal: STATUTORY_PUBLICATION_BLOCKED,
		});
		expect(await shiftStatus(monday)).toBe("draft");
	});

	describe("the publication checks the drafts it publishes", () => {
		const publishInService = () =>
			Effect.runPromise(
				Effect.gen(function* () {
					const service = yield* ShiftService;
					return yield* service.publishShifts(
						org.id,
						{
							start: shiftDateBounds(WEEK.startDate, org.timezone).start,
							endExclusive: shiftDateBounds(WEEK.endDateExclusive, org.timezone).start,
						},
						owner.userId,
						{
							timezone: org.timezone,
							window: { start: WEEK.startDate, endExclusive: WEEK.endDateExclusive },
							now: systemClock.nowInstant(),
						},
					);
				}).pipe(
					Effect.provide(ShiftServiceLive.pipe(Layer.provide(DatabaseServiceLive))),
					Effect.result,
				),
			);

		it("refuses a blocked draft saved after the planner's publish check passed", async () => {
			await seed.blockJarbschgPublish(org);
			const minor = await fx.employee(org, "racing", { birthday: "2011-01-01" });
			const adult = await fx.employee(org, "checked", { birthday: "1990-01-01" });
			const checked = await shift(adult, "2027-03-02", "09:00", "17:00");
			// Planner B's night draft for a minor, saved after planner A's check saw a clean week.
			const night = await shift(minor, "2027-03-03", "17:00", "21:00");

			expect(await publishInService()).toMatchObject({
				_tag: "Failure",
				failure: { _tag: "ValidationError", refusal: STATUTORY_PUBLICATION_BLOCKED },
			});
			expect(await shiftStatus(night)).toBe("draft");
			expect(await shiftStatus(checked)).toBe("draft");
		});

		it("publishes the checked drafts when none is blocked", async () => {
			await seed.blockJarbschgPublish(org);
			const minor = await fx.employee(org, "clean", { birthday: "2011-01-01" });
			const day = await shift(minor, "2027-03-02", "09:00", "13:00");

			expect(await publishInService()).toMatchObject({
				_tag: "Success",
				success: { count: 1, affectedEmployeeIds: [minor.employeeId] },
			});
			expect(await shiftStatus(day)).toBe("published");
		});
	});

	describe("publishing drafts next to a breach already published", () => {
		const published = (who: FixtureEmployee, date: string, startTime: string, endTime: string) =>
			seed.shift(org, who, {
				subareaId,
				creatorUserId: owner.userId,
				date,
				startTime,
				endTime,
				status: "published",
			});
		const publishThrough = async (range: typeof WEEK) => {
			const handshake = await publishShifts(range);
			if (!handshake.success || handshake.data.published) return handshake;
			return publishShifts(range, { evaluationFingerprint: handshake.data.evaluationFingerprint });
		};

		async function publishedLongWeek() {
			await seed.blockJarbschgPublish(org);
			const minor = await fx.employee(org, "long-week", { birthday: "2011-01-01" });
			// Published before the block: Tuesday to Friday, 42 h in the week.
			for (const date of ["2027-03-02", "2027-03-03", "2027-03-04"]) {
				await published(minor, date, "07:00", "18:30");
			}
			const friday = await published(minor, "2027-03-05", "07:00", "18:30");
			expect((await evaluateWeek()).findings).toContainEqual(
				expect.objectContaining({
					statutoryKind: "jarbschg_weekly_max",
					subjectKey: `shift:${friday}`,
					blocksPublication: true,
				}),
			);
			return minor;
		}

		it("refuses a draft that deepens the published week past its 40 h", async () => {
			const minor = await publishedLongWeek();
			const monday = await shift(minor, "2027-03-01", "08:00", "12:00");
			expect(await publishThrough(WEEK)).toMatchObject({
				success: false,
				refusal: STATUTORY_PUBLICATION_BLOCKED,
			});
			expect(await shiftStatus(monday)).toBe("draft");
		});

		it("publishes a draft that leaves the published breach as it is", async () => {
			const minor = await publishedLongWeek();
			const nextMonday = await shift(minor, "2027-03-08", "08:00", "12:00");
			expect(
				await publishThrough({ startDate: "2027-03-01", endDateExclusive: "2027-03-15" }),
			).toMatchObject({ success: true, data: { published: true, count: 1 } });
			expect(await shiftStatus(nextMonday)).toBe("published");
		});

		it("refuses a draft that shortens a rest period already too short", async () => {
			await seed.blockJarbschgPublish(org);
			const minor = await fx.employee(org, "short-rest", { birthday: "2011-01-01" });
			// Published before the block: 10.5 h of rest before Tuesday 06:00.
			await published(minor, "2027-03-01", "12:00", "19:30");
			await published(minor, "2027-03-02", "06:00", "10:00");
			const late = await shift(minor, "2027-03-01", "19:35", "19:55");
			expect(await publishThrough(WEEK)).toMatchObject({
				success: false,
				refusal: STATUTORY_PUBLICATION_BLOCKED,
			});
			expect(await shiftStatus(late)).toBe("draft");
		});
	});

	describe("drafts outside the published range", () => {
		const publishThrough = async (range: typeof WEEK) => {
			const handshake = await publishShifts(range);
			if (!handshake.success || handshake.data.published) return handshake;
			return publishShifts(range, { evaluationFingerprint: handshake.data.evaluationFingerprint });
		};

		it("publishes Tuesday although the rest breach it leaves lies on Wednesday's draft", async () => {
			await seed.blockJarbschgPublish(org);
			const minor = await fx.employee(org, "next-draft", { birthday: "2011-01-01" });
			// Tuesday until 19:30 leaves 10.5 h of rest before Wednesday 06:00, a draft not published.
			const tuesday = await shift(minor, "2027-03-02", "15:30", "19:30");
			const wednesday = await shift(minor, "2027-03-03", "06:00", "10:00");

			expect(
				await publishThrough({ startDate: "2027-03-01", endDateExclusive: "2027-03-03" }),
			).toMatchObject({ success: true, data: { published: true, count: 1 } });
			expect(await shiftStatus(tuesday)).toBe("published");
			expect(await shiftStatus(wednesday)).toBe("draft");
		});

		async function longWeek(friday: "draft" | "published") {
			await seed.blockJarbschgPublish(org);
			const minor = await fx.employee(org, `straddle-${friday}`, { birthday: "2011-01-01" });
			// 07:00–16:00 is 8 h of work after the 60 min break; Friday 07:00–16:30 is 8.5 h: 40.5 h.
			const inRange: string[] = [];
			for (const date of ["2027-03-01", "2027-03-02", "2027-03-03"]) {
				inRange.push(await shift(minor, date, "07:00", "16:00"));
			}
			await shift(minor, "2027-03-04", "07:00", "16:00");
			await seed.shift(org, minor, {
				subareaId,
				creatorUserId: owner.userId,
				date: "2027-03-05",
				startTime: "07:00",
				endTime: "16:30",
				status: friday,
			});
			return inRange;
		}

		it("publishes Monday to Wednesday although Friday's draft goes past 40 h", async () => {
			const inRange = await longWeek("draft");
			expect(
				await publishThrough({ startDate: "2027-03-01", endDateExclusive: "2027-03-04" }),
			).toMatchObject({ success: true, data: { published: true, count: 3 } });
			for (const id of inRange) expect(await shiftStatus(id)).toBe("published");
		});

		it("refuses Monday to Wednesday when they push a published Friday past 40 h", async () => {
			const inRange = await longWeek("published");
			expect(
				await publishThrough({ startDate: "2027-03-01", endDateExclusive: "2027-03-04" }),
			).toMatchObject({ success: false, refusal: STATUTORY_PUBLICATION_BLOCKED });
			for (const id of inRange) expect(await shiftStatus(id)).toBe("draft");
		});
	});

	it("keeps hard limits blocking: a sector exception cannot lift a too-long day", async () => {
		await seed.blockJarbschgPublish(org);
		const minor = await fx.employee(org, "long", { birthday: "2011-01-01" });
		await shift(minor, "2027-03-02", "07:00", "18:00");
		await acknowledgeSectorExceptions(minor);
		expect(await publishShifts(WEEK)).toMatchObject({ success: false, code: "ValidationError" });
	});

	describe("public holidays (§ 18 JArbSchG)", () => {
		const evaluateRange = (week: typeof WEEK) =>
			Effect.runPromise(
				Effect.gen(function* () {
					const service = yield* ScheduleComplianceService;
					return yield* service.evaluateScheduleWindow({
						organizationId: org.id,
						startDate: shiftDateBounds(week.startDate, org.timezone).start,
						endDateExclusive: shiftDateBounds(week.endDateExclusive, org.timezone).start,
						timezone: org.timezone,
					});
				}).pipe(Effect.provide(complianceLayer)),
			);

		it.each([
			{
				name: "25 December",
				date: "2026-12-25",
				times: ["09:00", "13:00"],
				holiday: true,
				week: { startDate: "2026-12-21", endDateExclusive: "2026-12-28" },
			},
			{
				name: "24 December after 14:00",
				date: "2026-12-24",
				times: ["11:00", "15:00"],
				holiday: false,
				week: { startDate: "2026-12-21", endDateExclusive: "2026-12-28" },
			},
			{
				name: "1 May",
				date: "2027-05-01",
				times: ["09:00", "13:00"],
				holiday: true,
				week: { startDate: "2027-04-26", endDateExclusive: "2027-05-03" },
			},
		])("never lets a minor's shift on $name be acknowledged or published", async (scenario) => {
			await seed.blockJarbschgPublish(org);
			if (scenario.holiday) await seed.publicHoliday(org, owner, scenario.date);
			const minor = await fx.employee(org, "holiday", { birthday: "2011-01-01" });
			const id = await shift(minor, scenario.date, scenario.times[0], scenario.times[1]);

			expect((await evaluateRange(scenario.week)).findings).toContainEqual(
				expect.objectContaining({
					statutoryKind: "jarbschg_holiday_prohibited",
					subjectKey: `shift:${id}`,
					legalReference: "§ 18 Abs. 1, 2 JArbSchG",
					blocksPublication: true,
				}),
			);
			const findings = await acknowledgeSectorExceptions(minor, scenario.week);
			const prohibited = findings.find((finding) => finding.kind === "jarbschg_holiday_prohibited");
			expect(prohibited).toBeDefined();
			expect(statutoryAcknowledgementSubjectOf(prohibited as (typeof findings)[number])).toBeNull();

			expect(await publishShifts(scenario.week)).toMatchObject({
				success: false,
				refusal: STATUTORY_PUBLICATION_BLOCKED,
			});
			expect(await shiftStatus(id)).toBe("draft");
		});

		it("keeps an ordinary public holiday acknowledgeable as a sector exception", async () => {
			await seed.blockJarbschgPublish(org);
			const week = { startDate: "2027-03-29", endDateExclusive: "2027-04-05" };
			await seed.publicHoliday(org, owner, "2027-03-29"); // Easter Monday.
			const minor = await fx.employee(org, "easter", { birthday: "2011-01-01" });
			const id = await shift(minor, "2027-03-29", "09:00", "13:00");
			expect((await evaluateRange(week)).findings).toContainEqual(
				expect.objectContaining({
					statutoryKind: "jarbschg_holiday_work",
					blocksPublication: true,
				}),
			);

			await acknowledgeSectorExceptions(minor, week);
			const handshake = await publishShifts(week);
			if (!handshake.success) throw new Error(`publish refused: ${handshake.error}`);
			const published = handshake.data.published
				? handshake
				: await publishShifts(week, {
						evaluationFingerprint: handshake.data.evaluationFingerprint,
					});
			expect(published).toMatchObject({ success: true, data: { published: true, count: 1 } });
			expect(await shiftStatus(id)).toBe("published");
		});
	});

	describe("editing a published shift runs the publish block", () => {
		const published = (who: FixtureEmployee, date: string, startTime: string, endTime: string) =>
			seed.shift(org, who, {
				subareaId,
				creatorUserId: owner.userId,
				date,
				startTime,
				endTime,
				status: "published",
			});
		const shiftRow = async (id: string) =>
			(
				await admin.query<{
					employee_id: string;
					start_time: string;
					end_time: string;
					notes: string | null;
				}>("select employee_id, start_time, end_time, notes from shift where id = $1", [id])
			).rows[0];

		it("refuses moving a published shift to Saturday night for a minor", async () => {
			await seed.blockJarbschgPublish(org);
			const minor = await fx.employee(org, "moved", { birthday: "2011-01-01" });
			const id = await published(minor, "2027-03-02", "10:00", "14:00");

			const refused = await upsertShift({
				id,
				employeeId: minor.employeeId,
				subareaId,
				date: "2027-03-06",
				startTime: "21:00",
				endTime: "01:00",
			});
			expect(refused).toMatchObject({
				success: false,
				code: "ValidationError",
				refusal: STATUTORY_PUBLICATION_BLOCKED,
			});
			expect((await shiftRow(id))?.start_time).toBe("10:00");
		});

		it("refuses reassigning a published shift to a 16-year-old it puts in breach", async () => {
			await seed.blockJarbschgPublish(org);
			const adult = await fx.employee(org, "adult", { birthday: "1990-01-01" });
			const minor = await fx.employee(org, "sixteen", { birthday: "2010-06-01" });
			const id = await published(adult, "2027-03-02", "07:00", "18:00");

			expect(
				await upsertShift({
					id,
					employeeId: minor.employeeId,
					subareaId,
					date: "2027-03-02",
					startTime: "07:00",
					endTime: "18:00",
				}),
			).toMatchObject({ success: false, refusal: STATUTORY_PUBLICATION_BLOCKED });
			expect((await shiftRow(id))?.employee_id).toBe(adult.employeeId);
		});

		it("refuses approving a pickup that gives a published Saturday evening shift to a 16-year-old", async () => {
			await seed.blockJarbschgPublish(org);
			const minor = await fx.employee(org, "pickup", { birthday: "2010-06-01" });
			const id = await published(owner, "2027-03-06", "18:00", "23:00");
			await admin.query("update shift set employee_id = null where id = $1", [id]);
			const requests = (
				run: (service: ShiftRequestService["Service"]) => Effect.Effect<unknown, unknown>,
			) =>
				Effect.runPromise(
					Effect.gen(function* () {
						return yield* run(yield* ShiftRequestService);
					}).pipe(
						Effect.provide(ShiftRequestServiceLive.pipe(Layer.provide(DatabaseServiceLive))),
						Effect.result,
					),
				);
			const requested = await requests((service) =>
				service.requestPickup(org.id, { shiftId: id, requesterId: minor.employeeId }),
			);
			if (requested._tag !== "Success") throw new Error(JSON.stringify(requested));
			const requestId = (requested.success as { id: string }).id;

			try {
				const approved = await requests((service) =>
					service.approveRequest(org.id, requestId, owner.employeeId),
				);
				expect(approved).toMatchObject({
					_tag: "Failure",
					failure: { _tag: "ValidationError", refusal: STATUTORY_PUBLICATION_BLOCKED },
				});
				expect((await shiftRow(id))?.employee_id).toBeNull();
			} finally {
				// The fixture cleanup does not know shift requests.
				await admin.query("delete from shift_request where shift_id = $1", [id]);
			}
		});

		it("lets a planner edit a published shift already in breach unless the edit deepens it", async () => {
			await seed.blockJarbschgPublish(org);
			const minor = await fx.employee(org, "weekly", { birthday: "2010-06-01" });
			// 08:00–17:00 is 8 h of work after the 60 min break.
			const monday = await published(minor, "2027-03-01", "08:00", "17:00");
			await published(minor, "2027-03-02", "08:00", "17:00");
			await published(minor, "2027-03-03", "08:00", "17:00");
			await shift(minor, "2027-03-04", "07:00", "18:00"); // A 10 h draft: 42 h in the week.
			const friday = await published(minor, "2027-03-05", "08:00", "17:00");
			expect((await evaluateWeek()).findings).toContainEqual(
				expect.objectContaining({
					statutoryKind: "jarbschg_weekly_max",
					subjectKey: `shift:${friday}`,
					blocksPublication: true,
				}),
			);
			const editFriday = (startTime: string, endTime: string, extra: object = {}) =>
				upsertShift({
					id: friday,
					employeeId: minor.employeeId,
					subareaId,
					date: "2027-03-05",
					startTime,
					endTime,
					...extra,
				});

			expect(
				await editFriday("08:00", "17:00", { notes: "Stocktake", color: "#ff8800" }),
			).toMatchObject({ success: true });
			expect((await shiftRow(friday))?.notes).toBe("Stocktake");

			// One hour shorter: 41 h, still over 40 h but no deeper.
			expect(await editFriday("08:00", "16:00")).toMatchObject({ success: true });
			expect((await shiftRow(friday))?.end_time).toBe("16:00");

			// Back to 8 h: 42 h deepens the breach.
			expect(await editFriday("08:00", "17:00")).toMatchObject({
				success: false,
				refusal: STATUTORY_PUBLICATION_BLOCKED,
			});
			expect((await shiftRow(friday))?.end_time).toBe("16:00");

			// A clean published Monday edited into a 10 h day is a new breach.
			expect(
				await upsertShift({
					id: monday,
					employeeId: minor.employeeId,
					subareaId,
					date: "2027-03-01",
					startTime: "07:00",
					endTime: "18:00",
				}),
			).toMatchObject({ success: false, refusal: STATUTORY_PUBLICATION_BLOCKED });
			expect((await shiftRow(monday))?.start_time).toBe("08:00");
		});

		describe("moving a published shift to another day", () => {
			let minor: FixtureEmployee;
			let tuesday: string;
			const moveToWednesday = (startTime: string, endTime: string) =>
				upsertShift({
					id: tuesday,
					employeeId: minor.employeeId,
					subareaId,
					date: "2027-03-03",
					startTime,
					endTime,
				});

			beforeEach(async () => {
				await seed.blockJarbschgPublish(org);
				minor = await fx.employee(org, "mover", { birthday: "2011-01-01" });
				// Published before the block: 07:00–18:00 is 10 h of work after the 60 min break.
				tuesday = await published(minor, "2027-03-02", "07:00", "18:00");
				expect((await evaluateWeek()).findings).toContainEqual(
					expect.objectContaining({
						statutoryKind: "jarbschg_daily_max",
						subjectKey: `shift:${tuesday}`,
						blocksPublication: true,
					}),
				);
			});

			it("refuses moving the breach to Wednesday even at 9 h: Wednesday had none", async () => {
				expect(await moveToWednesday("07:00", "17:00")).toMatchObject({
					success: false,
					refusal: STATUTORY_PUBLICATION_BLOCKED,
				});
				expect((await shiftRow(tuesday))?.end_time).toBe("18:00");
			});

			it("saves shortening it to 9 h on Tuesday", async () => {
				expect(
					await upsertShift({
						id: tuesday,
						employeeId: minor.employeeId,
						subareaId,
						date: "2027-03-02",
						startTime: "07:00",
						endTime: "17:00",
					}),
				).toMatchObject({ success: true });
				expect((await shiftRow(tuesday))?.end_time).toBe("17:00");
			});

			it("refuses moving it to Wednesday at 11 h, deeper past the daily maximum", async () => {
				expect(await moveToWednesday("07:00", "19:00")).toMatchObject({
					success: false,
					refusal: STATUTORY_PUBLICATION_BLOCKED,
				});
				expect((await shiftRow(tuesday))?.end_time).toBe("18:00");
			});

			it("refuses moving a clean published shift onto a day where it breaks the daily maximum", async () => {
				const clean = await published(minor, "2027-03-04", "09:00", "13:00");
				expect(
					await upsertShift({
						id: clean,
						employeeId: minor.employeeId,
						subareaId,
						date: "2027-03-05",
						startTime: "07:00",
						endTime: "18:00",
					}),
				).toMatchObject({ success: false, refusal: STATUTORY_PUBLICATION_BLOCKED });
				expect((await shiftRow(clean))?.start_time).toBe("09:00");
			});
		});

		describe("a published breach carried to another day or week is a new breach there", () => {
			const findingOn = async (kind: string, shiftId: string) =>
				expect((await evaluateWeek()).findings).toContainEqual(
					expect.objectContaining({
						statutoryKind: kind,
						subjectKey: `shift:${shiftId}`,
						blocksPublication: true,
					}),
				);
			const move = (
				who: FixtureEmployee,
				id: string,
				date: string,
				startTime: string,
				endTime: string,
			) => upsertShift({ id, employeeId: who.employeeId, subareaId, date, startTime, endTime });
			const refused = { success: false, refusal: STATUTORY_PUBLICATION_BLOCKED };

			it("refuses moving a sixth day into the next week, also five days long", async () => {
				await seed.blockJarbschgPublish(org);
				const minor = await fx.employee(org, "sixth-day", { birthday: "2011-01-01" });
				// Published before the block: Monday to Saturday of week 1, Monday to Friday of week 2.
				for (const date of ["2027-03-01", "2027-03-02", "2027-03-03", "2027-03-04", "2027-03-05"]) {
					await published(minor, date, "09:00", "13:00");
				}
				const saturday = await published(minor, "2027-03-06", "09:00", "13:00");
				for (const date of ["2027-03-08", "2027-03-09", "2027-03-10", "2027-03-11", "2027-03-12"]) {
					await published(minor, date, "09:00", "13:00");
				}
				await findingOn("jarbschg_days_per_week", saturday);

				expect(await move(minor, saturday, "2027-03-13", "09:00", "13:00")).toMatchObject(refused);
			});

			it("refuses moving the shift past 40 h into the next week at the same 40.5 h", async () => {
				await seed.blockJarbschgPublish(org);
				const minor = await fx.employee(org, "next-week", { birthday: "2011-01-01" });
				// 07:00–16:00 is 8 h of work after the 60 min break; Friday 07:00–16:30 is 8.5 h.
				for (const date of ["2027-03-01", "2027-03-02", "2027-03-03", "2027-03-04"]) {
					await published(minor, date, "07:00", "16:00");
				}
				const friday = await published(minor, "2027-03-05", "07:00", "16:30");
				for (const date of ["2027-03-08", "2027-03-09", "2027-03-10", "2027-03-11"]) {
					await published(minor, date, "07:00", "16:00");
				}
				await findingOn("jarbschg_weekly_max", friday);

				expect(await move(minor, friday, "2027-03-12", "07:00", "16:30")).toMatchObject(refused);
			});

			it("refuses moving a shift with an 11 h rest to Thursday after an equally late Wednesday", async () => {
				await seed.blockJarbschgPublish(org);
				const minor = await fx.employee(org, "rest-move", { birthday: "2011-01-01" });
				// Published before the block: Monday until 19:00 leaves 11 h before Tuesday 06:00.
				await published(minor, "2027-03-01", "12:00", "19:00");
				const tuesday = await published(minor, "2027-03-02", "06:00", "10:00");
				await published(minor, "2027-03-03", "12:00", "19:00");
				await findingOn("jarbschg_rest_period", tuesday);

				expect(await move(minor, tuesday, "2027-03-04", "06:00", "10:00")).toMatchObject(refused);
				expect((await shiftRow(tuesday))?.start_time).toBe("06:00");
			});

			it("refuses moving a shift that conflicts with one exam onto another exam", async () => {
				await seed.blockJarbschgPublish(org);
				const learner = await apprentice("two-exams");
				for (const date of ["2027-03-02", "2027-03-04"]) {
					await release(learner, {
						releaseKind: "exam_day",
						startsOn: date,
						endsOn: date,
						examStartTime: "09:00",
						schoolMinutes: 120,
					});
				}
				// Published before the block, during Tuesday's exam.
				const tuesday = await published(learner, "2027-03-02", "10:00", "12:00");
				await findingOn("bbig_release_day_shift", tuesday);

				expect(await move(learner, tuesday, "2027-03-04", "10:00", "12:00")).toMatchObject(refused);
			});
		});

		it("refuses lengthening a minor's published 24 December shift further past 14:00", async () => {
			await seed.blockJarbschgPublish(org);
			const minor = await fx.employee(org, "eve", { birthday: "2011-01-01" });
			// Published before the block: one hour after 14:00 on Christmas Eve.
			const eve = await published(minor, "2026-12-24", "10:00", "15:00");
			const editEve = (endTime: string) =>
				upsertShift({
					id: eve,
					employeeId: minor.employeeId,
					subareaId,
					date: "2026-12-24",
					startTime: "10:00",
					endTime,
				});

			expect(await editEve("19:00")).toMatchObject({
				success: false,
				refusal: STATUTORY_PUBLICATION_BLOCKED,
			});
			expect((await shiftRow(eve))?.end_time).toBe("15:00");

			expect(await editEve("14:30")).toMatchObject({ success: true });
			expect((await shiftRow(eve))?.end_time).toBe("14:30");
		});

		describe("a rest period already too short", () => {
			let minor: FixtureEmployee;
			let monday: string;
			let tuesday: string;
			const editMonday = (endTime: string) =>
				upsertShift({
					id: monday,
					employeeId: minor.employeeId,
					subareaId,
					date: "2027-03-01",
					startTime: "12:00",
					endTime,
				});

			beforeEach(async () => {
				await seed.blockJarbschgPublish(org);
				minor = await fx.employee(org, "rest", { birthday: "2011-01-01" });
				// Published before the block: 10.5 h of rest before Tuesday 06:00.
				monday = await published(minor, "2027-03-01", "12:00", "19:30");
				tuesday = await published(minor, "2027-03-02", "06:00", "10:00");
				expect((await evaluateWeek()).findings).toContainEqual(
					expect.objectContaining({
						statutoryKind: "jarbschg_rest_period",
						subjectKey: `shift:${tuesday}`,
						summary: expect.objectContaining({ used: { unit: "minutes", value: 630 } }),
						blocksPublication: true,
					}),
				);
			});

			it("refuses a Monday edit that shortens the rest before Tuesday's published shift", async () => {
				expect(await editMonday("19:55")).toMatchObject({
					success: false,
					refusal: STATUTORY_PUBLICATION_BLOCKED,
				});
				expect((await shiftRow(monday))?.end_time).toBe("19:30");
			});

			it("saves a Monday edit that lengthens the rest", async () => {
				expect(await editMonday("19:00")).toMatchObject({ success: true });
				expect((await shiftRow(monday))?.end_time).toBe("19:00");
			});

			it("refuses moving the breaching shift itself closer to the previous evening", async () => {
				await admin.query("update shift set start_time = '06:30' where id = $1", [tuesday]);
				expect(
					await upsertShift({
						id: tuesday,
						employeeId: minor.employeeId,
						subareaId,
						date: "2027-03-02",
						startTime: "06:15",
						endTime: "10:00",
					}),
				).toMatchObject({ success: false, refusal: STATUTORY_PUBLICATION_BLOCKED });
				expect((await shiftRow(tuesday))?.start_time).toBe("06:30");
			});
		});

		describe("a breach that moves to another published shift of the day", () => {
			let minor: FixtureEmployee;
			const edit = (id: string, date: string, startTime: string, endTime: string) =>
				upsertShift({ id, employeeId: minor.employeeId, subareaId, date, startTime, endTime });

			describe("the rest before the day's first shift", () => {
				let early: string;

				beforeEach(async () => {
					await seed.blockJarbschgPublish(org);
					minor = await fx.employee(org, "first-shift", { birthday: "2011-01-01" });
					// Published before the block: Monday until 19:00 leaves 11 h before Tuesday 06:00.
					await published(minor, "2027-03-01", "12:00", "19:00");
					early = await published(minor, "2027-03-02", "06:00", "06:30");
					const later = await published(minor, "2027-03-02", "06:45", "11:00");
					expect((await evaluateWeek()).findings).toContainEqual(
						expect.objectContaining({
							statutoryKind: "jarbschg_rest_period",
							subjectKey: `shift:${early}`,
							summary: expect.objectContaining({ used: { unit: "minutes", value: 660 } }),
							blocksPublication: true,
						}),
					);
					expect(later).toBeTruthy();
				});

				it("saves moving the first shift to the afternoon: the next one rests 11.75 h", async () => {
					expect(await edit(early, "2027-03-02", "13:00", "13:30")).toMatchObject({
						success: true,
					});
					expect((await shiftRow(early))?.start_time).toBe("13:00");
				});

				it("refuses moving it to Monday evening: the next one rests only 10.75 h", async () => {
					expect(await edit(early, "2027-03-01", "19:30", "20:00")).toMatchObject({
						success: false,
						refusal: STATUTORY_PUBLICATION_BLOCKED,
					});
					expect((await shiftRow(early))?.start_time).toBe("06:00");
				});
			});

			describe("the daily maximum past the running cap", () => {
				let morning: string;

				beforeEach(async () => {
					await seed.blockJarbschgPublish(org);
					minor = await fx.employee(org, "reordered", { birthday: "2011-01-01" });
					// Published before the block: 4 h, then 10:00–15:30 is 5 h after the 30 min break.
					morning = await published(minor, "2027-03-02", "06:00", "10:00");
					const afternoon = await published(minor, "2027-03-02", "10:00", "15:30");
					expect((await evaluateWeek()).findings).toContainEqual(
						expect.objectContaining({
							statutoryKind: "jarbschg_daily_max",
							subjectKey: `shift:${afternoon}`,
							summary: expect.objectContaining({ used: { unit: "minutes", value: 540 } }),
							blocksPublication: true,
						}),
					);
				});

				it("saves moving the morning shift after the other at the same 9 h", async () => {
					expect(await edit(morning, "2027-03-02", "16:00", "20:00")).toMatchObject({
						success: true,
					});
					expect((await shiftRow(morning))?.start_time).toBe("16:00");
				});

				it("refuses moving it after the other when that makes the day longer", async () => {
					expect(await edit(morning, "2027-03-02", "15:30", "20:00")).toMatchObject({
						success: false,
						refusal: STATUTORY_PUBLICATION_BLOCKED,
					});
					expect((await shiftRow(morning))?.start_time).toBe("06:00");
				});
			});
		});

		it("saves a published shift whose sector exception is current, and drafts as before", async () => {
			await seed.blockJarbschgPublish(org);
			const minor = await fx.employee(org, "weekend", { birthday: "2011-01-01" });
			const saturday = await published(minor, "2027-03-06", "10:00", "14:00");
			await acknowledgeSectorExceptions(minor);

			expect(
				await upsertShift({
					id: saturday,
					employeeId: minor.employeeId,
					subareaId,
					date: "2027-03-06",
					startTime: "10:00",
					endTime: "14:00",
					notes: "Inventory",
				}),
			).toMatchObject({ success: true });
			expect((await shiftRow(saturday))?.notes).toBe("Inventory");

			const draft = await shift(minor, "2027-03-02", "10:00", "14:00");
			expect(
				await upsertShift({
					id: draft,
					employeeId: minor.employeeId,
					subareaId,
					date: "2027-03-07",
					startTime: "21:00",
					endTime: "01:00",
				}),
			).toMatchObject({ success: true });
		});
	});

	it("only asks for acknowledgement when the organization does not block youth findings", async () => {
		const minor = await fx.employee(org, "free", { birthday: "2011-01-01" });
		const late = await shift(minor, "2027-03-02", "17:00", "21:00");
		const result = await publishShifts(WEEK);
		expect(result).toMatchObject({
			success: true,
			data: { published: false, requiresAcknowledgment: true },
		});
		expect(await shiftStatus(late)).toBe("draft");
	});

	async function apprentice(key: string) {
		const who = await fx.employee(org, key, { birthday: "2011-01-01" });
		await seed.terms(who, {
			from: "2026-01-01",
			createdBy: owner.userId,
			employmentProfile: "apprentice",
		});
		return who;
	}

	const release = (
		who: FixtureEmployee,
		input: Omit<
			Parameters<typeof recordApprenticeRelease>[1],
			"organizationId" | "employeeId" | "actorUserId"
		>,
	) =>
		recordApprenticeRelease(db, {
			organizationId: org.id,
			employeeId: who.employeeId,
			actorUserId: owner.userId,
			...input,
		});

	it("counts a full school day as an 8 h working day toward the week and the five-day week", async () => {
		const learner = await apprentice("schoolday");
		await release(learner, {
			releaseKind: "vocational_school_day",
			startsOn: "2027-03-02",
			endsOn: "2027-03-02",
			lessonCount: 6,
		});
		let saturday = "";
		for (const date of ["2027-03-01", "2027-03-03", "2027-03-04", "2027-03-05", "2027-03-06"]) {
			saturday = await shift(learner, date, "08:00", "17:00"); // 8 h of work each.
		}

		const { findings } = await evaluateWeek();
		const onSaturday = findings.flatMap((finding) =>
			finding.type === "statutory" && finding.subjectKey === `shift:${saturday}`
				? [finding.statutoryKind]
				: [],
		);
		expect(onSaturday).toEqual(
			expect.arrayContaining(["jarbschg_weekly_max", "jarbschg_days_per_week"]),
		);
	});

	describe("Staffing sees what a proposal breaks on neighbouring days", () => {
		const staffingLayer = StaffingSuggestionServiceLive.pipe(
			Layer.provide(
				Layer.succeed(WorkPolicyService, {
					getEffectivePolicyAt: () => Effect.succeed(null),
				} as never),
			),
			Layer.provide(DatabaseServiceLive),
		);
		const youthWarnings = (
			who: FixtureEmployee,
			date: string,
			startTime: string,
			endTime: string,
		) =>
			Effect.runPromise(
				Effect.gen(function* () {
					const service = yield* StaffingSuggestionService;
					const suggestions = yield* service.suggestForShift({
						organizationId: org.id,
						timezone: org.timezone,
						candidates: [{ employeeId: who.employeeId, displayName: "Minor", isActive: true }],
						shift: { subareaId, date, startTime, endTime },
					});
					return (suggestions[0]?.warnings ?? []).flatMap((warning) =>
						warning.type === "compliance" && warning.finding.type === "statutory"
							? [warning.finding.statutoryKind]
							: [],
					);
				}).pipe(Effect.provide(staffingLayer)),
			);

		it("warns about the rest period a Monday evening shift cuts short before Tuesday 06:00", async () => {
			const minor = await fx.employee(org, "early", { birthday: "2011-01-01" });
			await shift(minor, "2027-03-02", "06:00", "12:00");
			expect(await youthWarnings(minor, "2027-03-01", "14:00", "20:00")).toContain(
				"jarbschg_rest_period",
			);
		});

		it("warns when a Monday proposal cuts a rest before Tuesday that is already too short", async () => {
			const minor = await fx.employee(org, "short", { birthday: "2011-01-01" });
			// 10.5 h of rest before Tuesday 06:00: already under the 12 h floor.
			await shift(minor, "2027-03-01", "12:00", "19:30");
			await shift(minor, "2027-03-02", "06:00", "10:00");
			// Ending at 19:55 leaves 10 h 05 min: the breach deepens below its floor.
			expect(await youthWarnings(minor, "2027-03-01", "19:40", "19:55")).toContain(
				"jarbschg_rest_period",
			);
			// A Monday morning proposal leaves the rest as it is.
			expect(await youthWarnings(minor, "2027-03-01", "08:00", "09:00")).not.toContain(
				"jarbschg_rest_period",
			);
		});

		it("counts a block-release week as 40 h: an extra Saturday shift breaks the week", async () => {
			const learner = await apprentice("blockweek");
			await release(learner, {
				releaseKind: "vocational_school_block_week",
				startsOn: "2027-03-01",
				endsOn: "2027-03-05",
				schoolMinutes: 1800,
			});
			expect(await youthWarnings(learner, "2027-03-06", "10:00", "12:00")).toContain(
				"jarbschg_weekly_max",
			);
		});

		it("warns about the weekly maximum and sixth day a Monday shift causes later in the week", async () => {
			const minor = await fx.employee(org, "busy", { birthday: "2011-01-01" });
			for (const date of ["2027-03-02", "2027-03-03", "2027-03-04", "2027-03-05", "2027-03-06"]) {
				await shift(minor, date, "08:00", "16:12"); // 7.2 h of work each: 36 h over five days.
			}
			const warnings = await youthWarnings(minor, "2027-03-01", "07:00", "17:00");
			expect(warnings).toEqual(
				expect.arrayContaining(["jarbschg_weekly_max", "jarbschg_days_per_week"]),
			);
		});
	});

	describe("work in progress", () => {
		const evaluateAt = async (who: FixtureEmployee, now: Instant) =>
			jarbschgScheduleContributor.evaluate({
				db,
				organizationId: org.id,
				timezone: org.timezone,
				window: { start: WEEK.startDate, endExclusive: WEEK.endDateExclusive },
				employeeIds: [who.employeeId],
				proposedShifts: [],
				replacesShiftId: null,
				preferences: await loadOrganizationStatutoryPreferences(db, org.id),
				now,
			});

		it("counts today's completed work together with today's later shift", async () => {
			const minor = await fx.employee(org, "today", { birthday: "2011-01-01" });
			await seed.work(org, minor, "2027-03-01", "08:00", 240);
			const afternoon = await shift(minor, "2027-03-01", "13:00", "19:00");
			const findings = await evaluateAt(minor, localInstant("2027-03-01", "12:30", org.timezone));
			expect(findings).toContainEqual(
				expect.objectContaining({ kind: "jarbschg_daily_max", subjectKey: `shift:${afternoon}` }),
			);
		});

		it("keeps the planned day and the publish fingerprint through a lunch break", async () => {
			const minor = await fx.employee(org, "lunch", { birthday: "2011-01-01" });
			// Monday to Friday 08:00–17:00: 8 h of work and the 60 min break each day.
			for (const date of ["2027-03-01", "2027-03-02", "2027-03-03", "2027-03-04", "2027-03-05"]) {
				await shift(minor, date, "08:00", "17:00");
			}
			// Clocked out at 12:00 for lunch on Monday.
			await seed.work(org, minor, "2027-03-01", "08:00", 240);

			const evaluateWeekAt = async (time: string) => {
				// The service judges at the system clock.
				const clock = vi
					.spyOn(Temporal.Now, "instant")
					.mockReturnValue(localInstant("2027-03-01", time, org.timezone));
				try {
					return await evaluateWeek();
				} finally {
					clock.mockRestore();
				}
			};
			const youthKinds = (result: Awaited<ReturnType<typeof evaluateWeek>>) =>
				result.findings.flatMap((finding) =>
					finding.type === "statutory" && finding.statutoryKind.startsWith("jarbschg_")
						? [finding.statutoryKind]
						: [],
				);

			const atNoon = await evaluateWeekAt("12:00");
			for (const time of ["12:15", "12:29"]) {
				const later = await evaluateWeekAt(time);
				expect(youthKinds(later)).toEqual([]);
				expect(later.fingerprint).toBe(atNoon.fingerprint);
			}
			expect(youthKinds(atNoon)).toEqual([]);
		});

		it("keeps the day, the fingerprint and Friday publishable once clocked back in after lunch", async () => {
			await seed.blockJarbschgPublish(org);
			const minor = await fx.employee(org, "backin", { birthday: "2011-01-01" });
			// Monday to Thursday published 08:00–17:00, Friday's shift still a draft.
			for (const date of ["2027-03-01", "2027-03-02", "2027-03-03", "2027-03-04"]) {
				await seed.shift(org, minor, {
					subareaId,
					creatorUserId: owner.userId,
					date,
					startTime: "08:00",
					endTime: "17:00",
					status: "published",
				});
			}
			const friday = await shift(minor, "2027-03-05", "08:00", "17:00");
			// 08:00–12:00 worked, 30 min break, clocked in again at 12:30:42.
			await seed.work(org, minor, "2027-03-01", "08:00", 240);
			await seed.openWork(org, minor, "2027-03-01", "12:30:42");

			const atMonday = async <T>(time: string, run: () => Promise<T>) => {
				const clock = vi
					.spyOn(Temporal.Now, "instant")
					.mockReturnValue(localInstant("2027-03-01", time, org.timezone));
				try {
					return await run();
				} finally {
					clock.mockRestore();
				}
			};
			const youthFindings = (result: Awaited<ReturnType<typeof evaluateWeek>>) =>
				result.findings.filter(
					(finding) =>
						finding.type === "statutory" && finding.statutoryKind.startsWith("jarbschg_"),
				);

			const first = await atMonday("12:31", evaluateWeek);
			expect(youthFindings(first)).toEqual([]);
			for (const time of ["12:31:30", "14:00:17", "16:59:59"]) {
				const later = await atMonday(time, evaluateWeek);
				expect(youthFindings(later)).toEqual([]);
				expect(later.fingerprint).toBe(first.fingerprint);
			}

			const published = await atMonday("14:00", async () => {
				const handshake = await publishShifts(WEEK);
				if (!handshake.success) throw new Error(`publish refused: ${handshake.error}`);
				return handshake.data.published
					? handshake
					: publishShifts(WEEK, { evaluationFingerprint: handshake.data.evaluationFingerprint });
			});
			expect(published).toMatchObject({ success: true, data: { published: true, count: 1 } });
			expect(await shiftStatus(friday)).toBe("published");
		});

		it("still flags a lunch break after a day started two hours early", async () => {
			const minor = await fx.employee(org, "early", { birthday: "2011-01-01" });
			await shift(minor, "2027-03-01", "08:00", "17:00");
			// 6 h worked by 12:00, and 4 h of the shift still to come after the break.
			await seed.work(org, minor, "2027-03-01", "06:00", 360);
			const findings = await evaluateAt(minor, localInstant("2027-03-01", "12:15", org.timezone));
			expect(findings).toContainEqual(
				expect.objectContaining({
					kind: "jarbschg_daily_max",
					summary: expect.objectContaining({ used: { unit: "minutes", value: 600 } }),
				}),
			);
		});

		it("keeps an open night clock-in after midnight", async () => {
			const minor = await fx.employee(org, "nightowl", { birthday: "2011-01-01" });
			const night = await shift(minor, "2027-03-01", "22:00", "02:00");
			await seed.openWork(org, minor, "2027-03-01", "22:00");
			const findings = await evaluateAt(minor, localInstant("2027-03-02", "01:00", org.timezone));
			expect(findings).toContainEqual(
				expect.objectContaining({
					kind: "jarbschg_night_work",
					subjectKey: `shift:${night}`,
					summary: expect.objectContaining({ used: { unit: "minutes", value: 240 } }),
				}),
			);
		});
	});

	it("drops adult ArbZG findings for executive-exempt adults, never youth limits", async () => {
		await seed.regulatedPolicy(org, { createdBy: owner.userId, maxDailyMinutes: 480 });
		const standard = await fx.employee(org, "standard", { birthday: "1990-01-01" });
		const executive = await fx.employee(org, "executive", { birthday: "1990-01-01" });
		const minorExecutive = await fx.employee(org, "minorexec", { birthday: "2011-01-01" });
		for (const who of [executive, minorExecutive]) {
			await seed.terms(who, {
				from: "2026-01-01",
				createdBy: owner.userId,
				arbzgScope: "executive_exempt",
			});
		}
		for (const who of [standard, executive, minorExecutive]) {
			await shift(who, "2027-03-02", "07:00", "18:00");
		}

		const { findings } = await evaluateWeek();
		const of = (who: FixtureEmployee) =>
			findings
				.filter((finding) => finding.employeeId === who.employeeId)
				.map((finding) => (finding.type === "statutory" ? finding.statutoryKind : finding.type));
		expect(of(standard)).toEqual(["maxHours"]);
		expect(of(executive)).toEqual([]);
		expect(of(minorExecutive)).toEqual(["jarbschg_daily_max"]);
	});
});
