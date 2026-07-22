import { describe, expect, it, vi } from "vitest";
import { parseInstant } from "@/lib/datetime/temporal-core";
import {
	ClockingConflictError,
	createClockingService,
} from "./clocking-service";

function createHarness(options?: {
	member?: boolean;
	failPeriodInsert?: boolean;
}) {
	let active = false;
	let entries = 0;
	const actions = new Map<string, { id: string; [key: string]: unknown }>();
	let completedPeriod: {
		id: string;
		startTime: Date;
		endTime: Date;
		durationMinutes: number;
		projectId: string | null;
		workCategoryId: string | null;
	} | null = null;
	let previous = Promise.resolve();
	const service = createClockingService({
		transaction: async (callback) => {
			const wait = previous;
			let release!: () => void;
			previous = new Promise((resolve) => {
				release = resolve;
			});
			await wait;
			try {
				return await callback({
					lockEmployee: async () => undefined,
					isOrganizationMember: async () => options?.member ?? true,
					getEntryByActionId: async (_employeeId, _organizationId, actionId) =>
						actionId ? (actions.get(actionId) ?? null) : null,
					getActivePeriod: async () =>
						active
							? { id: "period-1", startTime: new Date("2026-07-10T08:00:00Z") }
							: null,
					getCompletedPeriodByClockOutActionId: async (
						_employeeId,
						_organizationId,
						_actionId,
						workPeriodId,
					) =>
						completedPeriod &&
						(!workPeriodId || completedPeriod.id === workPeriodId)
							? completedPeriod
							: null,
					getLatestHash: async () => null,
					insertEntry: async (entry) => {
						const inserted = { id: `entry-${++entries}`, ...entry };
						if (typeof entry.id === "string") actions.set(entry.id, inserted);
						return inserted;
					},
					insertActivePeriod: async () => {
						if (options?.failPeriodInsert)
							throw new Error("period insert failed");
						active = true;
						return { id: "period-1" };
					},
					closeActivePeriod: async (
						_id,
						_employeeId,
						_organizationId,
						patch,
					) => {
						active = false;
						completedPeriod = {
							id: "period-1",
							startTime: new Date("2026-07-10T08:00:00Z"),
							endTime: patch.endTime as Date,
							durationMinutes: patch.durationMinutes as number,
							projectId: (patch.projectId as string | null) ?? null,
							workCategoryId: (patch.workCategoryId as string | null) ?? null,
						};
						return { id: "period-1" };
					},
				});
			} finally {
				release();
			}
		},
	});
	return { service, entries: () => entries };
}

const clockIn = {
	employeeId: "employee-1",
	organizationId: "organization-1",
	createdBy: "user-1",
	action: {
		instant: parseInstant("2026-07-10T09:00:00Z"),
		utcOffsetMinutes: -600,
		timezone: "Pacific/Honolulu",
		timezoneSource: "user_setting" as const,
	},
	source: { ipAddress: "bot", deviceInfo: "telegram-bot" },
};

