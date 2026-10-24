import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
	createShiftDatabaseFixture,
	type ShiftDatabaseFixture,
	type ShiftTestOrganization,
} from "@/lib/scheduling/testing/shift-database.test.fixture";

const harness = vi.hoisted(() => ({
	userId: null as string | null,
	organizationId: null as string | null,
	now: "2026-10-23T22:30:00Z",
}));

vi.mock("next/headers", async () => (await import("@/test/integration-harness")).nextHeaders());

vi.mock("next/server", async (importOriginal) =>
	(await import("@/test/integration-harness")).nextServer(importOriginal),
);

vi.mock("next/cache", async (importOriginal) =>
	(await import("@/test/integration-harness")).nextCache(importOriginal),
);

vi.mock("@/lib/auth", () => ({
	auth: {
		api: {
			getSession: async () =>
				harness.userId
					? {
							user: { id: harness.userId, role: "user" },
							session: {
								id: `t1458-dashboard-${harness.userId}`,
								userId: harness.userId,
								activeOrganizationId: harness.organizationId,
							},
						}
					: null,
		},
	},
}));

vi.mock("@/lib/billing/guard", async () =>
	(await import("@/test/integration-harness")).billingGuard(),
);

import { eq } from "drizzle-orm";
import {
	absenceCategory,
	absenceEntry,
	holiday,
	holidayAssignment,
	holidayCategory,
	workPolicy,
	workPolicyAssignment,
	workPolicySchedule,
} from "@/db/schema";
import type { ServerWidgetId } from "./dashboard-types";

const { readDashboardWidget } = await import("./dashboard-reads");
vi.mock("@/lib/datetime/temporal-core", async (importOriginal) => {
	const original = await importOriginal<typeof import("@/lib/datetime/temporal-core")>();
	return {
		...original,
		systemClock: { nowInstant: () => original.parseInstant(harness.now) },
	};
});

