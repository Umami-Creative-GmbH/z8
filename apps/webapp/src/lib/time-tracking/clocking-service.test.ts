import { describe, expect, it } from "vitest";
import { parseInstant } from "@/lib/datetime/temporal-core";
import { ClockingConflictError, createClockingService } from "./clocking-service";

function createHarness(options?: { member?: boolean; failPeriodInsert?: boolean }) {
	let active = false;
	let entries = 0;
	let previous = Promise.resolve();
	const service = createClockingService({
		transaction: async (callback) => {
			const wait = previous;
			let release!: () => void;
			previous = new Promise((resolve) => { release = resolve; });
			await wait;
			try { return await callback({
			lockEmployee: async () => undefined,
			isOrganizationMember: async () => options?.member ?? true,
			getActivePeriod: async () => (active ? { id: "period-1", startTime: new Date("2026-07-10T08:00:00Z") } : null),
			getLatestHash: async () => null,
			insertEntry: async (entry) => ({ id: `entry-${++entries}`, ...entry }),
			insertActivePeriod: async () => {
			if (options?.failPeriodInsert) throw new Error("period insert failed");
			active = true;
			return { id: "period-1" };
			},
			closeActivePeriod: async () => {
			active = false;
			return { id: "period-1" };
			},
			}); } finally { release(); }
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
	it("serializes simultaneous clock-ins so exactly one creates an active period", async () => {
		const { service, entries } = createHarness();
		const results = await Promise.allSettled([service.clockIn(clockIn), service.clockIn(clockIn)]);

		expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
		expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
		expect(entries()).toBe(1);
		const rejected = results.find((result) => result.status === "rejected");
		expect(rejected).toMatchObject({ reason: expect.any(ClockingConflictError) });
	});

	it("rejects an employee outside the requested organization before writing", async () => {
		const { service, entries } = createHarness({ member: false });

		await expect(service.clockIn(clockIn)).rejects.toThrow("Employee does not belong to organization");
		expect(entries()).toBe(0);
	});

	it("rolls back the entry when creating its work period fails", async () => {
		const inserted: string[] = [];
		const service = createClockingService({
			transaction: async (callback) => {
				const snapshot = [...inserted];
				try { return await callback({ lockEmployee: async () => undefined, isOrganizationMember: async () => true, getActivePeriod: async () => null, getLatestHash: async () => null, insertEntry: async () => { inserted.push("entry"); return { id: "entry-1" }; }, insertActivePeriod: async () => { throw new Error("period insert failed"); }, closeActivePeriod: async () => ({ id: "period-1" }) }); } catch (error) { inserted.splice(0, inserted.length, ...snapshot); throw error; }
			},
		});

		await expect(service.clockIn(clockIn)).rejects.toThrow("period insert failed");
		expect(inserted).toEqual([]);
	});
});
