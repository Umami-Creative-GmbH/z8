import { DynamicServerError } from "next/dist/client/components/hooks-server-context";
import { makeUntrackedHangingPromise } from "next/dist/server/dynamic-rendering-utils";
import { notFound, redirect } from "next/navigation";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { getPrimaryEligibleManagerIdForRequester } from "@/lib/approvals/policies/manager-eligibility-db";
import { getEmployeeWorkBalance } from "@/lib/work-balance/service";
import type { EmployeeWorkBalancePayload } from "@/lib/work-balance/types";
import { readTimeSummary, readWorkPeriods } from "./read-queries";
import {
	getSafeEmployeeWorkBalance,
	readHistoryRegion,
	readSummaryRegion,
} from "./region-data";
import type { EmployeeRenderContext } from "./render-context";

vi.mock("@/db", () => ({ db: {} }));
vi.mock("@/lib/approvals/policies/manager-eligibility-db", () => ({
	getPrimaryEligibleManagerIdForRequester: vi.fn(),
}));
vi.mock("@/lib/work-balance/service", () => ({
	getEmployeeWorkBalance: vi.fn(),
}));
vi.mock("./read-queries", () => ({
	readTimeSummary: vi.fn(),
	readWorkPeriods: vi.fn(),
}));

const scope = { employeeId: "employee-1", organizationId: "org-1" };
const employeeContext = {
	userId: "user-1",
	employeeName: "Test Employee",
	employee: { id: scope.employeeId, organizationId: scope.organizationId },
	membershipRole: "admin",
	timezone: "Europe/Berlin",
	weekStartDay: "monday",
	timeFormat: "24h",
} as EmployeeRenderContext;
const expectedSummary = {
	todayMinutes: 60,
	weekMinutes: 180,
	monthMinutes: 200,
};
const expectedBalance: EmployeeWorkBalancePayload = {
	...scope,
	actualMinutes: 180,
	requiredMinutes: 240,
	balanceMinutes: -60,
	computedFromDate: "2026-03-23",
	computedThroughDate: "2026-03-30",
	computedAt: new Date("2026-03-30T10:00:00Z"),
};

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

beforeEach(() => {
	vi.resetAllMocks();
	vi.spyOn(console, "error").mockImplementation(() => {});
	vi.mocked(readTimeSummary).mockResolvedValue(expectedSummary);
	vi.mocked(getEmployeeWorkBalance).mockResolvedValue(expectedBalance);
	vi.mocked(readWorkPeriods).mockResolvedValue([]);
	vi.mocked(getPrimaryEligibleManagerIdForRequester).mockResolvedValue(
		"manager-1",
	);
});
afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
});

