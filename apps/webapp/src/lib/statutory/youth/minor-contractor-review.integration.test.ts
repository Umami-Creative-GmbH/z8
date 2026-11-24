/**
 * #2022: minor contractors for youth-protection review (real PostgreSQL). A contractor under 18 on
 * a day of an engagement in the review window is one warning per engagement period in the Youth &
 * Apprentice review domain, acknowledgeable with a reason; the acknowledgement re-opens when the
 * engagement period or the birthday changes. With the organization judging minor contractors under
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
				openEnded: false,
				legalReference: "§ 1 Abs. 1 Nr. 3 JArbSchG",
				acknowledgementStatus: "none",
			}),
			expect.objectContaining({
				subjectKey: `engagement:${second}`,
				periodStart: "2027-04-01",
				openEnded: true,
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
				openEnded: false,
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
