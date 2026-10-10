import { Temporal } from "temporal-polyfill";
import { describe, expect, it } from "vitest";
import { mondayToFriday } from "@/lib/absences/absence-days";
import {
	buildCoverReturnSummaryNotification,
	buildCoverStartedNotification,
	isReturnSummaryDue,
} from "./cover-summaries";

const day = (value: string) => Temporal.PlainDate.from(value);

describe("isReturnSummaryDue", () => {
	// 2026-03-13 is a Friday.
	const absence = { endDate: "2026-03-13" };

	it("is not due on or before the absence's last day", () => {
		for (const today of ["2026-03-12", "2026-03-13"]) {
			expect(
				isReturnSummaryDue({
					today: day(today),
					absenceEndDate: absence.endDate,
					otherAbsences: [],
					isWorkingDay: mondayToFriday,
				}),
			).toBe(false);
		}
	});

	it("skips the weekend and is due on the first working day after the absence", () => {
		const due = (today: string) =>
			isReturnSummaryDue({
				today: day(today),
				absenceEndDate: absence.endDate,
				otherAbsences: [],
				isWorkingDay: mondayToFriday,
			});
		expect(due("2026-03-14")).toBe(false);
		expect(due("2026-03-15")).toBe(false);
		expect(due("2026-03-16")).toBe(true);
	});

	it("skips a holiday Monday and is due on Tuesday", () => {
		const holidayMonday = (value: Temporal.PlainDate) =>
			mondayToFriday(value) && value.toString() !== "2026-03-16";
		expect(
			isReturnSummaryDue({
				today: day("2026-03-16"),
				absenceEndDate: absence.endDate,
				otherAbsences: [],
				isWorkingDay: holidayMonday,
			}),
		).toBe(false);
		expect(
			isReturnSummaryDue({
				today: day("2026-03-17"),
				absenceEndDate: absence.endDate,
				otherAbsences: [],
				isWorkingDay: holidayMonday,
			}),
		).toBe(true);
	});

	it("waits while a back-to-back absence runs, then is due on the first working day after it", () => {
		const otherAbsences = [{ startDate: "2026-03-16", endDate: "2026-03-18" }];
		const due = (today: string) =>
			isReturnSummaryDue({
				today: day(today),
				absenceEndDate: absence.endDate,
				otherAbsences,
				isWorkingDay: mondayToFriday,
			});
		expect(due("2026-03-16")).toBe(false);
		expect(due("2026-03-18")).toBe(false);
		expect(due("2026-03-19")).toBe(true);
	});

	it("is due 14 days after the absence when the approver has no working day", () => {
		const never = () => false;
		const due = (today: string) =>
			isReturnSummaryDue({
				today: day(today),
				absenceEndDate: absence.endDate,
				otherAbsences: [],
				isWorkingDay: never,
			});
		expect(due("2026-03-26")).toBe(false);
		expect(due("2026-03-27")).toBe(true);
		expect(due("2026-04-02")).toBe(true);
	});

	it("counts the 14-day cap from the end of the last back-to-back absence", () => {
		const never = () => false;
		const otherAbsences = [{ startDate: "2026-03-14", endDate: "2026-03-20" }];
		const due = (today: string) =>
			isReturnSummaryDue({
				today: day(today),
				absenceEndDate: absence.endDate,
				otherAbsences,
				isWorkingDay: never,
			});
		expect(due("2026-03-27")).toBe(false);
		expect(due("2026-04-03")).toBe(true);
	});
});

describe("buildCoverStartedNotification", () => {
	const base = {
		organizationId: "org-1",
		recipientUserId: "user-y",
		absentName: "Xenia",
		approverEmployeeId: "employee-x",
		absenceId: "absence-1",
		deputyEmployeeId: "employee-y",
	};

	it("tells the deputy how many approvals wait, linking to the Covering for section", () => {
		const params = buildCoverStartedNotification({ ...base, pendingCount: 3 });
		expect(params).toMatchObject({
			userId: "user-y",
			organizationId: "org-1",
			type: "approval_cover_started",
			title: "You're covering approvals",
			message: "You're covering Xenia's approvals: 3 waiting.",
			actionUrl: "/approvals/inbox#covering-employee-x",
			idempotencyKey: "approval-cover-started:absence-1:employee-y",
			entityType: "absence_entry",
			entityId: "absence-1",
		});
		expect(params.metadata).toMatchObject({
			absenceId: "absence-1",
			absentEmployeeId: "employee-x",
			pendingCount: 3,
			i18n: {
				titleKey: "common:notifications.content.approvalCoverStarted.title",
				messageKey: "common:notifications.content.approvalCoverStarted.message",
				params: { name: "Xenia", count: 3 },
			},
		});
	});

	it("says nothing is waiting yet when the count is zero", () => {
		expect(buildCoverStartedNotification({ ...base, pendingCount: 0 }).message).toBe(
			"You're covering Xenia's approvals: nothing waiting yet.",
		);
	});
});

describe("buildCoverReturnSummaryNotification", () => {
	it("tells the approver what their deputy decided, linking to those decisions", () => {
		const params = buildCoverReturnSummaryNotification({
			organizationId: "org-1",
			recipientUserId: "user-x",
			deputyName: "Yusuf",
			absenceId: "absence-1",
			deputyEmployeeId: "employee-y",
			decisionCount: 2,
		});
		expect(params).toMatchObject({
			userId: "user-x",
			type: "approval_cover_return_summary",
			title: "Decided while you were away",
			message: "While you were away, Yusuf decided 2 approvals.",
			actionUrl: "/approvals/deputy-decisions/absence-1?deputy=employee-y",
			idempotencyKey: "approval-cover-return:absence-1:employee-y",
			entityType: "absence_entry",
			entityId: "absence-1",
		});
		expect(params.metadata).toMatchObject({
			decisionCount: 2,
			i18n: {
				titleKey: "common:notifications.content.approvalCoverReturnSummary.title",
				messageKey: "common:notifications.content.approvalCoverReturnSummary.message",
				params: { name: "Yusuf", count: 2 },
			},
		});
	});

	it("uses the singular for one decision", () => {
		expect(
			buildCoverReturnSummaryNotification({
				organizationId: "org-1",
				recipientUserId: "user-x",
				deputyName: "Yusuf",
				absenceId: "absence-1",
				deputyEmployeeId: "employee-y",
				decisionCount: 1,
			}).message,
		).toBe("While you were away, Yusuf decided 1 approval.");
	});
});
