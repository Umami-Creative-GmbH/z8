import { describe, expect, it } from "vitest";
import {
	KIOSK_REFUSAL_ACTIONS,
	KIOSK_REFUSAL_REASONS,
	KIOSK_REFUSAL_TIME_SOURCES,
} from "@/db/schema/kiosk";
import {
	KIOSK_FROZEN_ACTIONS,
	KIOSK_FROZEN_REFUSAL_REASONS,
	KIOSK_TIME_SOURCES,
} from "./frozen-command";
import {
	KIOSK_FROZEN_REFUSALS,
	KIOSK_REFUSAL_EXPLANATIONS,
	kioskRefusalExplanation,
	kioskRefusalStatus,
} from "./frozen-refusal-reasons";

const sorted = (values: readonly string[]) => [...values].sort();

describe("refused frozen kiosk commands", () => {
	it("treat every refusal reason, and the refusal record accepts exactly those values", () => {
		expect(sorted(Object.keys(KIOSK_FROZEN_REFUSALS))).toEqual(
			sorted(KIOSK_FROZEN_REFUSAL_REASONS),
		);
		expect(sorted(KIOSK_REFUSAL_REASONS)).toEqual(sorted(KIOSK_FROZEN_REFUSAL_REASONS));
		expect(sorted(KIOSK_REFUSAL_ACTIONS)).toEqual(sorted(KIOSK_FROZEN_ACTIONS));
		expect(sorted(KIOSK_REFUSAL_TIME_SOURCES)).toEqual(sorted(KIOSK_TIME_SOURCES));
	});

	it("answer every refusal with a final 4xx status and an explanation people read", () => {
		for (const reason of KIOSK_FROZEN_REFUSAL_REASONS) {
			expect(kioskRefusalStatus(reason)).toBeGreaterThanOrEqual(400);
			expect(kioskRefusalStatus(reason)).toBeLessThan(500);
			expect(KIOSK_REFUSAL_EXPLANATIONS).toContain(kioskRefusalExplanation(reason));
		}
		expect(kioskRefusalStatus("pin_locked")).toBe(423);
		expect(kioskRefusalStatus("admission_window")).toBe(422);
		expect(kioskRefusalStatus("already_clocked_in")).toBe(409);
	});

	it("explain a missing PIN and an unverifiable contact on their own", () => {
		expect(kioskRefusalExplanation("no_pin")).toBe("no_pin");
		expect(kioskRefusalExplanation("contact_unverifiable")).toBe("contact_unverifiable");
		expect(kioskRefusalExplanation("kiosk_rotated")).toBe("kiosk_retired");
		expect(kioskRefusalExplanation("access_denied")).toBe("not_assigned");
	});
});
