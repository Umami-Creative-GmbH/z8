import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	loadVacationBalances: vi.fn(),
	loadWorkingDays: vi.fn(),
}));

vi.mock("./vacation-balance-store", () => ({ loadVacationBalances: mocks.loadVacationBalances }));
vi.mock("./absence-days-resolver", () => ({ loadWorkingDays: mocks.loadWorkingDays }));
vi.mock("@/lib/logger", () => ({
	createLogger: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }),
}));

const { findOverdrawnVacationYears, loadVacationYearBalances } = await import(
	"./vacation-year-balance-store"
);

const database = {} as never;
const currentDate = new Date("2026-10-18T08:00:00Z");

function balance(year: number, remainingDays: number) {
	return {
		year,
		totalDays: 20,
		allowanceDays: 20,
		usedDays: 20 - remainingDays,
		pendingDays: 0,
		remainingDays,
		overdrawnDays: 0,
	};
}

function balancesFor(byYear: Record<number, ReturnType<typeof balance> | "missing" | "conflict">) {
	mocks.loadVacationBalances.mockImplementation(async (_database, input: { year: number }) => {
		const entry = byYear[input.year];
		if (entry === undefined) throw new Error("database unavailable");
		return typeof entry === "string"
			? {
					balances: new Map(),
					configurations: new Map([["emp-1", { status: entry, periods: [] }]]),
				}
			: {
					balances: new Map([["emp-1", entry]]),
					configurations: new Map([["emp-1", { status: "resolved" }]]),
				};
	});
}

describe("loadVacationYearBalances", () => {
	beforeEach(() => vi.clearAllMocks());

	it("reads each year for the employee in the organization at one evaluation time", async () => {
		balancesFor({ 2026: balance(2026, 5), 2027: balance(2027, 20) });

		const evidence = await loadVacationYearBalances(database, {
			organizationId: "org-1",
			employeeId: "emp-1",
			years: [2026, 2027],
			timezone: "Europe/Berlin",
			currentDate,
		});

		expect(evidence).toEqual([
			{ year: 2026, status: "available", balance: balance(2026, 5) },
			{ year: 2027, status: "available", balance: balance(2027, 20) },
		]);
		for (const year of [2026, 2027]) {
			expect(mocks.loadVacationBalances).toHaveBeenCalledWith(database, {
				organizationId: "org-1",
				employeeIds: ["emp-1"],
				year,
				timezone: "Europe/Berlin",
				currentDate,
			});
		}
	});

	it("isolates a missing policy, a conflict and a failed read to their own year", async () => {
		balancesFor({ 2026: "missing", 2027: "conflict", 2029: balance(2029, 3) });

		const evidence = await loadVacationYearBalances(database, {
			organizationId: "org-1",
			employeeId: "emp-1",
			years: [2026, 2027, 2028, 2029],
			timezone: "UTC",
			currentDate,
		});

		expect(evidence).toEqual([
			{ year: 2026, status: "unavailable", reason: "missing_policy" },
			{ year: 2027, status: "unavailable", reason: "conflicting_policy" },
			{ year: 2028, status: "unavailable", reason: "read_failed" },
			{ year: 2029, status: "available", balance: balance(2029, 3) },
		]);
	});
});

describe("findOverdrawnVacationYears", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.loadWorkingDays.mockResolvedValue((day: { dayOfWeek: number }) => day.dayOfWeek <= 5);
	});

	// Wed 2026-12-30 to Sat 2027-01-02: 2 days in 2026, 1 in 2027.
	const acrossNewYear = {
		startDate: "2026-12-30",
		startPeriod: "full_day" as const,
		endDate: "2027-01-02",
		endPeriod: "full_day" as const,
	};

	it("returns the years whose recorded balance the request exceeds", async () => {
		balancesFor({ 2026: balance(2026, 2), 2027: balance(2027, 0.5) });

		const overdrawn = await findOverdrawnVacationYears(database, {
			organizationId: "org-1",
			employeeId: "emp-1",
			absence: acrossNewYear,
			timezone: "Europe/Berlin",
			currentDate,
		});

		expect(overdrawn).toEqual([
			expect.objectContaining({ year: 2027, chargedAbsenceDays: 1, remainingAfterRequest: -0.5 }),
		]);
		expect(mocks.loadWorkingDays).toHaveBeenCalledWith(database, {
			organizationId: "org-1",
			employeeId: "emp-1",
			startDate: "2026-12-30",
			endDate: "2027-01-02",
		});
	});

	it("does not block on a year whose balance is unavailable", async () => {
		balancesFor({ 2026: balance(2026, 2), 2027: "missing" });

		const overdrawn = await findOverdrawnVacationYears(database, {
			organizationId: "org-1",
			employeeId: "emp-1",
			absence: acrossNewYear,
			timezone: "Europe/Berlin",
			currentDate,
		});

		expect(overdrawn).toEqual([]);
	});

	it("does not read the balance of a year the request charges nothing", async () => {
		balancesFor({ 2026: balance(2026, 2) });
		mocks.loadWorkingDays.mockResolvedValue(
			(day: { dayOfWeek: number; year: number }) => day.dayOfWeek <= 5 && day.year === 2026,
		);

		const overdrawn = await findOverdrawnVacationYears(database, {
			organizationId: "org-1",
			employeeId: "emp-1",
			absence: acrossNewYear,
			timezone: "Europe/Berlin",
			currentDate,
		});

		expect(overdrawn).toEqual([]);
		expect(mocks.loadVacationBalances).toHaveBeenCalledTimes(1);
	});
});
