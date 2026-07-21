import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { member } from "@/db/auth-schema";
import { employee, timeEntry, workPeriod } from "@/db/schema";

vi.mock("@/env", () => ({
	env: {},
}));

vi.mock("@/lib/auth", () => ({
	auth: {
		api: {
			getSession: vi.fn(),
		},
	},
}));

const mockState = vi.hoisted(() => {
	const headers = vi.fn();
	const dbInsert = vi.fn();
	const dbTransaction = vi.fn();

	return {
		headers,
		dbInsert,
		dbTransaction,
	};
});

vi.mock("next/headers", () => ({
	headers: mockState.headers,
}));

vi.mock("@/db", () => ({
	db: {
		insert: mockState.dbInsert,
		transaction: mockState.dbTransaction,
	},
}));

const actions = await import("./actions");
const canonicalActions = await import("./actions.canonical");

describe("time-tracking canonical action routing", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockState.headers.mockResolvedValue({
			get: (name: string) => {
				if (name === "x-forwarded-for") return "203.0.113.10";
				if (name === "user-agent") return "vitest-agent";
				return null;
			},
		});
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("routes standard time entry writes through canonical client", async () => {
		const createTimeEntrySpy = vi
			.spyOn(canonicalActions.canonicalTimeEntryClient, "createTimeEntry")
			.mockResolvedValue({ id: "entry-1" } as never);
		const createCorrectionSpy = vi
			.spyOn(canonicalActions.canonicalTimeEntryClient, "createCorrectionEntry")
			.mockResolvedValue({ id: "entry-corr" } as never);

		const result = await actions.createTimeEntry({
			employeeId: "emp-1",
			organizationId: "org-1",
			type: "clock_in",
			timestamp: new Date("2026-01-01T08:00:00.000Z"),
			createdBy: "user-1",
			notes: "start",
		});

		expect(result).toEqual({ id: "entry-1" });
		expect(createTimeEntrySpy).toHaveBeenCalledWith(
			expect.objectContaining({
				employeeId: "emp-1",
				organizationId: "org-1",
				type: "clock_in",
				createdBy: "user-1",
				ipAddress: "203.0.113.10",
				deviceInfo: "vitest-agent",
			}),
		);
		expect(createCorrectionSpy).not.toHaveBeenCalled();
		expect(mockState.dbInsert).not.toHaveBeenCalled();
	});

	it("routes correction writes through canonical correction client", async () => {
		const createTimeEntrySpy = vi
			.spyOn(canonicalActions.canonicalTimeEntryClient, "createTimeEntry")
			.mockResolvedValue({ id: "entry-1" } as never);
		const createCorrectionSpy = vi
			.spyOn(canonicalActions.canonicalTimeEntryClient, "createCorrectionEntry")
			.mockResolvedValue({ id: "entry-corr" } as never);

		const result = await actions.createTimeEntry({
			employeeId: "emp-1",
			organizationId: "org-1",
			type: "correction",
			timestamp: new Date("2026-01-01T08:30:00.000Z"),
			createdBy: "user-1",
			replacesEntryId: "entry-old",
			workPeriodId: "period-1",
		});

		expect(result).toEqual({ id: "entry-corr" });
		expect(createCorrectionSpy).toHaveBeenCalledWith(
			expect.objectContaining({
				employeeId: "emp-1",
				organizationId: "org-1",
				replacesEntryId: "entry-old",
				workPeriodId: "period-1",
				notes: "",
				ipAddress: "203.0.113.10",
				deviceInfo: "vitest-agent",
			}),
		);
		expect(createTimeEntrySpy).not.toHaveBeenCalled();
		expect(mockState.dbInsert).not.toHaveBeenCalled();
	});

	it("delegates a correction with its work period through the real service", async () => {
		const period = {
			id: "period-1",
			employeeId: "emp-1",
			organizationId: "org-1",
			clockInId: "entry-old",
			clockOutId: "entry-out",
			startTime: new Date("2026-01-01T08:00:00.000Z"),
			endTime: new Date("2026-01-01T17:00:00.000Z"),
			canonicalRecordId: null,
		};
		const original = {
			id: "entry-old",
			employeeId: "emp-1",
			organizationId: "org-1",
			isSuperseded: false,
		};
		const created = { id: "entry-corr" };
		const select = vi.fn(() => ({
			from: vi.fn((table: unknown) => ({
				where: vi.fn(() => {
					const rows =
						table === employee
							? [
									{
										id: "emp-1",
										userId: "user-1",
										organizationId: "org-1",
										isActive: true,
										role: "employee",
									},
								]
							: table === member
								? [{ id: "member-1" }]
								: table === workPeriod
									? [period]
									: table === timeEntry
										? [original]
										: [];
					return {
						for: vi.fn().mockResolvedValue(rows),
						orderBy: vi.fn(() => ({
							for: vi.fn().mockResolvedValue(rows),
							limit: vi
								.fn()
								.mockResolvedValue([{ id: "entry-previous", hash: "hash" }]),
						})),
					};
				}),
			})),
		}));
		const update = vi.fn((table: unknown) => ({
			set: vi.fn(() => ({
				where: vi.fn(() =>
					table === timeEntry || table === workPeriod
						? { returning: vi.fn().mockResolvedValue([{ id: "updated" }]) }
						: Promise.resolve(),
				),
			})),
		}));
		const transaction = {
			insert: vi.fn(() => ({
				values: vi.fn(() => ({
					returning: vi.fn().mockResolvedValue([created]),
				})),
			})),
			query: {
				approvalRequest: { findFirst: vi.fn().mockResolvedValue(null) },
				approvalWorkflow: { findFirst: vi.fn().mockResolvedValue(null) },
			},
			select,
			update,
		};

		await expect(
			actions.createTimeEntry(
				{
					employeeId: "emp-1",
					organizationId: "org-1",
					type: "correction",
					timestamp: new Date("2026-01-01T08:30:00.000Z"),
					createdBy: "user-1",
					replacesEntryId: "entry-old",
					workPeriodId: "period-1",
					utcOffsetMinutes: 0,
					timezone: "UTC",
					timezoneSource: "user_setting",
				},
				transaction as never,
			),
		).resolves.toEqual(created);
		expect(select).toHaveBeenCalled();
		expect(update).toHaveBeenCalledWith(workPeriod);
	});

	it("persists canonical work records with project allocation", async () => {
		const valuesRecord = vi.fn().mockReturnValue({
			returning: vi.fn().mockResolvedValue([{ id: "record-1" }]),
		});
		const valuesWork = vi.fn().mockResolvedValue(undefined);
		const valuesAllocation = vi.fn().mockResolvedValue(undefined);

		const txInsert = vi
			.fn()
			.mockReturnValueOnce({ values: valuesRecord })
			.mockReturnValueOnce({ values: valuesWork })
			.mockReturnValueOnce({ values: valuesAllocation });

		mockState.dbTransaction.mockImplementation(
			async (callback: (tx: { insert: typeof txInsert }) => Promise<unknown>) =>
				callback({ insert: txInsert }),
		);

		const result =
			await canonicalActions.canonicalWorkRecordClient.createForCompletedPeriod(
				{
					organizationId: "org-1",
					employeeId: "emp-1",
					startAt: new Date("2026-01-01T08:00:00.000Z"),
					endAt: new Date("2026-01-01T16:00:00.000Z"),
					durationMinutes: 480,
					approvalState: "approved",
					createdBy: "user-1",
					workCategoryId: "wc-1",
					projectId: "project-1",
					origin: "clock",
				},
			);

		expect(result).toEqual({ id: "record-1" });
		expect(mockState.dbTransaction).toHaveBeenCalledTimes(1);
		expect(txInsert).toHaveBeenCalledTimes(3);
		expect(valuesWork).toHaveBeenCalledWith(
			expect.objectContaining({
				recordId: "record-1",
				organizationId: "org-1",
				workCategoryId: "wc-1",
			}),
		);
		expect(valuesAllocation).toHaveBeenCalledWith(
			expect.objectContaining({
				recordId: "record-1",
				organizationId: "org-1",
				allocationKind: "project",
				projectId: "project-1",
				weightPercent: 100,
			}),
		);
	});

	it("uses a caller-owned transaction for canonical work records", async () => {
		const valuesRecord = vi.fn().mockReturnValue({
			returning: vi.fn().mockResolvedValue([{ id: "record-1" }]),
		});
		const valuesWork = vi.fn().mockResolvedValue(undefined);
		const txInsert = vi
			.fn()
			.mockReturnValueOnce({ values: valuesRecord })
			.mockReturnValueOnce({ values: valuesWork });
		const tx = { insert: txInsert };

		const result =
			await canonicalActions.canonicalWorkRecordClient.createForCompletedPeriod(
				{
					organizationId: "org-1",
					employeeId: "emp-1",
					startAt: new Date("2026-01-01T08:00:00.000Z"),
					endAt: new Date("2026-01-01T16:00:00.000Z"),
					durationMinutes: 480,
					approvalState: "approved",
					createdBy: "user-1",
					origin: "clock",
				},
				tx as never,
			);

		expect(result).toEqual({ id: "record-1" });
		expect(txInsert).toHaveBeenCalledTimes(2);
		expect(mockState.dbTransaction).not.toHaveBeenCalled();
	});
});
