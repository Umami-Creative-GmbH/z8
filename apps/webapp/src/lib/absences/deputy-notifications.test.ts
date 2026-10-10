import { Temporal } from "temporal-polyfill";
import { describe, expect, it } from "vitest";
import {
	buildDeputyNotification,
	buildDeputyReminderNotification,
	type DeputyAbsenceFacts,
	isDeputyReminderDue,
	planDeputyNotices,
} from "./deputy-notifications";

const SAM = "11111111-1111-4111-8111-111111111111";
const DEPUTY = "22222222-2222-4222-8222-222222222222";
const OTHER_DEPUTY = "33333333-3333-4333-8333-333333333333";

function absence(overrides: Partial<DeputyAbsenceFacts> = {}): DeputyAbsenceFacts {
	return {
		id: "absence-1",
		employeeId: SAM,
		deputyEmployeeId: DEPUTY,
		startDate: "2026-10-12",
		endDate: "2026-10-14",
		status: "approved",
		...overrides,
	};
}

function facts(...absences: DeputyAbsenceFacts[]) {
	return new Map(absences.map((entry) => [entry.id, entry]));
}

describe("planDeputyNotices", () => {
	it("names the deputy when an absence is approved, but not while it is pending", () => {
		expect(
			planDeputyNotices([{ kind: "approved", absenceId: "absence-1" }], facts(absence())),
		).toEqual([
			{
				kind: "assigned",
				absence: absence(),
				deputyEmployeeId: DEPUTY,
				occasion: "approved",
			},
		]);
		expect(
			planDeputyNotices(
				[{ kind: "approved", absenceId: "absence-1" }],
				facts(absence({ status: "pending" })),
			),
		).toEqual([]);
		expect(
			planDeputyNotices(
				[{ kind: "approved", absenceId: "absence-1" }],
				facts(absence({ deputyEmployeeId: null })),
			),
		).toEqual([]);
	});

	it("tells the old deputy they were removed and the new one they were named on a swap", () => {
		const notices = planDeputyNotices(
			[
				{
					kind: "deputy_changed",
					absenceId: "absence-1",
					changeId: "change-1",
					from: DEPUTY,
					to: OTHER_DEPUTY,
				},
			],
			facts(absence({ deputyEmployeeId: OTHER_DEPUTY })),
		);
		expect(
			notices.map((notice) => [notice.kind, notice.deputyEmployeeId, notice.occasion]),
		).toEqual([
			["removed", DEPUTY, "change:change-1"],
			["assigned", OTHER_DEPUTY, "change:change-1"],
		]);
	});

	it("tells nobody about a deputy change on a pending absence", () => {
		expect(
			planDeputyNotices(
				[
					{
						kind: "deputy_changed",
						absenceId: "absence-1",
						changeId: "change-1",
						from: DEPUTY,
						to: OTHER_DEPUTY,
					},
				],
				facts(absence({ status: "pending" })),
			),
		).toEqual([]);
	});

	it("tells the deputy they no longer cover a cancelled approved absence", () => {
		expect(
			planDeputyNotices([{ kind: "cancelled", absence: absence() }], new Map()).map((notice) => [
				notice.kind,
				notice.occasion,
			]),
		).toEqual([["removed", "cancelled"]]);
		expect(
			planDeputyNotices(
				[{ kind: "cancelled", absence: absence({ status: "pending" }) }],
				new Map(),
			),
		).toEqual([]);
	});

	it("follows a sick override: new dates, the split-off part, and a rejected approved absence", () => {
		const shortened = absence({ id: "shortened", endDate: "2026-10-12" });
		const splitOff = absence({ id: "split", startDate: "2026-10-14" });
		const rejected = absence({ id: "rejected", status: "rejected" });
		const rejectedPending = absence({ id: "rejected-pending", status: "rejected" });
		const pendingShortened = absence({ id: "pending", status: "pending" });
		const notices = planDeputyNotices(
			[
				{
					kind: "vacation_override",
					summary: {
						updatedAbsenceIds: ["shortened", "pending"],
						createdAbsenceIds: ["split"],
						deletedAbsenceIds: ["rejected", "rejected-pending"],
						overriddenApprovedAbsenceIds: ["rejected"],
					},
				},
			],
			facts(shortened, splitOff, rejected, rejectedPending, pendingShortened),
		);
		expect(notices.map((notice) => [notice.kind, notice.absence.id, notice.occasion])).toEqual([
			["dates_changed", "shortened", "dates:2026-10-12:2026-10-12"],
			["assigned", "split", "approved"],
			["removed", "rejected", "rejected"],
		]);
	});

	it("sends one notice per deputy and occasion when events repeat", () => {
		expect(
			planDeputyNotices(
				[
					{ kind: "approved", absenceId: "absence-1" },
					{ kind: "approved", absenceId: "absence-1" },
				],
				facts(absence()),
			),
		).toHaveLength(1);
	});
});

