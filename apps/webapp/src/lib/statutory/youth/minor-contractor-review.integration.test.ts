/**
 * #2022: minor contractors for youth-protection review (real PostgreSQL). A contractor under 18 on
 * a day of an engagement in the review window is one warning per engagement period in the Youth &
 * Apprentice review domain, acknowledgeable with a reason; the acknowledgement re-opens when the
 * engagement period or the birthday changes, or once the window holds a day of the minor after the
 * engagement ended. With the organization judging minor contractors under
 * JArbSchG, none is raised. Organization-scoped throughout.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { integrationAdminPool } from "@/test/integration-database";
import {
	type FixtureEmployee,
	type FixtureOrganization,
	statutoryFixture,
} from "@/test/statutory-fixtures";
import { loadStatutoryReviewInbox } from "../review-inbox";
import {
	acknowledgeMinorContractorReview,
	listMinorContractorReviews,
} from "./minor-contractor-review";
import { localInstant, youthSeed } from "./testing/youth-seed";

describe("minor contractors for youth-protection review (PostgreSQL)", () => {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
	const admin = integrationAdminPool();
	const fx = statutoryFixture(admin, "t2022mc");
	const seed = youthSeed(admin);
	let org: FixtureOrganization;
	let owner: FixtureEmployee;

	beforeEach(async () => {
		await fx.cleanup();
		org = await fx.organization("a");
		owner = await fx.employee(org, "owner", { role: "admin" });
		await fx.membership(org, owner, "owner");
	});
	afterAll(fx.cleanup);

	// The review window runs from 2027-02-23 to 2027-04-28.
	const now = () => localInstant("2027-03-02", "12:00", org.timezone);
	const list = (includeAcknowledged = false, organization = org) =>
		listMinorContractorReviews(db, {
			organizationId: organization.id,
			timezone: organization.timezone,
			now: now(),
			includeAcknowledged,
		});
	const youthDomain = async (organization = org) =>
		(
			await loadStatutoryReviewInbox(db, {
				organizationId: organization.id,
				now: now(),
				countsOnly: true,
			})
		).domains.find((domain) => domain.domain === "youth_apprentice");
	const acknowledge = (
		who: FixtureEmployee,
		review: { subjectKey: string; inputFingerprint: string },
		organization = org,
	) =>
		acknowledgeMinorContractorReview(db, {
			organizationId: organization.id,
			actorUserId: owner.userId,
			timezone: organization.timezone,
			now: now(),
			employeeId: who.employeeId,
			subjectKey: review.subjectKey,
			expectedFingerprint: review.inputFingerprint,
			reason: "Self-employed tutoring for several clients; not employee-like work",
		});

	it("raises one warning per contractor engagement of a minor, none for an adult contractor or a minor employee", async () => {
		const minor = await fx.employee(org, "minor", { birthday: "2011-05-01" });
		const adult = await fx.employee(org, "adult", { birthday: "1990-05-01" });
		const employee = await fx.employee(org, "employee", { birthday: "2011-05-01" });
		const first = await seed.engagement(org, minor, {
			kind: "contractor",
			from: "2027-01-01",
			until: "2027-03-01",
		});
		await seed.engagement(org, minor, {
			kind: "employee",
			from: "2027-03-01",
			until: "2027-04-01",
		});
		const second = await seed.engagement(org, minor, {
			kind: "contractor",
			from: "2027-04-01",
			until: null,
		});
		await seed.engagement(org, adult, { kind: "contractor", from: "2027-01-01", until: null });
		await seed.engagement(org, employee, { kind: "employee", from: "2027-01-01", until: null });

		const reviews = await list();
		expect(reviews).toEqual([
			expect.objectContaining({
				employeeId: minor.employeeId,
				// The user-name rule: the user's name, never the employee row's.
				employeeName: "minor",
				subjectKey: `engagement:${first}`,
				periodStart: "2027-01-01",
				periodEnd: "2027-03-01",
				legalReference: "§ 1 Abs. 1 Nr. 3 JArbSchG",
				acknowledgementStatus: "none",
			}),
			expect.objectContaining({
				subjectKey: `engagement:${second}`,
				periodStart: "2027-04-01",
				periodEnd: null,
			}),
		]);
		expect(await youthDomain()).toMatchObject({
			status: "loaded",
			critical: 0,
			warning: 2,
			pendingAcknowledgements: 2,
			staleAcknowledgements: 0,
		});
	});

	it("raises the item for contractor days outside every stint, as the monitor skips them", async () => {
		// Today 2026-11-24: the window runs 2026-11-17 – 2027-01-20.
		const listOn = (day: string) =>
			listMinorContractorReviews(db, {
				organizationId: org.id,
				timezone: org.timezone,
				now: localInstant(day, "12:00", org.timezone),
			});
		// A 16-year-old whose contractor stint ended on 2026-10-31: still on the roster as a contractor,
		// so the monitor skips a 2026-12-05 21:00–23:00 shift as a contractor day.
		const ended = await fx.employee(org, "ended", { birthday: "2010-06-01" });
		const endedStint = await seed.engagement(org, ended, {
			kind: "contractor",
			from: "2026-09-01",
			until: "2026-11-01",
		});
		// A minor before a first contractor stint starting 2027-02-01.
		const upcoming = await fx.employee(org, "upcoming", { birthday: "2010-06-01" });
		const upcomingStint = await seed.engagement(org, upcoming, {
			kind: "contractor",
			from: "2027-02-01",
			until: null,
		});
		// A minor employee whose stint ended: their days stay employee days.
		const formerEmployee = await fx.employee(org, "former", { birthday: "2010-06-01" });
		await seed.engagement(org, formerEmployee, {
			kind: "employee",
			from: "2026-09-01",
			until: "2026-11-01",
		});

		const reviews = await listOn("2026-11-24");
		expect(reviews).toEqual([
			expect.objectContaining({
				employeeId: ended.employeeId,
				subjectKey: `engagement:${endedStint}`,
				periodStart: "2026-09-01",
				periodEnd: "2026-11-01",
				contractorAfterEnd: true,
				contractorBeforeStart: false,
			}),
			expect.objectContaining({
				employeeId: upcoming.employeeId,
				subjectKey: `engagement:${upcomingStint}`,
				periodStart: "2027-02-01",
				periodEnd: null,
				contractorAfterEnd: false,
				contractorBeforeStart: true,
			}),
		]);
		// What the admin documents does not move with the window.
		expect((await listOn("2026-11-25")).map((review) => review.inputFingerprint)).toEqual(
			reviews.map((review) => review.inputFingerprint),
		);

		// Documented, then the ended stint's end is corrected: open again.
		await acknowledgeMinorContractorReview(db, {
			organizationId: org.id,
			actorUserId: owner.userId,
			timezone: org.timezone,
			now: localInstant("2026-11-24", "12:00", org.timezone),
			employeeId: ended.employeeId,
			subjectKey: `engagement:${endedStint}`,
			expectedFingerprint: reviews[0].inputFingerprint,
			reason: "Engagement over; removing them from the roster",
		});
		expect((await listOn("2026-11-24")).map((review) => review.employeeId)).toEqual([
			upcoming.employeeId,
		]);
		await admin.query("update employee_employment_period set ended_at = $2 where id = $1", [
			endedStint,
			localInstant("2026-11-10", "00:00", org.timezone).toString(),
		]);
		expect(await listOn("2026-11-24")).toEqual([
			expect.objectContaining({ employeeId: ended.employeeId, acknowledgementStatus: "stale" }),
			expect.objectContaining({ employeeId: upcoming.employeeId }),
		]);

		// The organization judging minor contractors under JArbSchG raises none of them.
		await seed.applyJarbschgToMinorContractors(org);
		expect(await listOn("2026-11-24")).toEqual([]);
	});

	it("re-opens a documentation once the window reaches contractor days after the stint ended", async () => {
		// A 16-year-old contractor 2026-09-01 – 2027-02-28 with no later stint, kept on the roster.
		const tutor = await fx.employee(org, "tutor", { birthday: "2010-06-01" });
		const stint = await seed.engagement(org, tutor, {
			kind: "contractor",
			from: "2026-09-01",
			until: "2027-03-01",
		});
		const listOn = (day: string) =>
			listMinorContractorReviews(db, {
				organizationId: org.id,
				timezone: org.timezone,
				now: localInstant(day, "12:00", org.timezone),
				includeAcknowledged: true,
			});
		const documentOn = (day: string, review: { inputFingerprint: string }) =>
			acknowledgeMinorContractorReview(db, {
				organizationId: org.id,
				actorUserId: owner.userId,
				timezone: org.timezone,
				now: localInstant(day, "12:00", org.timezone),
				employeeId: tutor.employeeId,
				subjectKey: `engagement:${stint}`,
				expectedFingerprint: review.inputFingerprint,
				reason: "Short tutoring engagement, ends in February",
			});

		// On 2026-11-24 the window ends inside the stint (2027-01-20).
		const [shown] = await listOn("2026-11-24");
		expect(shown).toMatchObject({ contractorAfterEnd: false, acknowledgementStatus: "none" });
		await documentOn("2026-11-24", shown);
		// On 2027-01-03 its last day is 2027-02-28: still documented.
		expect(await listOn("2027-01-03")).toEqual([
			expect.objectContaining({ contractorAfterEnd: false, acknowledgementStatus: "current" }),
		]);

		// From 2027-01-04 the window holds 2027-03-01, a contractor day after the stint ended.
		const [reopened] = await listOn("2027-01-04");
		expect(reopened).toMatchObject({ contractorAfterEnd: true, acknowledgementStatus: "stale" });

		// Documented again, it holds as the window moves on.
		await documentOn("2027-01-04", reopened);
		expect(await listOn("2027-01-05")).toEqual([
			expect.objectContaining({ contractorAfterEnd: true, acknowledgementStatus: "current" }),
		]);
		expect(await listOn("2027-02-20")).toEqual([
			expect.objectContaining({ contractorAfterEnd: true, acknowledgementStatus: "current" }),
		]);
	});

	it("shows an engagement whose start was not recorded the same on consecutive days", async () => {
		// A legacy stint without a recorded start, and a contractor with no stint at all.
		const legacy = await fx.employee(org, "legacy", { birthday: "2011-05-01" });
		const unrecorded = await fx.employee(org, "unrecorded", { birthday: "2011-06-01" });
		/** Replaces the employee's stints by one legacy contractor stint with no recorded start. */
		const legacyContractor = async (who: FixtureEmployee) => {
			await admin.query("delete from employee_employment_period where employee_id = $1", [
				who.employeeId,
			]);
			const {
				rows: [row],
			} = await admin.query<{ id: string }>(
				`insert into employee_employment_period
				 (organization_id, employee_id, status, started_at, ended_at, start_provenance, engagement_kind)
				 values ($1, $2, 'legacy_unknown', null, null, 'unknown', 'contractor') returning id`,
				[org.id, who.employeeId],
			);
			await admin.query("update employee set engagement_kind = 'contractor' where id = $1", [
				who.employeeId,
			]);
			return row.id;
		};
		const period = await legacyContractor(legacy);
		await legacyContractor(unrecorded);
		await admin.query("delete from employee_employment_period where employee_id = $1", [
			unrecorded.employeeId,
		]);
		const listOn = (day: string) =>
			listMinorContractorReviews(db, {
				organizationId: org.id,
				timezone: org.timezone,
				now: localInstant(day, "12:00", org.timezone),
			});

		const today = await listOn("2027-03-02");
		expect(today).toEqual([
			expect.objectContaining({
				employeeId: legacy.employeeId,
				subjectKey: `engagement:${period}`,
				periodStart: null,
				periodEnd: null,
			}),
			expect.objectContaining({
				employeeId: unrecorded.employeeId,
				subjectKey: "engagement:unrecorded",
				periodStart: null,
				periodEnd: null,
			}),
		]);
		// Neither the item nor what the admin documents moves with the review window.
		expect(await listOn("2027-03-03")).toEqual(today);
	});

	it("documents an engagement with a reason and re-opens it when the birthday or the period changes", async () => {
		const minor = await fx.employee(org, "minor", { birthday: "2011-05-01" });
		const period = await seed.engagement(org, minor, {
			kind: "contractor",
			from: "2027-01-01",
			until: null,
		});
		const [review] = await list();

		const record = await acknowledge(minor, review);
		expect(record).toMatchObject({
			kind: "jarbschg_minor_contractor_review",
			findingKind: "jarbschg_minor_contractor",
			subjectKey: `engagement:${period}`,
			inputFingerprint: review.inputFingerprint,
		});
		expect(await list()).toEqual([]);
		expect(await list(true)).toEqual([
			expect.objectContaining({ acknowledgementStatus: "current" }),
		]);
		expect(await youthDomain()).toMatchObject({ warning: 0, pendingAcknowledgements: 0 });

		// A corrected birthday re-opens it.
		await admin.query("update employee set birthday = $2 where id = $1", [
			minor.employeeId,
			new Date("2011-06-01T00:00:00.000Z"),
		]);
		const [afterBirthday] = await list();
		expect(afterBirthday).toMatchObject({ acknowledgementStatus: "stale" });
		expect(await youthDomain()).toMatchObject({ warning: 1, staleAcknowledgements: 1 });

		// Documented again, then the engagement gets an end date: open again.
		await acknowledge(minor, afterBirthday);
		expect(await list()).toEqual([]);
		await admin.query(
			"update employee_employment_period set ended_at = $2, status = 'closed' where id = $1",
			[period, localInstant("2027-04-15", "00:00", org.timezone).toString()],
		);
		expect(await list()).toEqual([
			expect.objectContaining({
				acknowledgementStatus: "stale",
				periodEnd: "2027-04-15",
			}),
		]);
	});

	it("refuses to document figures the admin was not shown, or an engagement that is no review item", async () => {
		const minor = await fx.employee(org, "minor", { birthday: "2011-05-01" });
		const adult = await fx.employee(org, "adult", { birthday: "1990-05-01" });
		await seed.engagement(org, minor, { kind: "contractor", from: "2027-01-01", until: null });
		const adultPeriod = await seed.engagement(org, adult, {
			kind: "contractor",
			from: "2027-01-01",
			until: null,
		});
		const [review] = await list();

		await expect(
			acknowledge(minor, { ...review, inputFingerprint: "v1:not-what-was-shown" }),
		).rejects.toMatchObject({ refusal: "statutory_finding_changed" });
		await expect(
			acknowledge(adult, { subjectKey: `engagement:${adultPeriod}`, inputFingerprint: "v1:x" }),
		).rejects.toMatchObject({ refusal: "statutory_finding_not_found" });
		expect(await list()).toEqual([expect.objectContaining({ acknowledgementStatus: "none" })]);
	});

	it("raises nothing while the organization judges minor contractors under JArbSchG", async () => {
		const minor = await fx.employee(org, "minor", { birthday: "2011-05-01" });
		await seed.engagement(org, minor, { kind: "contractor", from: "2027-01-01", until: null });
		const [review] = await list();

		await seed.applyJarbschgToMinorContractors(org);

		expect(await list()).toEqual([]);
		expect(await list(true)).toEqual([]);
		expect(await youthDomain()).toMatchObject({ warning: 0, pendingAcknowledgements: 0 });
		await expect(acknowledge(minor, review)).rejects.toMatchObject({
			refusal: "statutory_finding_not_found",
		});
	});

	it("brings the items back with their documentation when the setting is turned off again", async () => {
		const minor = await fx.employee(org, "minor", { birthday: "2011-05-01" });
		await seed.engagement(org, minor, { kind: "contractor", from: "2027-01-01", until: null });
		const [review] = await list();
		await acknowledge(minor, review);

		await seed.applyJarbschgToMinorContractors(org);
		expect(await list(true)).toEqual([]);
		await seed.applyJarbschgToMinorContractors(org, false);

		expect(await list()).toEqual([]);
		expect(await list(true)).toEqual([
			expect.objectContaining({
				subjectKey: review.subjectKey,
				inputFingerprint: review.inputFingerprint,
				acknowledgementStatus: "current",
			}),
		]);
		expect(await youthDomain()).toMatchObject({ warning: 0, pendingAcknowledgements: 0 });
	});

	it("keeps each organization's minor contractors to itself", async () => {
		const other = await fx.organization("b");
		const minor = await fx.employee(org, "minor", { birthday: "2011-05-01" });
		const foreign = await fx.employee(other, "foreign", { birthday: "2011-05-01" });
		await seed.engagement(org, minor, { kind: "contractor", from: "2027-01-01", until: null });
		await seed.engagement(other, foreign, { kind: "contractor", from: "2027-01-01", until: null });
		const [ownReview] = await list();
		const [foreignReview] = await list(false, other);

		expect((await list()).map((review) => review.employeeId)).toEqual([minor.employeeId]);
		expect((await list(false, other)).map((review) => review.employeeId)).toEqual([
			foreign.employeeId,
		]);
		// The other organization's engagement cannot be documented from this one.
		await expect(acknowledge(foreign, foreignReview)).rejects.toMatchObject({
			refusal: "statutory_finding_not_found",
		});
		await acknowledge(minor, ownReview);
		expect(await list(false, other)).toEqual([
			expect.objectContaining({ employeeId: foreign.employeeId, acknowledgementStatus: "none" }),
		]);
	});
});
