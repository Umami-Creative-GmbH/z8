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

describe("queryKeys.periodSubmissions", () => {
	it("separates readiness by organization and employee under one invalidation prefix", () => {
		expect(queryKeys.periodSubmissions.readiness("org-a", "employee-1")).not.toEqual(
			queryKeys.periodSubmissions.readiness("org-b", "employee-1"),
		);
		expect(queryKeys.periodSubmissions.readiness("org-a", "employee-1")).not.toEqual(
			queryKeys.periodSubmissions.readiness("org-a", "employee-2"),
		);
		expect(queryKeys.periodSubmissions.readiness("org-a", "employee-1")[0]).toBe(
			queryKeys.periodSubmissions.all[0],
		);
	});
});

describe("queryKeys.employees", () => {
	it("provides an organization prefix for employee queries", () => {
		expect(queryKeys.employees.organization("org-1")).toEqual(["employees", "org-1"]);
		expect(queryKeys.employees.list("org-1", { page: 2 }).slice(0, 2)).toEqual(
			queryKeys.employees.organization("org-1"),
		);
	});
});

describe("queryKeys.members", () => {
	it("provides an organization prefix without changing the list key shape", () => {
		expect(queryKeys.members.organization("org-1")).toEqual(["members", "org-1"]);
		expect(queryKeys.members.list("org-1")).toEqual(["members", "org-1", undefined]);
	});
});