describe("buildDeputyNotification", () => {
	const base = { organizationId: "org-1", recipientUserId: "user-deputy", absentName: "Sam Lee" };

	it("names the absent person and the dates, keyed per deputy and occasion", () => {
		const params = buildDeputyNotification({
			...base,
			notice: {
				kind: "assigned",
				absence: absence(),
				deputyEmployeeId: DEPUTY,
				occasion: "approved",
			},
		});
		expect(params).toMatchObject({
			userId: "user-deputy",
			organizationId: "org-1",
			type: "absence_deputy_assigned",
			title: "You're an absence deputy",
			message: "You're covering for Sam Lee (12 – 14 Oct 2026).",
			actionUrl: "/",
			idempotencyKey: `absence-deputy-assigned:absence-1:${DEPUTY}:approved`,
			metadata: {
				dateRangeDays: { startDate: "2026-10-12", endDate: "2026-10-14" },
				i18n: {
					titleKey: "common:notifications.content.absenceDeputyAssigned.title",
					messageKey: "common:notifications.content.absenceDeputyAssigned.message",
					params: { name: "Sam Lee", dateRange: "12 – 14 Oct 2026" },
				},
			},
		});
	});

	it("uses its own type and copy for removal and new dates", () => {
		const removed = buildDeputyNotification({
			...base,
			notice: {
				kind: "removed",
				absence: absence(),
				deputyEmployeeId: DEPUTY,
				occasion: "cancelled",
			},
		});
		expect([removed.type, removed.message, removed.idempotencyKey]).toEqual([
			"absence_deputy_removed",
			"You no longer cover for Sam Lee (12 – 14 Oct 2026).",
			`absence-deputy-removed:absence-1:${DEPUTY}:cancelled`,
		]);
		const moved = buildDeputyNotification({
			...base,
			notice: {
				kind: "dates_changed",
				absence: absence({ endDate: "2026-10-12" }),
				deputyEmployeeId: DEPUTY,
				occasion: "dates:2026-10-12:2026-10-12",
			},
		});
		expect([moved.type, moved.message]).toEqual([
			"absence_deputy_dates_changed",
			"Your cover for Sam Lee now runs 12 Oct 2026.",
		]);
	});

	it("never reveals the category or sick detail of the absence", () => {
		const params = buildDeputyNotification({
			...base,
			notice: {
				kind: "assigned",
				absence: absence(),
				deputyEmployeeId: DEPUTY,
				occasion: "approved",
			},
		});
		const text = JSON.stringify(params);
		expect(text).not.toMatch(/category|sick|vacation/i);
		expect(params.entityType).toBeUndefined();
	});
});

describe("buildDeputyReminderNotification", () => {
	it("tells the deputy whom they cover from tomorrow and until when, once per start date", () => {
		const params = buildDeputyReminderNotification({
			organizationId: "org-1",
			recipientUserId: "user-deputy",
			absentName: "Sam Lee",
			absence: absence(),
			deputyEmployeeId: DEPUTY,
		});
		expect(params).toMatchObject({
			type: "absence_deputy_reminder",
			title: "Absence cover starts tomorrow",
			message: "From tomorrow you're covering for Sam Lee until 14 Oct 2026.",
			actionUrl: "/",
			idempotencyKey: `absence-deputy-reminder:absence-1:${DEPUTY}:2026-10-12`,
			metadata: {
				untilDay: "2026-10-14",
				i18n: { params: { name: "Sam Lee", untilDate: "14 Oct 2026" } },
			},
		});
	});
});

describe("isDeputyReminderDue", () => {
	const now = Temporal.Instant.from("2026-10-11T10:30:00Z");

	it("is due on the day before the start in the absent employee's zone", () => {
		// 2026-10-12 00:30 in Kiritimati (UTC+14), still 2026-10-11 in Berlin.
		expect(isDeputyReminderDue({ startDate: "2026-10-12", timezone: "Europe/Berlin", now })).toBe(
			true,
		);
		expect(
			isDeputyReminderDue({ startDate: "2026-10-12", timezone: "Pacific/Kiritimati", now }),
		).toBe(false);
		expect(
			isDeputyReminderDue({ startDate: "2026-10-13", timezone: "Pacific/Kiritimati", now }),
		).toBe(true);
	});
});