describe("independent time tracking region data", () => {
	it("summary resolves without starting pending history or manager work", async () => {
		vi.mocked(readWorkPeriods).mockReturnValue(new Promise(() => {}));
		vi.mocked(getPrimaryEligibleManagerIdForRequester).mockReturnValue(
			new Promise(() => {}),
		);
		expect(await readSummaryRegion(employeeContext)).toEqual({
			summary: expectedSummary,
			workBalance: expectedBalance,
		});
		expect(readTimeSummary).toHaveBeenCalledWith(
			scope,
			"Europe/Berlin",
			"monday",
		);
		expect(getEmployeeWorkBalance).toHaveBeenCalledWith(scope);
		expect(readWorkPeriods).not.toHaveBeenCalled();
		expect(getPrimaryEligibleManagerIdForRequester).not.toHaveBeenCalled();
	});

	it("starts summary and balance concurrently", async () => {
		const summary = deferred<typeof expectedSummary>();
		const balance = deferred<EmployeeWorkBalancePayload>();
		vi.mocked(readTimeSummary).mockReturnValue(summary.promise);
		vi.mocked(getEmployeeWorkBalance).mockReturnValue(balance.promise);
		const result = readSummaryRegion(employeeContext);
		expect(readTimeSummary).toHaveBeenCalledOnce();
		expect(getEmployeeWorkBalance).toHaveBeenCalledOnce();
		balance.resolve(expectedBalance);
		summary.resolve(expectedSummary);
		expect(await result).toEqual({
			summary: expectedSummary,
			workBalance: expectedBalance,
		});
	});

	it("history resolves without starting pending summary or balance work", async () => {
		vi.mocked(readTimeSummary).mockReturnValue(new Promise(() => {}));
		vi.mocked(getEmployeeWorkBalance).mockReturnValue(new Promise(() => {}));
		expect(await readHistoryRegion(employeeContext)).toEqual({
			workPeriods: [],
			hasManager: true,
			canApproveTimeEntries: true,
		});
		expect(getPrimaryEligibleManagerIdForRequester).toHaveBeenCalledWith({
			db,
			requesterEmployeeId: scope.employeeId,
			organizationId: scope.organizationId,
		});
		expect(readTimeSummary).not.toHaveBeenCalled();
		expect(getEmployeeWorkBalance).not.toHaveBeenCalled();
	});

	it("starts history and manager eligibility concurrently", async () => {
		const history = deferred<Awaited<ReturnType<typeof readWorkPeriods>>>();
		const manager = deferred<string | null>();
		vi.mocked(readWorkPeriods).mockReturnValue(history.promise);
		vi.mocked(getPrimaryEligibleManagerIdForRequester).mockReturnValue(
			manager.promise,
		);
		const result = readHistoryRegion(employeeContext);
		expect(readWorkPeriods).toHaveBeenCalledOnce();
		expect(getPrimaryEligibleManagerIdForRequester).toHaveBeenCalledOnce();
		history.resolve([]);
		manager.resolve("manager-1");
		expect(await result).toEqual({
			workPeriods: [],
			hasManager: true,
			canApproveTimeEntries: true,
		});
	});

	it.each([
		["owner", true],
		["admin", true],
		["manager", false],
		["employee", false],
		["admin,employee", false],
	])(
		"preserves %s membership approval capability",
		async (membershipRole, canApproveTimeEntries) => {
			expect(
				await readHistoryRegion({ ...employeeContext, membershipRole }),
			).toMatchObject({ canApproveTimeEntries });
		},
	);

	it("returns false manager eligibility when none exists", async () => {
		vi.mocked(getPrimaryEligibleManagerIdForRequester).mockResolvedValue(null);
		expect(await readHistoryRegion(employeeContext)).toMatchObject({
			hasManager: false,
		});
	});

	it.each([
		[
			"2026-03-30T10:00:00Z",
			"sunday",
			"2026-03-28T23:00:00Z",
			"2026-04-04T21:59:59.999Z",
		],
		[
			"2026-03-30T10:00:00Z",
			"monday",
			"2026-03-29T22:00:00Z",
			"2026-04-05T21:59:59.999Z",
		],
		[
			"2026-03-29T10:00:00Z",
			"monday",
			"2026-03-22T23:00:00Z",
			"2026-03-29T21:59:59.999Z",
		],
	] as const)(
		"preserves Berlin %s %s history boundaries through DST",
		async (now, weekStartDay, start, end) => {
			vi.useFakeTimers();
			vi.setSystemTime(new Date(now));
			await readHistoryRegion({ ...employeeContext, weekStartDay });
			expect(readWorkPeriods).toHaveBeenCalledWith(
				scope,
				new Date(start),
				new Date(end),
			);
		},
	);

	it("lets summary and history service failures escape to their region", async () => {
		const failure = new Error("service unavailable");
		vi.mocked(readTimeSummary).mockRejectedValue(failure);
		await expect(readSummaryRegion(employeeContext)).rejects.toBe(failure);
		vi.mocked(readWorkPeriods).mockRejectedValue(failure);
		await expect(readHistoryRegion(employeeContext)).rejects.toBe(failure);
		vi.mocked(readWorkPeriods).mockResolvedValue([]);
		vi.mocked(getPrimaryEligibleManagerIdForRequester).mockRejectedValue(
			failure,
		);
		await expect(readHistoryRegion(employeeContext)).rejects.toBe(failure);
	});
});

describe("safe employee work balance", () => {
	it("preserves loaded and absent balances", async () => {
		expect(await getSafeEmployeeWorkBalance(scope)).toBe(expectedBalance);
		vi.mocked(getEmployeeWorkBalance).mockResolvedValue(null);
		expect(await getSafeEmployeeWorkBalance(scope)).toBeNull();
		expect(console.error).not.toHaveBeenCalled();
	});

	it.each([
		new Error("private session token"),
		{ session: "private session token" },
	])(
		"uses null fallback and safe metadata for ordinary errors",
		async (error) => {
			vi.mocked(getEmployeeWorkBalance).mockRejectedValue(error);
			expect(await readSummaryRegion(employeeContext)).toEqual({
				summary: expectedSummary,
				workBalance: null,
			});
			expect(console.error).toHaveBeenCalledExactlyOnceWith(
				"Failed to load employee work balance",
				scope,
			);
		},
	);

	it.each([
		["redirect", () => redirect("/de/login")],
		["not found", () => notFound()],
		[
			"prerender",
			() => {
				throw new DynamicServerError("prerender dynamic access");
			},
		],
	])(
		"rethrows real Next.js %s control flow without logging",
		async (_name, throwControlFlow) => {
			let error: unknown;
			try {
				throwControlFlow();
			} catch (caught) {
				error = caught;
			}
			vi.mocked(getEmployeeWorkBalance).mockRejectedValue(error);
			await expect(getSafeEmployeeWorkBalance(scope)).rejects.toBe(error);
			expect(console.error).not.toHaveBeenCalled();
		},
	);

	it("rethrows Next.js control flow nested in an error cause", async () => {
		const error = new Error("service wrapper", {
			cause: new DynamicServerError("prerender dynamic access"),
		});
		vi.mocked(getEmployeeWorkBalance).mockRejectedValue(error);
		await expect(getSafeEmployeeWorkBalance(scope)).rejects.toBe(error.cause);
		expect(console.error).not.toHaveBeenCalled();
	});

	it("rethrows Next.js aborted prerender hanging promises without logging", async () => {
		const controller = new AbortController();
		const hanging =
			makeUntrackedHangingPromise<EmployeeWorkBalancePayload | null>(
				controller.signal,
				"/de/time-tracking",
				"work balance",
			);
		vi.mocked(getEmployeeWorkBalance).mockReturnValue(hanging);
		const result = getSafeEmployeeWorkBalance(scope);
		controller.abort();
		const error = await hanging.catch((caught: unknown) => caught);
		await expect(result).rejects.toBe(error);
		expect(console.error).not.toHaveBeenCalled();
	});
});
