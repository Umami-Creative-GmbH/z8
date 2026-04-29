import { describe, expect, it } from "vitest";
import { queryKeys } from "./keys";

describe("queryKeys.notifications", () => {
	it("separates notification list keys by every fetch option", () => {
		expect(queryKeys.notifications.list({ limit: 20, unreadOnly: false })).not.toEqual(
			queryKeys.notifications.list({ limit: 100, unreadOnly: false }),
		);
		expect(queryKeys.notifications.list({ limit: 100, unreadOnly: false })).not.toEqual(
			queryKeys.notifications.list({ limit: 100, unreadOnly: true }),
		);
	});

	it("separates notification list and count keys by organization", () => {
		expect(
			queryKeys.notifications.list({ limit: 100, unreadOnly: false, organizationId: "org-a" }),
		).not.toEqual(
			queryKeys.notifications.list({ limit: 100, unreadOnly: false, organizationId: "org-b" }),
		);
		expect(queryKeys.notifications.unreadCount("org-a")).not.toEqual(
			queryKeys.notifications.unreadCount("org-b"),
		);
	});
});
