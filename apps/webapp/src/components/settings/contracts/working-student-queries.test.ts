import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { queryKeys } from "@/lib/query/keys";
import {
	invalidateOrganizationStatutoryFindings,
	invalidateWorkingStudentFindings,
	workingStudentQueryKeys,
} from "./working-student-queries";

describe("working-student query keys", () => {
	it("scope every key to the organization", () => {
		expect(workingStudentQueryKeys.monitor("org-a", "emp-1")).toContain("org-a");
		expect(workingStudentQueryKeys.reviews("org-a")).toContain("org-a");
		expect(workingStudentQueryKeys.monitor("org-a", "emp-1")).not.toEqual(
			workingStudentQueryKeys.monitor("org-b", "emp-1"),
		);
	});

	it("invalidates the employee's monitor card and the organization's Reviews & Conflicts", async () => {
		const client = new QueryClient();
		const keys = {
			card: workingStudentQueryKeys.monitor("org-a", "emp-1"),
			otherCard: workingStudentQueryKeys.monitor("org-a", "emp-2"),
			reviews: workingStudentQueryKeys.reviews("org-a"),
			foreignCard: workingStudentQueryKeys.monitor("org-b", "emp-1"),
			foreignReviews: workingStudentQueryKeys.reviews("org-b"),
		};
		for (const key of Object.values(keys)) client.setQueryData(key, { loaded: true });

		await invalidateWorkingStudentFindings(client, "org-a", "emp-1");

		const invalidated = (key: readonly unknown[]) => client.getQueryState(key)?.isInvalidated;
		expect(invalidated(keys.card)).toBe(true);
		expect(invalidated(keys.reviews)).toBe(true);
		expect(invalidated(keys.otherCard)).toBe(false);
		expect(invalidated(keys.foreignCard)).toBe(false);
		expect(invalidated(keys.foreignReviews)).toBe(false);
	});

	it("refetches every view of the organization's statutory warnings after a preference change", async () => {
		const client = new QueryClient();
		const week = { startDate: "2026-03-02", endDateExclusive: "2026-03-09" };
		const proposed = {
			subareaId: "sub-1",
			date: "2026-03-04",
			startTime: "08:00",
			endTime: "16:00",
		};
		const ownKeys = {
			card: workingStudentQueryKeys.monitor("org-a", "emp-1"),
			reviews: workingStudentQueryKeys.reviews("org-a"),
			scheduleWarnings: queryKeys.compliance.scheduleWarnings("org-a", week),
			staffing: queryKeys.shifts.staffingSuggestions("org-a", proposed),
		};
		const foreignKeys = {
			card: workingStudentQueryKeys.monitor("org-b", "emp-1"),
			reviews: workingStudentQueryKeys.reviews("org-b"),
			scheduleWarnings: queryKeys.compliance.scheduleWarnings("org-b", week),
			staffing: queryKeys.shifts.staffingSuggestions("org-b", proposed),
		};
		for (const key of [...Object.values(ownKeys), ...Object.values(foreignKeys)]) {
			client.setQueryData(key, { loaded: true });
		}

		await invalidateOrganizationStatutoryFindings(client, "org-a");

		const invalidated = (key: readonly unknown[]) => client.getQueryState(key)?.isInvalidated;
		for (const key of Object.values(ownKeys)) expect(invalidated(key)).toBe(true);
		for (const key of Object.values(foreignKeys)) expect(invalidated(key)).toBe(false);
	});
});
