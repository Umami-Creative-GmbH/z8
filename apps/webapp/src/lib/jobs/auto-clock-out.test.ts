import { describe, expect, it, vi } from "vitest";
import { parseInstant } from "@/lib/datetime/temporal-core";
import type { AutoClockOutScanState } from "@/lib/time-tracking/automatic-clock-out/scan-state";
import type { AutoClockOutCandidate } from "@/lib/time-tracking/automatic-clock-out/types";
import { runAutoClockOutMaintenanceWith } from "./auto-clock-out";

const logs = vi.hoisted(() => ({
	warn: vi.fn(),
	error: vi.fn(),
	info: vi.fn(),
}));
vi.mock("@/lib/logger", () => ({ createLogger: () => logs }));
const now = parseInstant("2026-10-25T06:04:00Z");
const candidate = (id: number): AutoClockOutCandidate => ({
	organizationId: "org",
	employeeId: `employee-${id}`,
	workPeriodId: `period-${id}`,
});
const tasks = { claimed: 1, completed: 1, deferred: 0, failed: 0 };
function setup(count = 2) {
	let after: AutoClockOutCandidate | null = null;
	const scanState: AutoClockOutScanState = {
		claim: async () => ({ token: "token", after }),
		advance: async (input) => {
			after = input.after;
		},
		release: async (input) => {
			after = input.after;
		},
	};
	const candidates = Array.from({ length: count }, (_, i) => candidate(i));
	const deps = {
		clock: { nowInstant: () => now },
		scanState,
		listCandidates: vi.fn(async (input: { after: AutoClockOutCandidate | null; limit: number }) => {
			const offset = input.after
				? candidates.findIndex((c) => c.workPeriodId === input.after?.workPeriodId) + 1
				: 0;
			return candidates.slice(offset, offset + input.limit);
		}),
		close: vi.fn(async (_target: AutoClockOutCandidate) => ({
			status: "closed" as const,
			operationId: "op",
			clockOutEntryId: "entry",
		})),
		deliverTasks: vi.fn(async () => tasks),
	};
	return deps;
}

describe("automatic clock-out maintenance", () => {
	it("advances past a failed employee, closes the next, and recovers tasks without exposing errors", async () => {
		const deps = setup();
		deps.close.mockRejectedValueOnce(new Error("secret SQL token"));
		const result = await runAutoClockOutMaintenanceWith(deps);
		expect(result).toMatchObject({ attempted: 2, closed: 1, failed: 1, tasks });
		expect(result.errors).toEqual([
			{
				organizationId: "org",
				workPeriodId: "period-0",
				error: "automatic_clock_out_failed",
			},
		]);
		expect(
			JSON.stringify([logs.error.mock.calls, logs.warn.mock.calls, logs.info.mock.calls]),
		).not.toContain("secret SQL token");
	});
	it("rotates beyond the 1000-candidate cap despite an always-failing prefix and wraps only next run", async () => {
		const deps = setup(1002);
		deps.close.mockImplementation(async (target) => {
			if (target.workPeriodId === "period-0") throw new Error("persistent failure");
			return { status: "closed", operationId: "op", clockOutEntryId: "entry" };
		});
		expect(await runAutoClockOutMaintenanceWith(deps)).toMatchObject({
			attempted: 1000,
			closed: 999,
			failed: 1,
		});
		expect((await deps.scanState.claim(now))?.after).toEqual(candidate(999));
		expect(await runAutoClockOutMaintenanceWith(deps)).toMatchObject({
			attempted: 2,
			closed: 2,
		});
		expect(deps.close.mock.calls.slice(-2).map(([c]) => c.workPeriodId)).toEqual([
			"period-1000",
			"period-1001",
		]);
		expect((await deps.scanState.claim(now))?.after).toBeNull();
		expect(deps.listCandidates.mock.calls.every(([input]) => input.limit === 100)).toBe(true);
	});
	it.each(["empty", "held"])("recovers tasks when discovery is %s", async (state) => {
		const deps = setup(0);
		if (state === "held") deps.scanState.claim = async () => null;
		expect(await runAutoClockOutMaintenanceWith(deps)).toMatchObject({
			attempted: 0,
			tasks,
		});
		expect(deps.deliverTasks).toHaveBeenCalledOnce();
		if (state === "held") expect(deps.listCandidates).not.toHaveBeenCalled();
	});
	it("stops candidate pages on lost ownership but still recovers independently leased tasks", async () => {
		const deps = setup(101);
		const { AutoClockOutScanLeaseNotOwnedError } = await import(
			"@/lib/time-tracking/automatic-clock-out/scan-state"
		);
		deps.scanState.advance = async () => {
			throw new AutoClockOutScanLeaseNotOwnedError();
		};
		deps.scanState.release = async () => {
			throw new AutoClockOutScanLeaseNotOwnedError();
		};
		expect(await runAutoClockOutMaintenanceWith(deps)).toMatchObject({
			attempted: 100,
			tasks,
		});
		expect(deps.close).toHaveBeenCalledTimes(100);
	});
	it("stops within a page if the lease expires during a close", async () => {
		const deps = setup();
		let at = now;
		deps.clock.nowInstant = () => at;
		deps.close.mockImplementation(async () => {
			at = now.add({ minutes: 5 });
			return { status: "closed", operationId: "op", clockOutEntryId: "entry" };
		});
		expect(await runAutoClockOutMaintenanceWith(deps)).toMatchObject({
			attempted: 1,
			tasks,
		});
	});
	it.each(["claim", "list", "release"])(
		"recovers tasks even after %s infrastructure failure, then fails safely",
		async (step) => {
			const deps = setup(0);
			const fail = async (): Promise<never> => {
				throw new Error("secret connection string");
			};
			if (step === "claim") deps.scanState.claim = fail;
			if (step === "list") deps.listCandidates.mockImplementation(fail);
			if (step === "release") deps.scanState.release = fail;
			await expect(runAutoClockOutMaintenanceWith(deps)).rejects.toThrow(
				"Automatic clock-out discovery failed",
			);
			expect(deps.deliverTasks).toHaveBeenCalledOnce();
		},
	);
	it("counts replay as skipped and records only known refusal classifications", async () => {
		const deps = setup(3);
		const close = vi
			.fn()
			.mockResolvedValueOnce({ status: "replayed" })
			.mockResolvedValueOnce({
				status: "deferred",
				reason: "append_review_required",
			})
			.mockResolvedValueOnce({ status: "deferred", reason: "secret text" });
		const result = await runAutoClockOutMaintenanceWith({ ...deps, close });
		expect(result).toMatchObject({
			attempted: 3,
			closed: 0,
			skipped: 1,
			deferred: 2,
		});
		expect(result.errors.map((e) => e.error)).toEqual([
			"append_review_required",
			"automatic_clock_out_refused",
		]);
	});
});