describe("scoped scheduling and absence Dashboard snapshots", () => {
	vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });
	let fixture: ShiftDatabaseFixture;
	let org: ShiftTestOrganization;
	let viewer: Awaited<ReturnType<ShiftDatabaseFixture["seedEmployee"]>>;
	let absentWest: typeof viewer;
	let absentEast: typeof viewer;
	let ownShift: string;
	let rangeId: string;
	let westDuty: string;
	let eastDuty: string;
	let categoryId: string;
	beforeAll(async () => {
		fixture = await createShiftDatabaseFixture();
		org = await fixture.organization("Europe/Berlin");
		viewer = await fixture.seedEmployee({ organizationId: org.organizationId });
		absentWest = await fixture.seedEmployee({ organizationId: org.organizationId });
		absentEast = await fixture.seedEmployee({ organizationId: org.organizationId });
		await fixture.pool.query(`update organization set shifts_enabled=true where id=$1`, [
			org.organizationId,
		]);
		await fixture.pool.query(
			`insert into user_settings (user_id,timezone,updated_at) values ($1,'America/Los_Angeles',now()),($2,'Pacific/Kiritimati',now())`,
			[absentWest.userId, absentEast.userId],
		);
		const [category] = await fixture.db
			.insert(absenceCategory)
			.values({ organizationId: org.organizationId, type: "vacation", name: "Vacation" })
			.returning();
		categoryId = category.id;
		const absence = async (
			employeeId: string,
			startDate: string,
			endDate: string,
			deputyEmployeeId: string | null = null,
		) => {
			const [row] = await fixture.db
				.insert(absenceEntry)
				.values({
					organizationId: org.organizationId,
					employeeId,
					categoryId,
					startDate,
					endDate,
					status: "approved",
					deputyEmployeeId,
				})
				.returning();
			return row.id;
		};
		westDuty = await absence(absentWest.employeeId, "2026-10-24", "2026-10-24", viewer.employeeId);
		eastDuty = await absence(absentEast.employeeId, "2026-10-24", "2026-10-24", viewer.employeeId);
		rangeId = await absence(absentWest.employeeId, "2026-10-26", "2026-10-30");
		await fixture.db
			.update(absenceEntry)
			.set({ startPeriod: "pm", endPeriod: "am" })
			.where(eq(absenceEntry.id, rangeId));
		await absence(absentEast.employeeId, "2026-10-27", "2026-10-27");
		for (const [preset, start, end] of [
			["weekdays", null, "2026-10-27T23:59:59.999Z"],
			["weekends", "2026-10-28T00:00:00Z", null],
		] as const) {
			const [policy] = await fixture.db
				.insert(workPolicy)
				.values({
					organizationId: org.organizationId,
					name: preset,
					scheduleEnabled: true,
					createdBy: org.creator.userId,
				})
				.returning();
			await fixture.db.insert(workPolicySchedule).values({
				policyId: policy.id,
				scheduleType: "simple",
				workingDaysPreset: preset,
				scheduleCycle: "weekly",
			});
			await fixture.db.insert(workPolicyAssignment).values({
				organizationId: org.organizationId,
				policyId: policy.id,
				assignmentType: "employee",
				employeeId: absentWest.employeeId,
				priority: 2,
				effectiveFrom: start ? new Date(start) : null,
				effectiveUntil: end ? new Date(end) : null,
				createdBy: org.creator.userId,
			});
		}
		const [holidays] = await fixture.db
			.insert(holidayCategory)
			.values({
				organizationId: org.organizationId,
				type: "public_holiday",
				name: "Local",
				excludeFromCalculations: true,
			})
			.returning();
		for (const [date, employeeId] of [
			["2026-10-26", absentEast.employeeId],
			["2026-10-27", absentWest.employeeId],
		]) {
			const [day] = await fixture.db
				.insert(holiday)
				.values({
					organizationId: org.organizationId,
					categoryId: holidays.id,
					name: date,
					startDate: new Date(`${date}T00:00:00Z`),
					endDate: new Date(`${date}T00:00:00Z`),
					createdBy: org.creator.userId,
				})
				.returning();
			await fixture.db.insert(holidayAssignment).values({
				organizationId: org.organizationId,
				holidayId: day.id,
				assignmentType: "employee",
				employeeId,
				createdBy: org.creator.userId,
			});
		}
		ownShift = await fixture.shift(org, {
			employeeId: viewer.employeeId,
			stored: "2026-10-23T22:00:00Z",
			startTime: "22:00",
			endTime: "06:00",
		});
		await fixture.shift(org, {
			employeeId: viewer.employeeId,
			stored: "2026-10-23T22:00:00Z",
			status: "draft",
		});
		await fixture.shift(org, { employeeId: absentEast.employeeId, stored: "2026-10-23T22:00:00Z" });
		const foreign = await fixture.organization("UTC");
		await fixture.shift(foreign, { employeeId: viewer.employeeId, stored: "2026-10-24T00:00:00Z" });
	});
	beforeEach(() => {
		harness.now = "2026-10-23T22:30:00Z";
		harness.userId = null;
		harness.organizationId = org.organizationId;
	});
	afterAll(async () => fixture?.close());
	async function read<K extends ServerWidgetId>(
		id: K,
		role: "employee" | "manager" | "admin" = "employee",
	) {
		const snapshot = await readDashboardWidget(id, {
			userId: viewer.userId,
			organizationId: org.organizationId,
			employee: { id: viewer.employeeId, role, organizationId: org.organizationId },
		});
		if (!snapshot.result.success) throw new Error(snapshot.result.error);
		expect(await Response.json(snapshot).json()).toEqual(snapshot);
		return snapshot.result.data;
	}
	it("reuses the trusted actor and original shift loader at organization midnight, excluding draft, colleague and foreign shifts", async () => {
		const data = await read("upcoming-shifts");
		expect(data?.today).toBe("2026-10-24");
		expect(data?.shifts.map((row) => row.id)).toEqual([ownShift]);
		expect(data?.shifts[0]).toMatchObject({
			date: "2026-10-24",
			startTime: "22:00",
			endTime: "06:00",
			locationName: "Store",
			subareaName: "Floor",
		});
	});
	it("retains the absent employee's timezone and category privacy for the deputy", async () => {
		const data = await read("covering-for");
		expect(data?.running.map((duty) => duty.absenceId)).toEqual([eastDuty]);
		expect(data?.upcoming.map((duty) => duty.absenceId)).toEqual([westDuty]);
		expect(data?.running[0].category).toBeNull();
		expect(data?.upcoming[0].category).toBeNull();
		expect((await read("covering-for", "admin"))?.running[0].category?.name).toBe("Vacation");
	});
	it("uses the organization's today for out-today selection and retains holiday/future-absence return dates", async () => {
		const data = await read("whos-out-today");
		expect(data?.totalOut).toBe(2);
		expect(data?.outToday.find((row) => row.id === absentEast.employeeId)?.returnDate).toBe(
			"2026-10-28",
		);
		expect(data?.returningTomorrow).toEqual([]);
	});
	it("resolves half days across policy changes and assigned holidays without changing calendar dates or using the viewer zone", async () => {
		const data = await read("upcoming-time-off");
		const range = data?.find((row) => row.id === rangeId);
		expect(range).toMatchObject({
			startDate: "2026-10-26",
			endDate: "2026-10-30",
			absenceDays: 0.5,
			daysUntil: 3,
		});
	});
	it("preserves a recurring leap-day holiday when the return search crosses a non-leap year", async () => {
		harness.now = "2027-02-28T23:00:00Z";
		const [row] = await fixture.db
			.insert(absenceEntry)
			.values({
				organizationId: org.organizationId,
				employeeId: absentEast.employeeId,
				categoryId,
				startDate: "2027-03-01",
				endDate: "2028-02-28",
				status: "approved",
			})
			.returning();
		const [category] = await fixture.db
			.insert(holidayCategory)
			.values({
				organizationId: org.organizationId,
				type: "public_holiday",
				name: "Recurring",
				excludeFromCalculations: true,
			})
			.returning();
		const [day] = await fixture.db
			.insert(holiday)
			.values({
				organizationId: org.organizationId,
				categoryId: category.id,
				name: "Leap day",
				startDate: new Date("2024-02-29T00:00:00Z"),
				endDate: new Date("2024-02-29T00:00:00Z"),
				recurrenceType: "yearly",
				recurrenceRule: JSON.stringify({ month: 2, day: 29 }),
				createdBy: org.creator.userId,
			})
			.returning();
		try {
			const data = await read("whos-out-today");
			expect(
				data?.outToday.find((employee) => employee.id === absentEast.employeeId)?.returnDate,
			).toBe("2028-03-01");
		} finally {
			await fixture.db.delete(absenceEntry).where(eq(absenceEntry.id, row.id));
			await fixture.db.delete(holiday).where(eq(holiday.id, day.id));
			await fixture.db.delete(holidayCategory).where(eq(holidayCategory.id, category.id));
		}
	});

	it("observes an absence status change on the next reads without a shared cache delay", async () => {
		await fixture.db
			.update(absenceEntry)
			.set({ status: "pending" })
			.where(eq(absenceEntry.id, westDuty));
		try {
			expect((await read("covering-for"))?.upcoming).toEqual([]);
			expect((await read("upcoming-time-off"))?.some((row) => row.id === westDuty)).toBe(false);
			expect((await read("whos-out-today"))?.totalOut).toBe(1);
		} finally {
			await fixture.db
				.update(absenceEntry)
				.set({ status: "approved" })
				.where(eq(absenceEntry.id, westDuty));
		}
	});
	it("observes deputy reassignment without hiding the approved absence from out-today data", async () => {
		await fixture.db
			.update(absenceEntry)
			.set({ deputyEmployeeId: null })
			.where(eq(absenceEntry.id, eastDuty));
		try {
			expect((await read("covering-for"))?.running).toEqual([]);
			expect((await read("whos-out-today"))?.totalOut).toBe(2);
		} finally {
			await fixture.db
				.update(absenceEntry)
				.set({ deputyEmployeeId: viewer.employeeId })
				.where(eq(absenceEntry.id, eastDuty));
		}
	});

	it("observes a new schedule status immediately and respects disabled shifts on the next request", async () => {
		await fixture.pool.query(`update shift set status='draft' where id=$1`, [ownShift]);
		try {
			expect((await read("upcoming-shifts"))?.shifts).toEqual([]);
		} finally {
			await fixture.pool.query(`update shift set status='published' where id=$1`, [ownShift]);
		}
		await fixture.pool.query(`update organization set shifts_enabled=false where id=$1`, [
			org.organizationId,
		]);
		try {
			expect(await read("upcoming-shifts")).toBeNull();
		} finally {
			await fixture.pool.query(`update organization set shifts_enabled=true where id=$1`, [
				org.organizationId,
			]);
		}
	});
});
