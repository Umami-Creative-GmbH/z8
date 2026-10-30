import { afterAll, expect, test, vi } from "vitest";
import { pool } from "../index";
import { getPostgresPoolAcquisitionTimeout } from "../postgres-pool-config";

vi.mock("@/env", () => ({
	env: {
		NODE_ENV: "test",
		POSTGRES_POOL_ACQUISITION_TIMEOUT_MS: "60000",
	},
}));

afterAll(() => pool.end());

test("the actual pool uses the configured sixty-second acquisition timeout", () => {
	expect(pool.options.connectionTimeoutMillis).toBe(60000);
});

test("the pool timeout remains ten seconds when unset or empty", () => {
	expect(getPostgresPoolAcquisitionTimeout({})).toBe(10000);
	expect(
		getPostgresPoolAcquisitionTimeout({
			POSTGRES_POOL_ACQUISITION_TIMEOUT_MS: "",
		}),
	).toBe(10000);
});

test.each(["0", "-1", "1.5", "invalid", " ", "2147483648", "9007199254740992"])(
	"invalid pool timeout %s is rejected even when env schema validation is skipped",
	(value) => {
		expect(() =>
			getPostgresPoolAcquisitionTimeout({
				POSTGRES_POOL_ACQUISITION_TIMEOUT_MS: value,
			}),
		).toThrow("POSTGRES_POOL_ACQUISITION_TIMEOUT_MS");
	},
);
