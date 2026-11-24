/**
 * #1934: Staffing and the publish block judge two runs on one `memoizedReader`. Sharing the reads
 * must not change what they find: with every monitor in breach (a running clock-in, an
 * acknowledgement, a proposal that deepens a breach, a shift it replaces) the memoized results
 * equal those of unmemoized runs.
 */
import { Temporal } from "temporal-polyfill";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import type { StatutoryComplianceFinding } from "@/lib/scheduling/compliance/types";
import { integrationAdminPool } from "@/test/integration-database";
import { recordApprenticeRelease } from "../employee-context";
import { minijobFixture } from "../minijob/__tests__/minijob-database-fixture";
import { onCallFixture } from "../on-call/__tests__/on-call-fixture";
import { shortTermFixture } from "../short-term/__tests__/short-term-fixture";
import { statutoryDomains } from "../threshold-catalog";
import { acknowledgeWorkingStudentFinding } from "../working-student/views";
import { workingStudentFixture } from "../working-student/working-student.test.fixture";
import { youthSeed } from "../youth/testing/youth-seed";
import {
	addedStatutoryScheduleFindings,
	deepensBreachedLimit,
	evaluateStatutoryFindings,
	evaluateStatutoryScheduleFindings,
	toStatutoryComplianceFinding,
} from "./evaluate";
import { statutoryFindingChangeKey } from "./finding-key";
import { findingsBlockingDraftPublication, findingsBlockingPublication } from "./publish-blocking";

/** Switches `memoizedReader` off, so a run reads straight from the database. */
const memo = vi.hoisted(() => ({ off: false }));
vi.mock("./read-memo", async (importOriginal) => {
	const actual = await importOriginal<typeof import("./read-memo")>();
	return {
		...actual,
		memoizedReader: ((reader) =>
			memo.off ? reader : actual.memoizedReader(reader)) as typeof actual.memoizedReader,
	};
});

async function unmemoized<T>(run: () => Promise<T>): Promise<T> {
	memo.off = true;
	try {
		return await run();
	} finally {
		memo.off = false;
	}
}

const MONDAY = "2027-03-01";
const WINDOW = { start: MONDAY, endExclusive: "2027-03-08" };

