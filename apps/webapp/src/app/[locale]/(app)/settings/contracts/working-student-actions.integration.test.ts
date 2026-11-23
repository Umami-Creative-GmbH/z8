/**
 * #1991: working-student monitor actions against PostgreSQL — org-admin statutory context and
 * audited acknowledgements, the wage-free scoped-manager view, and the employee's own
 * non-sensitive status.
 */
import { Temporal } from "temporal-polyfill";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { systemClock } from "@/lib/datetime/temporal-core";
import { recordEmployeeStatutoryOffset } from "@/lib/statutory/employee-context";
import { loadOwnWorkingStudentStatus } from "@/lib/statutory/working-student/views";
import {
	addWeeks,
	weekdays,
	weekendOver20h,
	workingStudentFixture,
} from "@/lib/statutory/working-student/working-student.test.fixture";
import { integrationAdminPool } from "@/test/integration-database";
import type { StubCaller } from "@/test/organization-action";

const harness = vi.hoisted(() => ({ caller: null as StubCaller | null }));

vi.mock("@/lib/effect/runtime", async () => {
	const { db } = await import("@/db");
	const { organizationActionStubLayer } = await import("@/test/organization-action");
	return (await import("@/test/effect-runtime")).runtimeModuleOver(
		organizationActionStubLayer(() => harness.caller, { db }),
	);
});

const {
	acknowledgeWorkingStudentFindingAction,
	getWorkingStudentMonitorAction,
	listWorkingStudentReviewsAction,
	recordWorkingStudentLectureFreePeriodAction,
	recordWorkingStudentPriorWeeksAction,
	voidWorkingStudentPriorWeeksAction,
} = await import("./working-student-actions");

/** The current compliance week in Berlin, so the actions' own clock judges the seeded work. */
function currentMonday(): string {
	const today = systemClock.nowInstant().toZonedDateTimeISO("Europe/Berlin").toPlainDate();
	return today.subtract({ days: today.dayOfWeek - 1 }).toString();
}

