/* @vitest-environment jsdom */

import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { parseInstant } from "@/lib/datetime/temporal-core";
import {
	buildPositionCaptureReview,
	type PositionCaptureReviewSource,
} from "@/lib/works-council/position-capture-review";
import { createTestTolgee, render } from "@/test/render-with-translations";
import { PositionCaptureReviewSection } from "./position-capture-review-section";

const at = (iso: string) => parseInstant(iso);

const source: PositionCaptureReviewSource = {
	settings: {
		enabled: true,
		purposeStatement: "Proof of on-site work at customer sites",
		retentionDays: 60,
	},
	notices: [
		{
			id: "notice-2",
			version: 2,
			purposeStatement: "Proof of on-site work at customer sites",
			retentionDays: 90,
			templateRevision: 1,
			createdAt: at("2026-03-01T00:00:00Z"),
		},
		{
			id: "notice-1",
			version: 1,
			purposeStatement: "Proof of on-site work",
			retentionDays: 90,
			templateRevision: 1,
			createdAt: at("2026-01-01T00:00:00Z"),
		},
	],
	assignments: [
		{
			id: "a-team",
			assignmentType: "team",
			teamId: "t",
			teamName: "Field service",
			employeeId: null,
			captureEnabled: true,
		},
		{
			id: "a-ben",
			assignmentType: "employee",
			teamId: null,
			employeeId: "e-ben",
			captureEnabled: false,
		},
	],
	employees: [
		{
			employeeId: "e-anna",
			teamId: "t",
			consents: [
				{
					id: "c-1",
					noticeId: "notice-2",
					noticeVersion: 2,
					grantedAt: at("2026-03-02T00:00:00Z"),
					withdrawnAt: null,
				},
			],
			declines: [],
		},
		{ employeeId: "e-carl", teamId: "t", consents: [], declines: [] },
	],
	employeeNames: { "e-anna": "Anna Field", "e-ben": "Ben Office" },
	accessLog: [
		{
			id: "log-1",
			kind: "work_period_detail",
			accessedAt: at("2026-09-20T15:00:00Z"),
			viewer: { userId: "u-olga", name: "Olga Owner" },
			subjectEmployeeIds: ["e-anna"],
			workPeriods: [{ id: "period-1" }],
		},
	],
};

async function renderSection(identityVisibility: "aggregated" | "pseudonymized" | "named") {
	const review = buildPositionCaptureReview(source, {
		identityVisibility,
		minimumAggregationThreshold: 1,
	});
	return render(
		<PositionCaptureReviewSection review={review} locale="en" t={createTestTolgee().t} />,
	);
}

describe("PositionCaptureReviewSection", () => {
	it("shows the configuration, notice history, consent counts and access log read-only", async () => {
		await renderSection("named");

		const section = screen.getByRole("region", { name: "Position capture" });
		expect(within(section).getByText("Capture").nextElementSibling?.textContent).toBe("On");
		expect(within(section).getByText("60 days")).toBeTruthy();
		expect(within(section).getByText("Field service")).toBeTruthy();
		expect(within(section).getByText("Ben Office")).toBeTruthy();
		expect(within(screen.getByLabelText("Active consent")).getByText("1")).toBeTruthy();
		expect(within(screen.getByLabelText("Withdrawn")).getByText("0")).toBeTruthy();
		expect(within(screen.getByLabelText("Undecided")).getByText("1")).toBeTruthy();
		expect(within(section).getByText("Position notice, version 2")).toBeTruthy();
		expect(within(section).getByText("Proof of on-site work")).toBeTruthy();
		expect(within(section).getByText("Olga Owner")).toBeTruthy();
		expect(within(section).getByText("Anna Field")).toBeTruthy();
		// Nothing editable.
		expect(within(section).queryByRole("button")).toBeNull();
		expect(within(section).queryByRole("textbox")).toBeNull();
		expect(within(section).queryByRole("checkbox")).toBeNull();
		expect(within(section).queryByRole("switch")).toBeNull();
	});

	it("shows no viewer or employee name when identities are aggregated", async () => {
		const { container } = await renderSection("aggregated");

		expect(container.textContent).not.toMatch(/Anna|Ben|Olga/);
		expect(screen.getByText("0 switched on, 1 switched off individually")).toBeTruthy();
		expect(screen.getByText("1 employee")).toBeTruthy();
	});

	it("uses pseudonyms when identities are pseudonymized", async () => {
		const { container } = await renderSection("pseudonymized");

		expect(container.textContent).not.toMatch(/Anna|Ben|Olga/);
		expect(screen.getByText("Viewer A")).toBeTruthy();
		expect(screen.getByText("Employee A")).toBeTruthy();
		expect(screen.getByText("Employee B")).toBeTruthy();
	});
});