describe("memoized statutory runs find what unmemoized runs find (PostgreSQL)", () => {
	vi.setConfig({ testTimeout: 120_000, hookTimeout: 60_000 });
	const admin = integrationAdminPool();
	const fx = workingStudentFixture(admin, "t1934-memo-results");
	const onCall = onCallFixture(admin, fx);
	const mj = minijobFixture(admin, fx);
	const st = shortTermFixture(admin, () => fx.user("creator"));
	const youth = youthSeed(admin);

	beforeEach(async () => {
		mj.reset();
		st.reset();
		await fx.cleanup();
	});
	afterAll(fx.cleanup);

	/**
	 * One employee in each monitor's scope, each planned 9 h Monday to Friday of 2027-W09 and in
	 * breach; judged on Wednesday 10:00, inside the week.
	 */
	async function everyMonitorInBreach() {
		const org = await fx.organization("a");
		const owner = await fx.user("owner");
		await fx.membership(org, owner, "owner");
		const subareaId = await fx.subarea(org, await fx.employee(org, "planner"));
		const onCallOrg = { ...org, subareaId, plannerUserId: owner.userId };
		const now = Temporal.PlainDateTime.from("2027-03-03T10:00")
			.toZonedDateTime(org.timezone)
			.toInstant();

		const minijobber = await fx.employee(org, "minijob", { contractType: "hourly" });
		await mj.terms(minijobber, owner, { from: "2026-01-01", hourlyRate: 20 });
		const seasonal = await fx.employee(org, "short", { contractType: "hourly" });
		await st.terms(seasonal, { from: "2026-01-01", hourlyRate: 20 });
		// 68 days with a prior employer: the week's five working days take the year past 70.
		await st.priorShortTerm(seasonal, "prior_short_term_work_days", 2027, 68);
		const student = await fx.workingStudent(org, "student");
		const onCallWorker = await fx.employee(org, "oncall");
		await onCall.onCallTerms(onCallOrg, onCallWorker, { kind: "unspecified" });
		// A minor's breaches block publication until a sector exception lifts them.
		await youth.blockJarbschgPublish(org);
		const minor = await fx.employee(org, "minor", { birthday: "2011-01-01" });
		const apprentice = await fx.employee(org, "apprentice", { birthday: "2005-05-05" });
		await youth.terms(apprentice, {
			from: "2026-01-01",
			createdBy: owner.userId,
			employmentProfile: "apprentice",
		});
		await recordApprenticeRelease(db, {
			organizationId: org.id,
			employeeId: apprentice.employeeId,
			actorUserId: owner.userId,
			releaseKind: "exam_day",
			startsOn: "2027-03-03",
			endsOn: "2027-03-03",
		});
		const candidates = [minijobber, seasonal, student, onCallWorker, minor, apprentice];

		// Published, except the minor's Thursday and Friday and the apprentice's exam-day shift. The
		// minor's 11 h shift spans exceed 10 h.
		const drafts: { id: string; employeeId: string }[] = [];
		for (const who of candidates) {
			for (const [offset, day] of ["Mon", "Tue", "Wed", "Thu", "Fri"].entries()) {
				const date = Temporal.PlainDate.from(MONDAY).add({ days: offset }).toString();
				const draft =
					(who === minor && (day === "Thu" || day === "Fri")) ||
					(who === apprentice && day === "Wed");
				const id = await fx.shift(
					org,
					subareaId,
					{ ...who, organizationId: org.id },
					who === minor
						? { date, start: "07:00", end: "18:00" }
						: { date, start: "08:00", end: "17:00" },
					draft ? "draft" : "published",
				);
				if (draft) drafts.push({ id, employeeId: who.employeeId });
			}
		}
		// Clocked in on Wednesday's shift and still working.
		await fx.openWork(org, student, { date: "2027-03-03", start: "07:55:42" });
		await onCall.openWork(onCallOrg, onCallWorker, { date: "2027-03-03", startTime: "07:55:42" });
		// An open shift on Thursday evening, which the proposal fills.
		const openShiftId = await onCall.shift(onCallOrg, {
			employeeId: null,
			date: "2027-03-04",
			startTime: "17:00",
			endTime: "19:00",
			status: "draft",
		});

		const request = {
			organizationId: org.id,
			timezone: org.timezone,
			window: WINDOW,
			employeeIds: candidates.map((who) => who.employeeId),
			now,
		};
		// An org admin acknowledges the working student's lecture week as shown.
		const lectureWeek = (await evaluateStatutoryFindings(db, request)).find(
			(finding) => finding.kind === "working_student_lecture_week",
		);
		await acknowledgeWorkingStudentFinding(db, {
			organizationId: org.id,
			actorUserId: owner.userId,
			employeeId: student.employeeId,
			findingKind: "working_student_lecture_week",
			weekStart: MONDAY,
			expectedInputFingerprint: lectureWeek?.inputFingerprint ?? "",
			reason: "Exam period ends this week",
			now,
		});

		return { org, now, request, drafts, openShiftId };
	}

	it("tells Staffing the same added findings as two unmemoized runs compared the same way", async () => {
		const { request, openShiftId } = await everyMonitorInBreach();
		const proposedShift = { date: "2027-03-04", startTime: "17:00", endTime: "19:00" };
		const proposedShifts = request.employeeIds.map((employeeId) => ({
			employeeId,
			...proposedShift,
		}));

		const memoized = await addedStatutoryScheduleFindings(db, {
			...request,
			proposedShift,
			replacesShiftId: openShiftId,
		});

		const baseline = await evaluateStatutoryFindings(db, {
			...request,
			comparedProposedShifts: proposedShifts,
			replacesShiftId: openShiftId,
		});
		const withProposal = await evaluateStatutoryFindings(db, {
			...request,
			proposedShifts,
			replacesShiftId: openShiftId,
		});
		// Every monitor is in breach, the acknowledgement is current, the proposal deepens breaches.
		expect([...new Set(baseline.map((finding) => finding.domain))].sort()).toEqual(
			[...statutoryDomains].sort(),
		);
		expect(baseline.some((finding) => finding.acknowledgement?.status === "current")).toBe(true);
		const before = new Map(
			baseline.map((finding) => {
				const projected = toStatutoryComplianceFinding(finding);
				return [statutoryFindingChangeKey(projected), projected] as const;
			}),
		);
		const expected = new Map<string, StatutoryComplianceFinding[]>();
		for (const finding of withProposal) {
			const projected = toStatutoryComplianceFinding(finding);
			const previous = before.get(statutoryFindingChangeKey(projected));
			if (previous && !deepensBreachedLimit(previous, projected)) continue;
			expected.set(finding.employeeId, [...(expected.get(finding.employeeId) ?? []), projected]);
		}
		expect(
			[...expected.values()]
				.flat()
				.some((finding) => before.has(statutoryFindingChangeKey(finding))),
		).toBe(true);

		expect(memoized).toEqual(expected);
	});

	it("refuses a publication for the same blocking findings with and without the memo", async () => {
		const { org, now, request, drafts } = await everyMonitorInBreach();
		const scope = { organizationId: org.id, timezone: org.timezone, window: WINDOW, now };

		const memoized = await findingsBlockingDraftPublication(db, scope, drafts);
		expect(memoized.length).toBeGreaterThan(0);
		expect(await unmemoized(() => findingsBlockingDraftPublication(db, scope, drafts))).toEqual(
			memoized,
		);

		// The early check before the planner's acknowledgement, from the range's evaluation.
		const evaluated = await evaluateStatutoryScheduleFindings(db, request);
		const early = await findingsBlockingPublication(db, scope, evaluated);
		expect(early.length).toBeGreaterThan(0);
		expect(await unmemoized(() => findingsBlockingPublication(db, scope, evaluated))).toEqual(
			early,
		);
	});
});
