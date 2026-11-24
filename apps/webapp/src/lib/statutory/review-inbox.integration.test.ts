/**
 * #1994: the unified statutory review inbox (real PostgreSQL). It aggregates every monitor's open
 * findings and pending or stale acknowledgements, re-opens an acknowledgement once the work or
 * shift it documented changes, and never mixes organizations.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { integrationAdminPool } from "@/test/integration-database";
import { statutoryFixture } from "@/test/statutory-fixtures";
import {
	STATUTORY_DOMAINS_NOW as now,
	statutoryDomainsFixture,
} from "./__tests__/statutory-domains-fixture";
import { loadStatutoryAcknowledgementHistory } from "./acknowledgement-history";
import { acknowledgeMinijobExceedance } from "./minijob/acknowledge-minijob-exceedance";
import { loadMinijobExceedanceReviews } from "./minijob/minijob-reviews";
import { acknowledgeOnCallShortNotice } from "./on-call/acknowledge";
import { listOnCallReviewItems } from "./on-call/views";
import { loadStatutoryReviewInbox } from "./review-inbox";
import {
	acknowledgeWorkingStudentFinding,
	listWorkingStudentReviewItems,
} from "./working-student/views";

const timezone = "Europe/Berlin";

describe("statutory review inbox (PostgreSQL)", () => {
	vi.setConfig({ testTimeout: 180_000, hookTimeout: 60_000 });
	const admin = integrationAdminPool();
	const fx = statutoryFixture(admin, "t1994-inbox");
	const domains = statutoryDomainsFixture(admin, fx);

	beforeEach(async () => {
		await fx.cleanup();
		domains.reset();
	});
	afterAll(fx.cleanup);

	it("aggregates open findings and pending acknowledgements of all five statutory domains", async () => {
		const seed = await domains.seed("a");

		const inbox = await loadStatutoryReviewInbox(db, { organizationId: seed.org.id, now });

		expect(inbox.items).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					reviewDomain: "minijob",
					employeeId: seed.mini.employeeId,
					kind: "minijob_monthly_cap",
					subjectKey: "2026-11",
					severity: "critical",
					acknowledgementStatus: "none",
					acknowledgeable: true,
					source: "review",
				}),
				expect.objectContaining({
					reviewDomain: "short_term",
					employeeId: seed.seasonal.employeeId,
					kind: "short_term_berufsmaessigkeit_check",
					subjectKey: "2026-11",
					acknowledgementStatus: "none",
					source: "review",
				}),
				expect.objectContaining({
					reviewDomain: "working_student",
					employeeId: seed.student.employeeId,
					subjectKey: "2026-W46",
					acknowledgementStatus: "none",
					source: "review",
				}),
				expect.objectContaining({
					reviewDomain: "on_call",
					employeeId: seed.caller.employeeId,
					kind: "on_call_short_notice",
					subjectKey: `shift:${seed.onCallShiftId}`,
					acknowledgementStatus: "none",
					source: "review",
				}),
				expect.objectContaining({
					reviewDomain: "youth_apprentice",
					domain: "youth_protection",
					employeeId: seed.minor.employeeId,
					kind: "jarbschg_saturday_work",
					subjectKey: `shift:${seed.saturdayShiftId}`,
					severity: "critical",
					acknowledgementStatus: "none",
					source: "review",
				}),
				expect.objectContaining({
					reviewDomain: "youth_apprentice",
					domain: "apprenticeship",
					employeeId: seed.learner.employeeId,
					kind: "bbig_release_day_shift",
					periodStart: "2026-11-24",
					// An adult apprentice's release conflict warns; it cannot be acknowledged.
					severity: "warning",
					acknowledgementStatus: null,
					acknowledgeable: false,
					source: "monitor",
				}),
			]),
		);
		const summary = Object.fromEntries(inbox.domains.map((domain) => [domain.domain, domain]));
		for (const domain of ["minijob", "short_term", "working_student", "on_call"] as const) {
			expect(summary[domain]).toMatchObject({
				status: "loaded",
				pendingAcknowledgements: 1,
				staleAcknowledgements: 0,
			});
		}
		expect(summary.minijob).toMatchObject({ critical: 1 });
		expect(summary.youth_apprentice).toMatchObject({
			status: "loaded",
			critical: 1,
			warning: 1,
			pendingAcknowledgements: 1,
			staleAcknowledgements: 0,
		});
		// Nobody without a finding appears.
		expect(inbox.items.map((item) => item.employeeId)).not.toContain(seed.owner.employeeId);
	});

	it("re-opens an acknowledgement as stale once newer work or a changed shift invalidates it", async () => {
		const seed = await domains.seed("a");
		const organizationId = seed.org.id;
		const [week] = (await listWorkingStudentReviewItems(db, { organizationId, now })).map(
			(item) => item.finding,
		);
		await acknowledgeWorkingStudentFinding(db, {
			organizationId,
			actorUserId: seed.owner.userId,
			employeeId: seed.student.employeeId,
			findingKind: week.kind,
			weekStart: week.periodStart,
			expectedInputFingerprint: week.inputFingerprint,
			reason: "Exam-free project week confirmed by the university",
			now,
		});
		const notice = (await listOnCallReviewItems(db, { organizationId, timezone, now })).find(
			(item) => item.finding.kind === "on_call_short_notice",
		);
		await acknowledgeOnCallShortNotice(db, {
			organizationId,
			timezone,
			actorUserId: seed.owner.userId,
			shiftId: seed.onCallShiftId,
			expectedFingerprint: notice?.finding.inputFingerprint ?? "",
			reason: "The employee agreed by phone",
			now,
		});

		const documented = await loadStatutoryReviewInbox(db, { organizationId, now });
		const ids = (inbox: typeof documented) => inbox.items.map((item) => item.id);
		expect(ids(documented)).not.toContain(week.id);
		expect(ids(documented)).not.toContain(notice?.finding.id);
		expect(documented.domains).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					domain: "working_student",
					pendingAcknowledgements: 0,
					staleAcknowledgements: 0,
				}),
				expect.objectContaining({
					domain: "on_call",
					pendingAcknowledgements: 0,
					staleAcknowledgements: 0,
				}),
			]),
		);
		// "Show resolved" still lists them, as documented.
		const resolved = await loadStatutoryReviewInbox(db, {
			organizationId,
			now,
			includeResolved: true,
		});
		expect(resolved.items).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ id: week.id, acknowledgementStatus: "current" }),
				expect.objectContaining({ id: notice?.finding.id, acknowledgementStatus: "current" }),
			]),
		);

		// Newer work in the documented week, and the planner moves the call-in's end.
		await domains.workWeekdays(seed.org, seed.student, "2026-11-09", "14:00", "16:00");
		await admin.query(
			`UPDATE shift SET end_time = '13:00', assignment_changed_at = $2 WHERE id = $1`,
			[seed.onCallShiftId, new Date("2026-11-18T09:00:00Z")],
		);

		const reopened = await loadStatutoryReviewInbox(db, { organizationId, now });
		expect(reopened.items).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ id: week.id, acknowledgementStatus: "stale" }),
				expect.objectContaining({ id: notice?.finding.id, acknowledgementStatus: "stale" }),
			]),
		);
		expect(reopened.domains).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ domain: "working_student", staleAcknowledgements: 1 }),
				expect.objectContaining({ domain: "on_call", staleAcknowledgements: 1 }),
			]),
		);
	});

	it("shows an acknowledgement's audited history: who, when, why, legal note, current or invalidated", async () => {
		const seed = await domains.seed("a");
		const organizationId = seed.org.id;
		const weekOf = async () =>
			(await listWorkingStudentReviewItems(db, { organizationId, now }))[0].finding;
		const first = await weekOf();
		const acknowledge = (finding: typeof first, reason: string, legalNote: string | null) =>
			acknowledgeWorkingStudentFinding(db, {
				organizationId,
				actorUserId: seed.owner.userId,
				employeeId: seed.student.employeeId,
				findingKind: finding.kind,
				weekStart: finding.periodStart,
				expectedInputFingerprint: finding.inputFingerprint,
				reason,
				legalNote,
				now,
			});
		await acknowledge(first, "Project week", "§ 8 SGB IV");
		await domains.workWeekdays(seed.org, seed.student, "2026-11-09", "14:00", "15:00");
		const second = await weekOf();
		await acknowledge(second, "Project week, extended", null);
		const subject = {
			employeeId: seed.student.employeeId,
			kind: "working_student_over_20h_week" as const,
			findingKind: second.kind,
			subjectKey: second.subjectKey,
		};

		const current = await loadStatutoryAcknowledgementHistory(db, {
			organizationId,
			subject,
			currentInputFingerprint: second.inputFingerprint,
			currentStatus: "current",
		});
		expect(current).toEqual([
			expect.objectContaining({
				reason: "Project week, extended",
				legalNote: null,
				acknowledgedByName: "a-owner",
				state: "current",
			}),
			expect.objectContaining({
				reason: "Project week",
				legalNote: "§ 8 SGB IV",
				acknowledgedByName: "a-owner",
				state: "superseded",
			}),
		]);
		expect(current[0].acknowledgedAt.getTime()).toBeGreaterThanOrEqual(
			current[1].acknowledgedAt.getTime(),
		);

		// More work after the second acknowledgement: the newest one is invalidated.
		await domains.workWeekdays(seed.org, seed.student, "2026-11-09", "15:00", "16:00");
		const third = await weekOf();
		expect(third.acknowledgement?.status).toBe("stale");
		const stale = await loadStatutoryAcknowledgementHistory(db, {
			organizationId,
			subject,
			currentInputFingerprint: third.inputFingerprint,
			currentStatus: "stale",
		});
		expect(stale.map((row) => row.state)).toEqual(["stale", "superseded"]);
		// Never the fingerprint itself: it is not needed to read the history.
		expect(JSON.stringify(stale)).not.toContain(second.inputFingerprint);

		// Another organization's admin reads nothing of it.
		const other = await fx.organization("other");
		expect(
			await loadStatutoryAcknowledgementHistory(db, {
				organizationId: other.id,
				subject,
				currentInputFingerprint: third.inputFingerprint,
				currentStatus: "stale",
			}),
		).toEqual([]);
	});

	it("keeps an acknowledged Minijob month open and critical once it became a third exceedance", async () => {
		const seed = await domains.seed("a");
		const organizationId = seed.org.id;
		const employeeId = seed.mini.employeeId;
		// 45 h at 15 EUR/h: March 2026 is the first exceedance, so it can be acknowledged.
		await domains.monthWork(seed.org, seed.mini, "2026-03", 2700);
		const marchOf = async () =>
			(
				await loadMinijobExceedanceReviews(db, { organizationId, now, includeAcknowledged: true })
			).find((review) => review.employeeId === employeeId && review.month === "2026-03");
		const shown = await marchOf();
		await acknowledgeMinijobExceedance(db, {
			organizationId,
			actorUserId: seed.owner.userId,
			employeeId,
			month: "2026-03",
			reason: "Covered a sick colleague",
			expectedFingerprint: shown?.inputFingerprint ?? "",
			expectedTotalCents: shown?.totalCents ?? 0,
			now,
		});
		const documented = await loadStatutoryReviewInbox(db, { organizationId, now });
		expect(documented.items.map((item) => item.subjectKey)).not.toContain("2026-03");

		// Exceedances recorded later in January and February make March the third in 12 months.
		await domains.monthWork(seed.org, seed.mini, "2026-01", 2700);
		await domains.monthWork(seed.org, seed.mini, "2026-02", 2700);

		const march = await marchOf();
		expect(march).toMatchObject({ status: "too_many_exceedances", severity: "critical" });
		// The acknowledgement still matches March's own figures, but it no longer documents it.
		expect(march?.acknowledgement.status).toBe("no_longer_applies");
		const inbox = await loadStatutoryReviewInbox(db, { organizationId, now });
		expect(inbox.items).toContainEqual(
			expect.objectContaining({
				reviewDomain: "minijob",
				employeeId,
				subjectKey: "2026-03",
				severity: "critical",
				acknowledgeable: false,
				acknowledgementStatus: "no_longer_applies",
			}),
		);
		// January, February, March and November exceed the cap; none is documented.
		expect(inbox.domains).toContainEqual(
			expect.objectContaining({
				domain: "minijob",
				critical: 4,
				pendingAcknowledgements: 2,
				staleAcknowledgements: 0,
			}),
		);

		const history = await loadStatutoryAcknowledgementHistory(db, {
			organizationId,
			subject: {
				employeeId,
				kind: "minijob_unforeseeable_exceedance",
				findingKind: "minijob_monthly_cap",
				subjectKey: "2026-03",
			},
			currentInputFingerprint: march?.inputFingerprint ?? "",
			currentStatus: march?.acknowledgement.status ?? "none",
		});
		expect(history).toEqual([
			expect.objectContaining({ reason: "Covered a sick colleague", state: "no_longer_applies" }),
		]);
	});

	it("lists a Minijob exceedance planned in the last month of the planning horizon", async () => {
		const seed = await domains.seed("a");
		const organizationId = seed.org.id;
		// 18 November + 8 weeks reaches 13 January 2027: six 8-hour January shifts, 720 EUR.
		for (const date of ["04", "05", "06", "07", "08", "11"]) {
			await domains.shift(seed.org, {
				employeeId: seed.mini.employeeId,
				date: `2027-01-${date}`,
				startTime: "08:00",
				endTime: "16:00",
			});
		}

		const inbox = await loadStatutoryReviewInbox(db, { organizationId, now });

		expect(inbox.items).toContainEqual(
			expect.objectContaining({
				reviewDomain: "minijob",
				employeeId: seed.mini.employeeId,
				kind: "minijob_monthly_cap",
				subjectKey: "2027-01",
				severity: "critical",
				acknowledgeable: true,
				acknowledgementStatus: "none",
			}),
		);
		expect(inbox.domains).toContainEqual(
			expect.objectContaining({ domain: "minijob", critical: 2, pendingAcknowledgements: 2 }),
		);
		// Reviews & Conflicts' Minijob list shows it with its acknowledgement form.
		expect(await loadMinijobExceedanceReviews(db, { organizationId, now })).toContainEqual(
			expect.objectContaining({
				month: "2027-01",
				acknowledgeable: true,
				status: "unacknowledged",
			}),
		);
	});

	it("never shows one organization's findings or acknowledgements in another's inbox", async () => {
		const a = await domains.seed("a");
		domains.reset();
		const b = await domains.seed("b");
		const [bWeek] = (
			await listWorkingStudentReviewItems(db, { organizationId: b.org.id, now })
		).map((item) => item.finding);
		await acknowledgeWorkingStudentFinding(db, {
			organizationId: b.org.id,
			actorUserId: b.owner.userId,
			employeeId: b.student.employeeId,
			findingKind: bWeek.kind,
			weekStart: bWeek.periodStart,
			expectedInputFingerprint: bWeek.inputFingerprint,
			reason: "Documented in organization B",
			now,
		});
		// An org admin of A cannot acknowledge B's finding through A.
		await expect(
			acknowledgeWorkingStudentFinding(db, {
				organizationId: a.org.id,
				actorUserId: a.owner.userId,
				employeeId: b.student.employeeId,
				findingKind: bWeek.kind,
				weekStart: bWeek.periodStart,
				expectedInputFingerprint: bWeek.inputFingerprint,
				reason: "Cross-tenant attempt",
				now,
			}),
		).rejects.toThrow();

		const inboxA = await loadStatutoryReviewInbox(db, { organizationId: a.org.id, now });
		const inboxB = await loadStatutoryReviewInbox(db, { organizationId: b.org.id, now });
		const employeesOf = (seed: typeof a) =>
			new Set(
				[seed.mini, seed.seasonal, seed.student, seed.caller, seed.minor, seed.learner].map(
					(who) => who.employeeId,
				),
			);
		const aEmployees = employeesOf(a);
		const bEmployees = employeesOf(b);
		expect(inboxA.items.length).toBeGreaterThan(0);
		expect(inboxA.items.every((item) => aEmployees.has(item.employeeId))).toBe(true);
		expect(inboxB.items.every((item) => bEmployees.has(item.employeeId))).toBe(true);
		// B's acknowledgement documents B's week only: A's student week is still pending.
		expect(inboxA.domains).toContainEqual(
			expect.objectContaining({ domain: "working_student", pendingAcknowledgements: 1 }),
		);
		expect(inboxB.domains).toContainEqual(
			expect.objectContaining({ domain: "working_student", pendingAcknowledgements: 0 }),
		);
		for (const summary of inboxA.domains) {
			expect(summary.status).toBe("loaded");
		}
	});
});
