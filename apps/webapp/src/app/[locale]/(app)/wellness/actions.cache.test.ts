import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CACHE_TAGS } from "@/lib/cache/tags";
import { revalidateHydrationStreaksCache } from "./actions";

const mocks = vi.hoisted(() => ({
	revalidateTag: vi.fn(),
}));

vi.mock("next/cache", () => ({
	revalidateTag: mocks.revalidateTag,
	unstable_cache: (fn: unknown) => fn,
}));

const actionsSource = readFileSync(fileURLToPath(new URL("./actions.ts", import.meta.url)), "utf8");

describe("wellness action cache invalidation", () => {
	beforeEach(() => {
		mocks.revalidateTag.mockClear();
	});

	it("revalidates hydration streak leaders for the active organization", () => {
		revalidateHydrationStreaksCache("org-1");

		expect(mocks.revalidateTag).toHaveBeenCalledExactlyOnceWith(
			CACHE_TAGS.HYDRATION_STREAKS("org-1"),
			"max",
		);
	});

	it.each([null, undefined, ""])("does not revalidate without an organization id", (orgId) => {
		revalidateHydrationStreaksCache(orgId);

		expect(mocks.revalidateTag).not.toHaveBeenCalled();
	});

	it("uses the helper for water intake updates and lazy streak resets", () => {
		expect(actionsSource.match(/revalidateHydrationStreaksCache\(activeOrganizationId\)/g)).toHaveLength(
			2,
		);
	});
});
