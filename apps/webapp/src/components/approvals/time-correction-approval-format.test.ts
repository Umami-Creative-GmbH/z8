import { describe, expect, it } from "vitest";
import {
	formatCorrectionApprovalInstant,
	formatCorrectionAuditEndpoint,
} from "./time-correction-approval-format";

const instant = new Date("2026-07-10T12:30:00.000Z");

describe("formatCorrectionApprovalInstant", () => {
	it("formats an instant using the approval recipient's explicit profile timezone", () => {
		const newYork = formatCorrectionApprovalInstant(instant, {
			locale: "en-US",
			timezone: "America/New_York",
			timeFormat: "12h",
		});
		const berlin = formatCorrectionApprovalInstant(instant, {
			locale: "en-GB",
			timezone: "Europe/Berlin",
			timeFormat: "24h",
		});

		expect(newYork).toContain("8:30 AM");
		expect(berlin).toContain("14:30");
	});

	it("preserves each audit endpoint's captured offset across recipient zones", () => {
		const context = { locale: "en-US", timezone: "America/New_York", timeFormat: "12h" } as const;

		expect(formatCorrectionAuditEndpoint(instant, 120, context)).toContain("2:30 PM");
		expect(formatCorrectionAuditEndpoint(instant, -240, context)).toContain("8:30 AM");
	});

	it("keeps a boundary instant on the recipient's local calendar date", () => {
		const boundary = new Date("2026-01-01T00:30:00.000Z");

		expect(
			formatCorrectionApprovalInstant(boundary, {
				locale: "en-US",
				timezone: "America/New_York",
				timeFormat: "12h",
			}),
		).toContain("7:30 PM");
		expect(
			formatCorrectionApprovalInstant(boundary, {
				locale: "en-GB",
				timezone: "Europe/Berlin",
				timeFormat: "24h",
			}),
		).toContain("1:30");
	});
});
