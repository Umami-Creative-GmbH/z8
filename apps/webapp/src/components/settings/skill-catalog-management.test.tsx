/* @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SkillCatalogManagement } from "./skill-catalog-management";

vi.mock("@tanstack/react-query", async () => {
	const actual = await vi.importActual<typeof import("@tanstack/react-query")>("@tanstack/react-query");
	return {
		...actual,
		useQuery: () => ({ data: [], isLoading: false, isFetching: false, refetch: vi.fn() }),
		useQueryClient: () => ({ invalidateQueries: vi.fn() }),
		useMutation: () => ({ mutate: vi.fn(), isPending: false }),
	};
});

vi.mock("@tolgee/react", () => ({ useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }) }));

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

vi.mock("@/app/[locale]/(app)/settings/skills/actions", () => ({
	createSkill: vi.fn(),
	deleteSkill: vi.fn(),
	updateSkill: vi.fn(),
}));

describe("SkillCatalogManagement", () => {
	it("uses qualification-oriented catalog copy", () => {
		render(<SkillCatalogManagement organizationId="org-1" canManageCatalog />);
		expect(screen.getByText("Skills & Qualifications")).toBeTruthy();
		expect(screen.getByText(/Manage skills and certifications/)).toBeTruthy();
	});
});
