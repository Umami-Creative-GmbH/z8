import { describe, expect, it, vi } from "vitest";
import { parseInstant } from "@/lib/datetime/temporal-core";
import { calculateHash } from "./blockchain";
import { type ClockingStore, createClockingService } from "./clocking-core";
import { TimeEntryAppendReviewRequiredError } from "./time-entry-append";
import { sealWorkTransactionScope, type WorkTransactionAdmission } from "./work-transaction";

const scope = {
	organizationId: "organization-1",
	employeeId: "employee-1",
};
const instant = parseInstant("2026-07-10T09:00:00Z");
const predecessor = { id: "entry-tip", hash: "tip-hash" };

function harness(
	admission: WorkTransactionAdmission,
	admitted: Awaited<ReturnType<NonNullable<ClockingStore["admitAppend"]>>> = {
		kind: "admitted",
		append: { predecessor, record: vi.fn(async () => undefined) },
	},
) {
	const transaction = { id: "outer-transaction" };
	const inserted: Record<string, unknown>[] = [];
	const store = {
		transaction,
		acquireAdoptionGate: async () => undefined,
		readAppendAdmission: async () => "legacy" as const,
		lockEmployee: vi.fn(async () => undefined),
		isOrganizationMember: async () => true,
		getEntryByActionId: async (_employeeId: string, _organizationId: string, actionId?: string) =>
			actionId === "committed-action" ? { id: "committed-action", type: "clock_in" } : null,
		getActivePeriod: async () => null,
		getLatestHash: vi.fn(async () => "latest-created-hash"),
		admitAppend: vi.fn(async () => admitted),
		insertEntry: vi.fn(async (entry: Record<string, unknown>) => {
			inserted.push(entry);
			return { id: "entry-new", ...entry };
		}),
		insertActivePeriod: vi.fn(async () => ({ id: "period-new" })),
		closeActivePeriod: async () => null,
	} satisfies ClockingStore;
	const coordination = sealWorkTransactionScope({
		db: transaction as never,
		admission,
		assertEmployee: () => undefined,
	});
	const service = createClockingService({
		transaction: async () => {
			throw new Error("coordinated clocking must not open a transaction");
		},
		storeForCoordinatedTransaction: (context) => {
			expect(context).toBe(coordination);
			return store;
		},
	});
	const clockIn = (actionId?: string) =>
		service.clockIn({
			...scope,
			coordination,
			actionId,
			createdBy: "user-1",
			action: { instant, utcOffsetMinutes: 0, timezone: "UTC", timezoneSource: "browser" },
			source: { ipAddress: null, deviceInfo: "web" },
			workLocationType: "office",
		});
	return { store, inserted, clockIn, admitted };
}

describe("coordinated live clock-in append admission", () => {
	it("appends to the admitted predecessor with both links and records the position", async () => {
		const { store, inserted, clockIn, admitted } = harness("append");

		await clockIn();

		expect(store.admitAppend).toHaveBeenCalledWith(scope, "live_clock_in");
		expect(store.getLatestHash).not.toHaveBeenCalled();
		expect(store.lockEmployee).not.toHaveBeenCalled();
		expect(inserted).toEqual([
			expect.objectContaining({
				previousEntryId: predecessor.id,
				previousHash: predecessor.hash,
				hash: calculateHash({
					employeeId: scope.employeeId,
					type: "clock_in",
					timestamp: "2026-07-10T09:00:00.000Z",
					previousHash: predecessor.hash,
				}),
			}),
		]);
		expect(admitted.kind === "admitted" && admitted.append.record).toHaveBeenCalledWith(
			expect.objectContaining({ id: "entry-new", previousEntryId: predecessor.id }),
		);
		expect(store.insertActivePeriod).toHaveBeenCalledOnce();
	});

	it("returns the scoped review requirement without writing anything", async () => {
		const requirement = {
			...scope,
			reasons: [{ kind: "fork" as const, predecessorId: "a", successorIds: ["b", "c"] }],
		};
		const { store, clockIn } = harness("append", { kind: "review_required", requirement });

		const failure = await clockIn().catch((error: unknown) => error);

		expect(failure).toBeInstanceOf(TimeEntryAppendReviewRequiredError);
		expect((failure as TimeEntryAppendReviewRequiredError).requirement).toEqual(requirement);
		expect(store.insertEntry).not.toHaveBeenCalled();
		expect(store.insertActivePeriod).not.toHaveBeenCalled();
	});

	it("replays a committed action before admission and never advances the tip", async () => {
		const { store, clockIn } = harness("append");

		await expect(clockIn("committed-action")).resolves.toEqual({
			entry: { id: "committed-action", type: "clock_in" },
		});

		expect(store.admitAppend).not.toHaveBeenCalled();
		expect(store.insertEntry).not.toHaveBeenCalled();
	});

	it("keeps the legacy head selection while the scope is inactive", async () => {
		const { store, inserted, clockIn } = harness("legacy");

		await clockIn();

		expect(store.admitAppend).not.toHaveBeenCalled();
		expect(inserted).toEqual([expect.objectContaining({ previousHash: "latest-created-hash" })]);
		expect(inserted[0]).not.toHaveProperty("previousEntryId");
	});
});
