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
});
