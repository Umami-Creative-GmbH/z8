import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parsePlainDate } from "@/lib/datetime/temporal-core";
import { loadPersonnelIdentifierClashes } from "./personnel-identifier-clashes";

const mocks = vi.hoisted(() => ({
	records: vi.fn(),
	otherEmployees: vi.fn(),
	clashes: vi.fn(),
}));

vi.mock("@/db", async () => ({
	timeRecord: (await import("@/db/schema")).timeRecord,
	db: { selectDistinct: () => ({ from: () => ({ where: mocks.records }) }) },
}));
vi.mock("@/lib/payroll-export/payout-and-expense-employees", () => ({
	employeesWithPayoutsOrExpenseLines: mocks.otherEmployees,
}));
vi.mock("@/lib/payroll-export/personnel-identifier-store", () => ({
	findPersonnelIdentifierClashes: mocks.clashes,
}));

const input = {
	organizationId: "org-1",
	configs: ["datev_lohn", "lexware_lohn", "sage_lohn"].map((formatId) => ({
		formatId,
		config: { personnelNumberType: "employeeNumber" },
	})),
	period: {
		start: new Date("2026-09-01T00:00:00Z"),
		end: new Date("2026-09-30T23:59:59Z"),
	},
	from: parsePlainDate("2026-09-01"),
	asOf: parsePlainDate("2026-09-30"),
};

function clash(format: string) {
	return { employees: [{ employeeId: format, identifier: "001" }] };
}

describe("payroll readiness identifier checks", () => {
	beforeEach(() => {
		vi.resetAllMocks();
		mocks.records.mockResolvedValue([{ employeeId: "worked" }]);
		mocks.otherEmployees.mockResolvedValue(new Set(["payout-only"]));
		mocks.clashes.mockImplementation(async (_db, request) => [
			clash(request.configs[0].formatId),
		]);
	});
	afterEach(() => vi.useRealTimers());

	it("keeps each format's employees, organization and period isolated", async () => {
		mocks.otherEmployees.mockImplementation(
			async ({ formatId }) => new Set([formatId]),
		);
		const result = await loadPersonnelIdentifierClashes(input);
		expect(result).toEqual(
			input.configs.map(({ formatId }) => clash(formatId)),
		);
		for (const config of input.configs) {
			expect(mocks.otherEmployees).toHaveBeenCalledWith({
				organizationId: input.organizationId,
				formatId: config.formatId,
				filters: expect.objectContaining({ dateRange: expect.any(Object) }),
			});
			expect(mocks.clashes).toHaveBeenCalledWith(expect.any(Object), {
				organizationId: input.organizationId,
				configs: [config],
				employeeIds: ["worked", config.formatId],
				asOf: input.asOf,
			});
		}
	});

	it("measures three formats with two 20ms read stages per format", async () => {
		vi.useFakeTimers();
		mocks.otherEmployees.mockImplementation(
			() =>
				new Promise((resolve) =>
					setTimeout(() => resolve(new Set(["payout-only"])), 20),
				),
		);
		mocks.clashes.mockImplementation(
			(_db, request) =>
				new Promise((resolve) =>
					setTimeout(() => resolve([clash(request.configs[0].formatId)]), 20),
				),
		);
		const started = Date.now();
		const pending = loadPersonnelIdentifierClashes(input).then((result) => ({
			result,
			elapsed: Date.now() - started,
		}));
		await vi.runAllTimersAsync();
		const { elapsed, result } = await pending;
		expect(result).toEqual(
			input.configs.map(({ formatId }) => clash(formatId)),
		);
		expect(elapsed).toBe(80);
	});

	it("bounds active formats and preserves order when the second finishes first", async () => {
		const gates = input.configs.map(() => {
			let resolve!: (value: Set<string>) => void;
			const promise = new Promise<Set<string>>((done) => {
				resolve = done;
			});
			return { promise, resolve };
		});
		mocks.otherEmployees.mockImplementation(
			({ formatId }) =>
				gates[input.configs.findIndex((config) => config.formatId === formatId)]
					.promise,
		);
		const pending = loadPersonnelIdentifierClashes(input);
		await vi.waitFor(() =>
			expect(mocks.otherEmployees).toHaveBeenCalledTimes(2),
		);
		gates[1].resolve(new Set(["second"]));
		await vi.waitFor(() =>
			expect(mocks.otherEmployees).toHaveBeenCalledTimes(3),
		);
		gates[2].resolve(new Set(["third"]));
		gates[0].resolve(new Set(["first"]));
		await expect(pending).resolves.toEqual(
			input.configs.map(({ formatId }) => clash(formatId)),
		);
	});

	it("joins started reads before rejecting without returning partial blockers", async () => {
		const failure = new Error("read failed");
		let release!: (value: Set<string>) => void;
		const gate = new Promise<Set<string>>((resolve) => {
			release = resolve;
		});
		mocks.otherEmployees
			.mockRejectedValueOnce(failure)
			.mockReturnValueOnce(gate);
		let settled = false;
		const pending = loadPersonnelIdentifierClashes({
			...input,
			configs: input.configs.slice(0, 2),
		}).catch((error) => {
			settled = true;
			return error;
		});
		await vi.waitFor(() =>
			expect(mocks.otherEmployees).toHaveBeenCalledTimes(2),
		);
		expect(settled).toBe(false);
		release(new Set(["second"]));
		await expect(pending).resolves.toBe(failure);
		expect(mocks.clashes).toHaveBeenCalledTimes(1);
	});

	it("does no database work for an empty configuration list", async () => {
		await expect(
			loadPersonnelIdentifierClashes({ ...input, configs: [] }),
		).resolves.toEqual([]);
		expect(mocks.records).not.toHaveBeenCalled();
	});
});
