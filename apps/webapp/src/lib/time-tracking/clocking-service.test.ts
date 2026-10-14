import { describe, expect, it } from "vitest";
import { parseInstant } from "@/lib/datetime/temporal-core";
import {
	ClockingAppendAdoptedError,
	ClockingConflictError,
	createClockingService,
} from "./clocking-service";

// Clocking core only starts live work: every clock-out hands its live work to
// work records, which creates the completed work (#1222).

function createHarness(options?: {
	member?: boolean;
	failPeriodInsert?: boolean;
}) {
	const organization = { admission: "legacy" as "legacy" | "append" };
	const trace: string[] = [];
	let active = false;
	let entries = 0;
	const actions = new Map<string, { id: string; [key: string]: unknown }>();
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
					acquireAdoptionGate: async (organizationId) => {
						trace.push(`adoption-gate:${organizationId}`);
					},
					readAppendAdmission: async () => organization.admission,
					hasCompletedWorkEndingAfter: async () => false,
					lockEmployee: async (employeeId) => {
						trace.push(`employee:${employeeId}`);
					},
					isOrganizationMember: async () => options?.member ?? true,
					getEntryByActionId: async (_employeeId, _organizationId, actionId) =>
						actionId ? (actions.get(actionId) ?? null) : null,
					getActivePeriod: async () =>
						active
							? { id: "period-1", startTime: new Date("2026-07-10T08:00:00Z") }
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
				});
			} finally {
				release();
			}
		},
	});
	return { service, entries: () => entries, organization, trace };
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
	workLocationType: "office" as const,
};

describe("clocking service", () => {
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
						acquireAdoptionGate: async () => undefined,
						readAppendAdmission: async () => "legacy" as const,
						hasCompletedWorkEndingAfter: async () => false,
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

// #327: a writer outside a work-transaction coordinator (the legacy direct
// route) cannot write fresh entries into an employee graph whose organization
// has adopted appends.
describe("uncoordinated writers in an adopted organization", () => {
	const actionId = "f47ac10b-58cc-4372-a567-0e02b2c3d479";

	it("takes the shared adoption gate before the employee key", async () => {
		const { service, trace } = createHarness();

		await service.clockIn(clockIn);

		expect(trace).toEqual(["adoption-gate:organization-1", "employee:employee-1"]);
	});

	it("refuses a fresh clock-in before writing anything", async () => {
		const { service, entries, organization } = createHarness();
		organization.admission = "append";

		await expect(service.clockIn({ ...clockIn, actionId })).rejects.toThrow(
			ClockingAppendAdoptedError,
		);
		expect(entries()).toBe(0);
	});

	it("still answers a committed clock-in replay after adoption", async () => {
		const { service, entries, organization } = createHarness();
		const first = await service.clockIn({ ...clockIn, actionId });
		organization.admission = "append";

		await expect(service.clockIn({ ...clockIn, actionId })).resolves.toMatchObject({
			entry: first.entry,
		});
		expect(entries()).toBe(1);
	});

	it("leaves coordinated writers to their coordinator's admission", async () => {
		const trace: string[] = [];
		const transaction = { id: "coordinated" };
		const service = createClockingService({
			transaction: async () => {
				throw new Error("coordinated writers never open their own transaction");
			},
			storeForCoordinatedTransaction: () => ({
				transaction,
				acquireAdoptionGate: async () => {
					trace.push("adoption-gate");
				},
				readAppendAdmission: async () => "append",
				hasCompletedWorkEndingAfter: async () => false,
				lockEmployee: async () => {
					trace.push("employee");
				},
				isOrganizationMember: async () => true,
				getEntryByActionId: async () => null,
				getActivePeriod: async () => null,
				getLatestHash: async () => null,
				insertEntry: async () => ({ id: "entry-1" }),
				insertActivePeriod: async () => ({ id: "period-1" }),
			}),
		});

		await service.clockIn({
			...clockIn,
			coordination: {
				db: transaction,
				admission: "legacy",
				assertEmployee: () => undefined,
			} as never,
		});

		expect(trace).toEqual([]);
	});
});