describe("working-student actions (PostgreSQL)", () => {
	vi.setConfig({ testTimeout: 120_000, hookTimeout: 60_000 });
	const admin = integrationAdminPool();
	const fx = workingStudentFixture(admin, "t1991-actions");

	beforeEach(async () => {
		harness.caller = null;
		await fx.cleanup();
	});
	afterAll(fx.cleanup);

	async function setup() {
		const org = await fx.organization("a");
		const orgAdmin = await fx.user("admin");
		await fx.membership(org, orgAdmin, "admin");
		const student = await fx.workingStudent(org, "student");
		const manager = await fx.employee(org, "manager", { role: "manager" });
		await fx.membership(org, manager, "member");
		await admin.query(
			`insert into employee_managers (employee_id, manager_id, is_primary, assigned_by)
			 values ($1, $2, true, $3)`,
			[student.employeeId, manager.employeeId, orgAdmin.userId],
		);
		const peer = await fx.employee(org, "peer");
		await fx.membership(org, peer, "member");
		await fx.membership(org, student, "member");
		const asAdmin = () => {
			harness.caller = {
				userId: orgAdmin.userId,
				activeOrganizationId: org.id,
				membershipRole: "admin",
				employee: null,
			};
		};
		const asManager = () => {
			harness.caller = {
				userId: manager.userId,
				activeOrganizationId: org.id,
				membershipRole: "member",
				employee: { id: manager.employeeId, role: "manager" },
			};
		};
		const asMember = (who: typeof peer) => {
			harness.caller = {
				userId: who.userId,
				activeOrganizationId: org.id,
				membershipRole: "member",
				employee: { id: who.employeeId, role: "employee" },
			};
		};
		return { org, orgAdmin, student, manager, peer, asAdmin, asManager, asMember };
	}

	it("lets org admins record lecture-free periods and prior-employer weeks, and no one else", async () => {
		const { student, asAdmin, asManager } = await setup();

		asManager();
		expect(
			await recordWorkingStudentLectureFreePeriodAction({
				employeeId: student.employeeId,
				startsOn: "2026-07-20",
				endsOn: "2026-10-11",
			}),
		).toMatchObject({ success: false });

		asAdmin();
		expect(
			await recordWorkingStudentLectureFreePeriodAction({
				employeeId: student.employeeId,
				startsOn: "2026-07-20",
				endsOn: "2026-10-11",
				note: "Summer break per enrolment certificate",
			}),
		).toMatchObject({ success: true });
		const notMonday = await recordWorkingStudentPriorWeeksAction({
			employeeId: student.employeeId,
			firstWeekStartsOn: "2026-02-03",
			count: 4,
			note: "Previous employer certificate",
		});
		expect(notMonday).toMatchObject({ success: false, refusal: "statutory_invalid_range" });
		const recorded = await recordWorkingStudentPriorWeeksAction({
			employeeId: student.employeeId,
			firstWeekStartsOn: "2026-02-02",
			count: 4,
			sourceEmployer: "Previous GmbH",
			note: "Previous employer certificate",
		});
		expect(recorded).toMatchObject({ success: true });

		const view = await getWorkingStudentMonitorAction({ employeeId: student.employeeId });
		expect(view).toMatchObject({
			success: true,
			data: {
				applies: true,
				audience: "full",
				lectureFreePeriods: [
					{
						startsOn: "2026-07-20",
						endsOn: "2026-10-11",
						note: "Summer break per enrolment certificate",
					},
				],
				priorWeeks: [
					{ firstWeekStartsOn: "2026-02-02", count: 4, sourceEmployer: "Previous GmbH" },
				],
			},
		});

		if (!recorded.success) throw new Error("expected the offset");
		expect(
			await voidWorkingStudentPriorWeeksAction({
				employeeId: student.employeeId,
				offsetId: recorded.data.id,
				reason: "",
			}),
		).toMatchObject({ success: false, refusal: "statutory_note_required" });
		expect(
			await voidWorkingStudentPriorWeeksAction({
				employeeId: student.employeeId,
				offsetId: recorded.data.id,
				reason: "Recorded for the wrong student",
			}),
		).toMatchObject({ success: true });
		const after = await getWorkingStudentMonitorAction({ employeeId: student.employeeId });
		expect(after.success && after.data.priorWeeks).toEqual([]);
	});

	it("shows a scoped manager the monitor of a managed working student without admin detail", async () => {
		const { org, student, peer, orgAdmin, asManager, asMember } = await setup();
		const monday = currentMonday();
		await fx.work(org, student, weekdays(addWeeks(monday, -1), "09:00", "14:00"));
		await recordWorkingStudentLectureFreePeriodActionAsAdmin(
			org.id,
			orgAdmin.userId,
			student.employeeId,
		);

		asManager();
		const view = await getWorkingStudentMonitorAction({ employeeId: student.employeeId });
		if (!view.success) throw new Error(view.error);
		expect(view.data).toMatchObject({ applies: true, audience: "restricted", priorWeeks: null });
		expect(view.data.lectureFreePeriods).toEqual([
			{ id: expect.any(String), startsOn: "2027-02-01", endsOn: "2027-03-31" },
		]);
		const lecture = view.data.findings.find((f) => f.kind === "working_student_lecture_week");
		expect(lecture).toMatchObject({
			severity: "critical",
			adminDetail: null,
			inputFingerprint: null,
		});
		expect(JSON.stringify(view.data)).not.toMatch(/Exam office letter|"note"/);

		// Neither a scoped manager for someone else nor a plain member can open it.
		const other = await fx.workingStudent(org, "other");
		expect(await getWorkingStudentMonitorAction({ employeeId: other.employeeId })).toMatchObject({
			success: false,
		});
		asMember(peer);
		expect(await getWorkingStudentMonitorAction({ employeeId: student.employeeId })).toMatchObject({
			success: false,
		});
	});

	it("records an audited acknowledgement in Reviews & Conflicts that goes stale when the week changes", async () => {
		const { org, student, orgAdmin, asAdmin, asManager } = await setup();
		const week = addWeeks(currentMonday(), -2);
		await fx.work(org, student, weekdays(week, "09:00", "14:00"));

		asManager();
		expect(await listWorkingStudentReviewsAction()).toMatchObject({ success: false });

		asAdmin();
		const listed = await listWorkingStudentReviewsAction();
		if (!listed.success) throw new Error(listed.error);
		const item = listed.data.find((i) => i.finding.kind === "working_student_lecture_week");
		expect(item).toMatchObject({
			employeeName: "student Test",
			finding: { periodStart: week, severity: "critical", acknowledgement: { status: "none" } },
		});

		expect(
			await acknowledgeWorkingStudentFindingAction({
				employeeId: student.employeeId,
				findingKind: "working_student_lecture_week",
				weekStart: week,
				reason: "   ",
			}),
		).toMatchObject({ success: false, refusal: "statutory_reason_required" });
		expect(
			await acknowledgeWorkingStudentFindingAction({
				employeeId: student.employeeId,
				findingKind: "working_student_lecture_week",
				weekStart: addWeeks(week, -10),
				reason: "Nothing to acknowledge",
			}),
		).toMatchObject({ success: false, refusal: "working_student_finding_not_found" });
		const acknowledged = await acknowledgeWorkingStudentFindingAction({
			employeeId: student.employeeId,
			findingKind: "working_student_lecture_week",
			weekStart: week,
			reason: "Exam-free project week confirmed by the university",
		});
		expect(acknowledged).toMatchObject({
			success: true,
			data: {
				kind: "working_student_over_20h_week",
				findingKind: "working_student_lecture_week",
				acknowledgedBy: orgAdmin.userId,
				inputFingerprint: item?.finding.inputFingerprint,
			},
		});
		const current = await listWorkingStudentReviewsAction();
		expect(
			current.success &&
				current.data.find((i) => i.finding.id === item?.finding.id)?.finding.acknowledgement,
		).toMatchObject({
			status: "current",
			reason: "Exam-free project week confirmed by the university",
		});

		// More work recorded in that week re-opens the finding.
		await fx.work(org, student, [{ date: week, start: "15:00", end: "17:00" }]);
		const stale = await listWorkingStudentReviewsAction();
		expect(
			stale.success &&
				stale.data.find((i) => i.finding.id === item?.finding.id)?.finding.acknowledgement,
		).toMatchObject({ status: "stale" });
	});

	it("gives employees only their own remaining 26-week balance and lecture-free periods", async () => {
		const { org, student, orgAdmin, peer } = await setup();
		const monday = currentMonday();
		await fx.work(org, student, [
			weekendOver20h(addWeeks(monday, -3)),
			weekendOver20h(addWeeks(monday, -1)),
		]);
		await recordWorkingStudentLectureFreePeriodActionAsAdmin(
			org.id,
			orgAdmin.userId,
			student.employeeId,
		);
		await recordEmployeeStatutoryOffset(db, {
			organizationId: org.id,
			employeeId: student.employeeId,
			actorUserId: orgAdmin.userId,
			offsetKind: "prior_working_student_over_20h_weeks",
			firstWeekStartsOn: addWeeks(monday, -20),
			count: 2,
			sourceEmployer: "Previous GmbH",
			note: "Certificate",
		});

		const own = await loadOwnWorkingStudentStatus(db, {
			organizationId: org.id,
			employeeId: student.employeeId,
			now: systemClock.nowInstant(),
		});
		expect(own).toEqual({
			rolling: {
				asOfWeek: expect.stringMatching(/^\d{4}-W\d{2}$/),
				usedWeeks: 4,
				limitWeeks: 26,
				remainingWeeks: 22,
			},
			lectureFreePeriods: [{ startsOn: "2027-02-01", endsOn: "2027-03-31" }],
		});
		expect(JSON.stringify(own)).not.toMatch(/Previous GmbH|Certificate|Exam office|fingerprint/);

		// A colleague who is not a working student has no status at all.
		expect(
			await loadOwnWorkingStudentStatus(db, {
				organizationId: org.id,
				employeeId: peer.employeeId,
				now: Temporal.Now.instant(),
			}),
		).toBeNull();
	});

	async function recordWorkingStudentLectureFreePeriodActionAsAdmin(
		organizationId: string,
		userId: string,
		employeeId: string,
	) {
		const previous = harness.caller;
		harness.caller = {
			userId,
			activeOrganizationId: organizationId,
			membershipRole: "admin",
			employee: null,
		};
		const result = await recordWorkingStudentLectureFreePeriodAction({
			employeeId,
			startsOn: "2027-02-01",
			endsOn: "2027-03-31",
			note: "Exam office letter",
		});
		harness.caller = previous;
		expect(result).toMatchObject({ success: true });
	}
});
