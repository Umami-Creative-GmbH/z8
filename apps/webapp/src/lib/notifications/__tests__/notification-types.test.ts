/**
 * Tests for notification type constants and validation
 */

import { describe, expect, it } from "bun:test";
import { NOTIFICATION_CHANNELS, NOTIFICATION_TYPES } from "../types";

describe("Notification Types", () => {
	describe("NOTIFICATION_TYPES", () => {
		it("contains all expected approval types", () => {
			expect(NOTIFICATION_TYPES).toContain("approval_request_submitted");
			expect(NOTIFICATION_TYPES).toContain("approval_request_approved");
			expect(NOTIFICATION_TYPES).toContain("approval_request_rejected");
		});

		it("contains all expected time correction types", () => {
			expect(NOTIFICATION_TYPES).toContain("time_correction_submitted");
			expect(NOTIFICATION_TYPES).toContain("time_correction_approved");
			expect(NOTIFICATION_TYPES).toContain("time_correction_rejected");
		});

		it("contains all expected absence types", () => {
			expect(NOTIFICATION_TYPES).toContain("absence_request_submitted");
			expect(NOTIFICATION_TYPES).toContain("absence_request_approved");
			expect(NOTIFICATION_TYPES).toContain("absence_request_rejected");
		});

		it("contains all expected team types", () => {
			expect(NOTIFICATION_TYPES).toContain("team_member_added");
			expect(NOTIFICATION_TYPES).toContain("team_member_removed");
		});

		it("contains all expected security types", () => {
			expect(NOTIFICATION_TYPES).toContain("password_changed");
			expect(NOTIFICATION_TYPES).toContain("two_factor_enabled");
			expect(NOTIFICATION_TYPES).toContain("two_factor_disabled");
		});

		it("contains all expected reminder types", () => {
			expect(NOTIFICATION_TYPES).toContain("birthday_reminder");
			expect(NOTIFICATION_TYPES).toContain("vacation_balance_alert");
		});

		it("has expected total count of notification types", () => {
			// 3 approval + 3 time correction + 3 absence + 2 team + 3 security + 2 reminder = 16
			expect(NOTIFICATION_TYPES).toHaveLength(16);
		});

		it("is a readonly array", () => {
			// TypeScript enforces this at compile time, but we can verify it's an array
			expect(Array.isArray(NOTIFICATION_TYPES)).toBe(true);
		});
	});

	describe("NOTIFICATION_CHANNELS", () => {
		it("contains in_app channel", () => {
			expect(NOTIFICATION_CHANNELS).toContain("in_app");
		});

		it("contains push channel", () => {
			expect(NOTIFICATION_CHANNELS).toContain("push");
		});

		it("contains email channel", () => {
			expect(NOTIFICATION_CHANNELS).toContain("email");
		});

		it("has exactly 3 channels", () => {
			expect(NOTIFICATION_CHANNELS).toHaveLength(3);
		});

		it("is a readonly array", () => {
			expect(Array.isArray(NOTIFICATION_CHANNELS)).toBe(true);
		});
	});

	describe("Type validation helpers", () => {
		it("can check if a string is a valid notification type", () => {
			const validType = "approval_request_submitted";
			const invalidType = "invalid_type";

			expect(NOTIFICATION_TYPES.includes(validType as never)).toBe(true);
			expect(NOTIFICATION_TYPES.includes(invalidType as never)).toBe(false);
		});

		it("can check if a string is a valid notification channel", () => {
			const validChannel = "in_app";
			const invalidChannel = "sms";

			expect(NOTIFICATION_CHANNELS.includes(validChannel as never)).toBe(true);
			expect(NOTIFICATION_CHANNELS.includes(invalidChannel as never)).toBe(false);
		});
	});
});