describe("clocking service", () => {
	it("uses a caller-owned transaction for the complete clock-out boundary", async () => {
		const transaction = { id: "approval-transaction" };
		const hooks: unknown[] = [];
		let openedTransactions = 0;
		const store = {
			transaction,
			lockEmployee: async () => undefined,
			isOrganizationMember: async () => true,
			getEntryByActionId: async () => null,
			getActivePeriod: async () => ({
				id: "period-1",
				startTime: new Date("2026-07-10T08:00:00Z"),
			}),
			getLatestHash: async () => null,
			insertEntry: async () => ({ id: "entry-1" }),
			insertActivePeriod: async () => ({ id: "period-1" }),
			closeActivePeriod: async () => ({ id: "period-1" }),
		};
		const service = createClockingService({
			transaction: async (callback) => {
				openedTransactions += 1;
				return callback(store);
			},
			storeForTransaction: (candidate) => {
				expect(candidate).toBe(transaction);
				return store;
			},
		});

		await service.clockOut({
			...clockIn,
			transaction,
			beforePeriodClose: async (context) => {
				hooks.push(context.transaction);
				return undefined;
			},
			afterPeriodClose: async (context) => {
				hooks.push(context.transaction);
			},
		});

		expect(openedTransactions).toBe(0);
		expect(hooks).toEqual([transaction, transaction]);
	});

	it("scopes period closure to the employee and organization", async () => {
		const closeActivePeriod = vi.fn(async () => ({ id: "period-1" }));
		const service = createClockingService({
			transaction: async (callback) =>
				callback({
					lockEmployee: async () => undefined,
					isOrganizationMember: async () => true,
					getEntryByActionId: async () => null,
					getActivePeriod: async () => ({
						id: "period-1",
						startTime: new Date("2026-07-10T08:00:00Z"),
					}),
					getLatestHash: async () => null,
					insertEntry: async () => ({ id: "entry-1" }),
					insertActivePeriod: async () => ({ id: "period-1" }),
					closeActivePeriod,
				}),
		});

		await service.clockOut(clockIn);

		expect(closeActivePeriod).toHaveBeenCalledWith(
			"period-1",
			"employee-1",
			"organization-1",
			expect.objectContaining({ isActive: false }),
		);
	});

	it("serializes simultaneous clock-ins so exactly one creates an active period", async () => {
		const { service, entries } = createHarness();
		const results = await Promise.allSettled([
			service.clockIn(clockIn),
			service.clockIn(clockIn),
		]);

		expect(
			results.filter((result) => result.status === "fulfilled"),
		).toHaveLength(1);
		expect(
			results.filter((result) => result.status === "rejected"),
		).toHaveLength(1);
		expect(entries()).toBe(1);
		const rejected = results.find((result) => result.status === "rejected");
		expect(rejected).toMatchObject({
			reason: expect.any(ClockingConflictError),
		});
	});

	it("returns the original entry for a repeated extension action id without another write", async () => {
		const { service, entries } = createHarness();
		const action = {
			...clockIn,
			actionId: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
		};

		const first = await service.clockIn(action);
		const duplicate = await service.clockIn(action);

		expect(duplicate.entry).toEqual(first.entry);
		expect(entries()).toBe(1);
	});

	it("returns a complete replay result for a repeated clock-out action id", async () => {
		const { service, entries } = createHarness();
		await service.clockIn(clockIn);
		const action = {
			...clockIn,
			actionId: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
			workPeriodId: "period-1",
		};

		const first = await service.clockOut(action);
		const duplicate = await service.clockOut(action);

		expect(first.disposition).toBe("executed");
		expect(duplicate).toMatchObject({
			entry: first.entry,
			period: { id: "period-1" },
			durationMinutes: 60,
			disposition: "replayed",
		});
		expect(entries()).toBe(2);
	});

	it("rejects a clock-out action id that belongs to a clock-in entry", async () => {
		const { service } = createHarness();
		const actionId = "f47ac10b-58cc-4372-a567-0e02b2c3d479";
		await service.clockIn({ ...clockIn, actionId });

		await expect(
			service.clockOut({ ...clockIn, actionId, workPeriodId: "period-1" }),
		).rejects.toThrow(ClockingConflictError);
	});

	it("rejects an employee outside the requested organization before writing", async () => {
		const { service, entries } = createHarness({ member: false });

		await expect(service.clockIn(clockIn)).rejects.toThrow(
			"Employee does not belong to organization",
		);
		expect(entries()).toBe(0);
	});

	it("rolls back the entry when creating its work period fails", async () => {
		const inserted: string[] = [];
		const service = createClockingService({
			transaction: async (callback) => {
				const snapshot = [...inserted];
				try {
					return await callback({
						lockEmployee: async () => undefined,
						isOrganizationMember: async () => true,
						getEntryByActionId: async () => null,
						getActivePeriod: async () => null,
						getLatestHash: async () => null,
						insertEntry: async () => {
							inserted.push("entry");
							return { id: "entry-1" };
						},
						insertActivePeriod: async () => {
							throw new Error("period insert failed");
						},
						closeActivePeriod: async () => ({ id: "period-1" }),
					});
				} catch (error) {
					inserted.splice(0, inserted.length, ...snapshot);
					throw error;
				}
			},
		});

		await expect(service.clockIn(clockIn)).rejects.toThrow(
			"period insert failed",
		);
		expect(inserted).toEqual([]);
	});
});
