import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	adminExists: false,
	dbLimit: vi.fn(),
	redisStore: new Map<string, string>(),
	revalidateTag: vi.fn(),
}));

vi.mock("drizzle-orm", () => ({
	eq: vi.fn(),
}));

vi.mock("next/cache", () => ({
	revalidateTag: mocks.revalidateTag,
	unstable_cache: (fn: () => Promise<boolean>) => {
		let hasValue = false;
		let value: boolean;

		return async () => {
			if (!hasValue) {
				value = await fn();
				hasValue = true;
			}

			return value;
		};
	},
}));

vi.mock("@/db", () => ({
	db: {
		select: () => ({
			from: () => ({
				where: () => ({
					limit: mocks.dbLimit,
				}),
			}),
		}),
	},
}));

vi.mock("@/db/auth-schema", () => ({
	user: {
		id: "id",
		role: "role",
	},
}));

vi.mock("@/lib/redis", () => ({
	secondaryStorage: {
		get: vi.fn(async (key: string) => mocks.redisStore.get(key) ?? null),
		set: vi.fn(async (key: string, value: string) => {
			mocks.redisStore.set(key, value);
		}),
		delete: vi.fn(async (key: string) => {
			mocks.redisStore.delete(key);
		}),
	},
}));

vi.mock("../logger", () => ({
	createLogger: () => ({
		info: vi.fn(),
		error: vi.fn(),
	}),
}));

async function loadConfigCache() {
	return import("./config-cache");
}

describe("isPlatformConfigured", () => {
	beforeEach(() => {
		vi.resetModules();
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
		mocks.adminExists = false;
		mocks.redisStore.clear();
		mocks.dbLimit.mockImplementation(async () => (mocks.adminExists ? [{ id: "admin" }] : []));
		mocks.revalidateTag.mockClear();
	});

	it("uses Redis to avoid DB checks across module instances once configured", async () => {
		mocks.adminExists = true;

		const { isPlatformConfigured } = await loadConfigCache();
		await expect(isPlatformConfigured()).resolves.toBe(true);

		vi.resetModules();
		const { isPlatformConfigured: isPlatformConfiguredInFreshModule } = await loadConfigCache();
		await expect(isPlatformConfiguredInFreshModule()).resolves.toBe(true);

		expect(mocks.dbLimit).toHaveBeenCalledTimes(1);
	});
});
