/* @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { EmployeeEmploymentHistoryCard } from "./employee-employment-history-card";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
}));

function renderCard(canManage: boolean) {
	return render(
		<EmployeeEmploymentHistoryCard
			history={[]}
			canManage={canManage}
			onCreate={vi.fn()}
			onConfirm={vi.fn()}
			onCancel={vi.fn()}
			isCreating={false}
			isMutating={false}
			notice={<p>Wage history was merged</p>}
		/>,
	);
}

describe("EmployeeEmploymentHistoryCard notice (#1176)", () => {
	it("shows the notice to those who manage the terms", () => {
		renderCard(true);

		expect(screen.getByText("Wage history was merged")).toBeTruthy();
	});

	it("never shows the notice to anyone else", () => {
		renderCard(false);

		expect(screen.queryByText("Wage history was merged")).toBeNull();
	});
});
