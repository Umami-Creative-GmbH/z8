import { describe, expect, it } from "vitest";
import { manualConfirmationCounts, manualConfirmationFreshness } from "./freshness";

describe("manual confirmation freshness", () => {
	it("is current while the configuration still has the confirmed fingerprint", () => {
		expect(manualConfirmationFreshness({ stored: "abc", current: "abc" })).toBe("current");
	});

	it("is stale once the configuration's fingerprint differs", () => {
		expect(manualConfirmationFreshness({ stored: "abc", current: "def" })).toBe("stale");
	});

	it("dates a confirmation without a fingerprint to before change tracking", () => {
		expect(manualConfirmationFreshness({ stored: null, current: "def" })).toBe(
			"before-change-tracking",
		);
		expect(manualConfirmationFreshness({ stored: null, current: null })).toBe(
			"before-change-tracking",
		);
	});

	it("is unchecked when the current fingerprint could not be worked out", () => {
		expect(manualConfirmationFreshness({ stored: "abc", current: null })).toBe("unchecked");
	});

	it("counts only current confirmations and those made before change tracking", () => {
		expect(manualConfirmationCounts("current")).toBe(true);
		expect(manualConfirmationCounts("before-change-tracking")).toBe(true);
		expect(manualConfirmationCounts("stale")).toBe(false);
		expect(manualConfirmationCounts("unchecked")).toBe(false);
	});
});
