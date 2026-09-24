import { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pool } from "../index";

const mocks = vi.hoisted(() => ({
	io: vi.fn<() => Promise<void>>(),
	startActiveSpan: vi.fn(),
	span: { setStatus: vi.fn(), end: vi.fn(), recordException: vi.fn() },
	logError: vi.fn(),
}));

vi.mock("next/cache", () => ({ io: mocks.io }));
vi.mock("@/lib/logger", () => ({
	createLogger: () => ({ error: mocks.logError }),
}));
vi.mock("@opentelemetry/api", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@opentelemetry/api")>();
	return {
		...actual,
		trace: {
			...actual.trace,
			getTracer: () => ({ startActiveSpan: mocks.startActiveSpan }),
		},
	};
});

describe("database pool prerender boundary", () => {
	afterEach(() => vi.restoreAllMocks());

	beforeEach(() => {
		vi.restoreAllMocks();
		vi.clearAllMocks();
		mocks.io.mockResolvedValue(undefined);
		mocks.startActiveSpan.mockImplementation(
			(_name, _options, callback) => callback(mocks.span),
		);
	});

	it("suspends before tracing or PostgreSQL can generate random IDs", async () => {
		const gate = Promise.withResolvers<void>();
		mocks.io.mockReturnValue(gate.promise);
		const result = { rows: [{ value: 1 }], rowCount: 1 };
		const query = vi.spyOn(Pool.prototype, "query").mockResolvedValue(result);

		const pending = pool.query("select $1::int as value", [1]);
		const beforeResume = {
			ioCalls: mocks.io.mock.calls.length,
			traceCalls: mocks.startActiveSpan.mock.calls.length,
			queryCalls: query.mock.calls.length,
		};
		gate.resolve();
		await expect(pending).resolves.toBe(result);

		expect(beforeResume).toEqual({ ioCalls: 1, traceCalls: 0, queryCalls: 0 });
		expect(query).toHaveBeenCalledWith("select $1::int as value", [1]);
		expect(mocks.span.setStatus).toHaveBeenCalledWith({ code: 1 });
		expect(mocks.span.end).toHaveBeenCalledOnce();
	});

	it("retains query error reporting after the I/O boundary", async () => {
		const error = new Error("database unavailable");
		vi.spyOn(Pool.prototype, "query").mockRejectedValue(error);

		await expect(pool.query("select 1")).rejects.toBe(error);

		expect(mocks.io).toHaveBeenCalledOnce();
		expect(mocks.span.recordException).toHaveBeenCalledWith(error);
		expect(mocks.span.setStatus).toHaveBeenCalledWith({
			code: 2,
			message: String(error),
		});
		expect(mocks.span.end).toHaveBeenCalledOnce();
		expect(mocks.logError).toHaveBeenCalledOnce();
	});

	it("waits for I/O separately for each query on the reused pool", async () => {
		vi.spyOn(Pool.prototype, "query").mockResolvedValue({ rows: [] });

		await pool.query("select 1");
		await pool.query("select 2");

		expect(mocks.io).toHaveBeenCalledTimes(2);
	});

	it("does not execute or log a database error when prerendering is cancelled", async () => {
		const aborted = new Error("prerender cancelled");
		mocks.io.mockRejectedValue(aborted);
		const query = vi.spyOn(Pool.prototype, "query").mockResolvedValue({ rows: [] });

		await expect(pool.query("select 1")).rejects.toBe(aborted);

		expect(query).not.toHaveBeenCalled();
		expect(mocks.startActiveSpan).not.toHaveBeenCalled();
		expect(mocks.logError).not.toHaveBeenCalled();
	});

	it("allows the real Next I/O boundary in standalone workers and scripts", async () => {
		const { io } = await vi.importActual<typeof import("next/cache")>("next/cache");
		mocks.io.mockImplementation(io);
		const result = { rows: [{ value: 1 }] };
		vi.spyOn(Pool.prototype, "query").mockResolvedValue(result);

		await expect(pool.query("select 1 as value")).resolves.toBe(result);
	});
});
