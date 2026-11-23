import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import {
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
});
