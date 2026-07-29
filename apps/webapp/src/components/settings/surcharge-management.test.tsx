/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SurchargeManagement } from "./surcharge-management";

const getSurchargeModelsMock = vi.fn();

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string, params?: { count?: number }) =>
			params?.count === undefined ? fallback : `${params.count} rules`,
	}),
}));

vi.mock("sonner", () => ({
	toast: { error: vi.fn(), success: vi.fn() },
}));

vi.mock("@/app/[locale]/(app)/settings/surcharges/actions", () => ({
	deleteSurchargeModel: vi.fn(),
	getSurchargeModels: (...args: unknown[]) => getSurchargeModelsMock(...args),
}));

vi.mock("./surcharge-assignment-dialog", () => ({
	SurchargeAssignmentDialog: () => null,
}));
vi.mock("./surcharge-assignment-manager", () => ({
	SurchargeAssignmentManager: () => null,
}));
vi.mock("./surcharge-model-dialog", () => ({
	SurchargeModelDialog: () => null,
}));
vi.mock("./surcharge-reports/surcharge-reports-root", () => ({
	SurchargeReports: () => null,
}));

const model = (id: string, name: string, isActive = true) => ({
	id,
	organizationId: "org-approved",
	name,
	description: `${name} description`,
	isActive,
	createdAt: new Date("2026-01-01T00:00:00Z"),
	createdBy: "user-1",
	updatedAt: new Date("2026-01-01T00:00:00Z"),
	updatedBy: null,
	rules: [
		{
			id: `${id}-rule`,
			name: `${name} rule`,
			description: null,
			ruleType: "day_of_week" as const,
			percentage: "0.5",
			dayOfWeek: "sunday",
			windowStartTime: null,
			windowEndTime: null,
			specificDate: null,
			dateRangeStart: null,
			dateRangeEnd: null,
			priority: 0,
			validFrom: null,
			validUntil: null,
			isActive: true,
			createdAt: new Date("2026-01-01T00:00:00Z"),
			createdBy: "user-1",
		},
	],
});

describe("SurchargeManagement", () => {
	beforeEach(() => {
		getSurchargeModelsMock.mockReset();
		getSurchargeModelsMock.mockResolvedValue({
			success: true,
			data: [
				model("model-b", "Night"),
				model("model-a", "Weekend"),
				model("off", "Old", false),
			],
		});
	});

	it("renders active models and rules in the server-provided order", async () => {
		render(
			<QueryClientProvider client={new QueryClient()}>
				<SurchargeManagement canManage={false} organizationId="org-approved" />
			</QueryClientProvider>,
		);

		await screen.findByText("Night");
		expect(getSurchargeModelsMock).toHaveBeenCalledWith("org-approved");
		expect(screen.queryByText("Old")).toBeNull();
		expect(
			screen
				.getAllByText(/^(Night|Weekend)$/)
				.map((element) => element.textContent),
		).toEqual(["Night", "Weekend"]);
		expect(screen.getByText("Night rule")).toBeTruthy();
		expect(screen.getAllByText("+50%")).toHaveLength(2);
		expect(screen.queryByRole("button", { name: "Create Model" })).toBeNull();
	});
});
