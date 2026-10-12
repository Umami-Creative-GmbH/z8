import { describe, expect, it } from "vitest";
import {
	buildNativePushMessage,
	type NativePushTranslate,
	toFcmMessage,
} from "./native-push-message";
import { NOTIFICATION_TYPES } from "./types";

const passthrough: NativePushTranslate = (_key, defaultValue) => defaultValue;

/** Personal and user-entered text a real notification carries in title, message and metadata. */
const PERSONAL_TEXT = [
	"Anna Schmidt",
	"Umami Creative GmbH",
	"Vacation in Lisbon",
	"14:30",
	"2026-10-12",
	"1,234.50",
	"EUR",
];

const approvalRequest = {
	type: "approval_request_submitted" as const,
	organizationId: "org-1",
	actionUrl: "/approvals/inbox",
	title: "Anna Schmidt requested Vacation in Lisbon",
	message: "Anna Schmidt (Umami Creative GmbH) asks for 2026-10-12 from 14:30, 1,234.50 EUR",
	metadata: { employeeName: "Anna Schmidt", reason: "Vacation in Lisbon" },
};

describe("buildNativePushMessage", () => {
	it("tells an approver generically that a request waits, and where to open it", () => {
		const message = buildNativePushMessage(approvalRequest, passthrough);

		expect(message).toEqual({
			title: "You have a request to review",
			body: "Open Z8 to see the details.",
			data: {
				type: "approval_request_submitted",
				path: "/approvals/inbox",
				organizationId: "org-1",
			},
		});
	});

	it("never carries names, times, amounts or organization names in any field", () => {
		const fcm = toFcmMessage("device-token", buildNativePushMessage(approvalRequest, passthrough));
		const serialized = JSON.stringify(fcm);

		for (const text of PERSONAL_TEXT) {
			expect(serialized).not.toContain(text);
		}
	});

	it("keeps only the path of the action URL, dropping query, hash and other origins", () => {
		const build = (actionUrl: string | null | undefined) =>
			buildNativePushMessage(
				{ type: "automatic_clock_out", organizationId: "org-1", actionUrl },
				passthrough,
			).data.path;

		expect(build("/calendar/emp-1?date=2026-10-12#entry")).toBe("/calendar/emp-1");
		expect(build("https://evil.example/approvals")).toBe("/");
		expect(build("//evil.example/approvals")).toBe("/");
		expect(build("javascript:alert(1)")).toBe("/");
		expect(build(undefined)).toBe("/");
	});

	it("omits the organization when the push has none", () => {
		const message = buildNativePushMessage({ type: "water_reminder", actionUrl: "/" }, passthrough);

		expect(message.data).toEqual({ type: "water_reminder", path: "/" });
		expect(message.title).toBe("Reminder from Z8");
	});

	it("localizes title and body through the recipient's translator", () => {
		const german: NativePushTranslate = (key) =>
			({
				"notifications.nativePush.review.title": "Eine Anfrage wartet auf Sie",
				"notifications.nativePush.body": "Öffnen Sie Z8, um die Details zu sehen.",
			})[key] ?? key;

		const message = buildNativePushMessage(approvalRequest, german);

		expect(message.title).toBe("Eine Anfrage wartet auf Sie");
		expect(message.body).toBe("Öffnen Sie Z8, um die Details zu sehen.");
	});

	it("gives every notification type a generic title", () => {
		for (const type of NOTIFICATION_TYPES) {
			const message = buildNativePushMessage({ type, actionUrl: "/" }, passthrough);
			expect(message.title.length).toBeGreaterThan(0);
		}
	});
});

describe("toFcmMessage", () => {
	it("addresses one device with a visible notification and string-only data", () => {
		const fcm = toFcmMessage("device-token", buildNativePushMessage(approvalRequest, passthrough));

		expect(fcm).toEqual({
			message: {
				token: "device-token",
				notification: {
					title: "You have a request to review",
					body: "Open Z8 to see the details.",
				},
				data: {
					type: "approval_request_submitted",
					path: "/approvals/inbox",
					organizationId: "org-1",
				},
				android: { priority: "high" },
				apns: { payload: { aps: { sound: "default" } } },
			},
		});
		for (const value of Object.values(fcm.message.data)) {
			expect(typeof value).toBe("string");
		}
	});
});
