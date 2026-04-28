/* @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { normalizeExpiryWarningDays, SkillCatalogManagement } from "./skill-catalog-management";

const { deleteSkillMock, invalidateQueriesMock } = vi.hoisted(() => ({
	deleteSkillMock: vi.fn(),
	invalidateQueriesMock: vi.fn(),
}));

const catalogSkill = {
	id: "skill-1",
	organizationId: "org-1",
	name: "Forklift License",
	description: null,
	category: "certification",
	customCategoryName: null,
	requiresExpiry: true,
	expiryWarningDays: 30,
	isActive: true,
	createdAt: new Date("2026-01-01T00:00:00Z"),
	updatedAt: new Date("2026-01-01T00:00:00Z"),
	createdBy: "user-1",
	updatedBy: null,
};

class ResizeObserverMock {
	observe() {}
	unobserve() {}
	disconnect() {}
}

globalThis.ResizeObserver = ResizeObserverMock;

vi.mock("@tanstack/react-query", async () => {
	const actual =
		await vi.importActual<typeof import("@tanstack/react-query")>("@tanstack/react-query");
	return {
		...actual,
		useQuery: () => ({
			data: [catalogSkill],
			isLoading: false,
			isFetching: false,
			refetch: vi.fn(),
		}),
		useQueryClient: () => ({ invalidateQueries: invalidateQueriesMock }),
		useMutation: (options: {
			mutationFn: (input: string) => Promise<unknown>;
			onSuccess?: () => void;
		}) => ({
			mutate: async (input: string) => {
				await options.mutationFn(input);
				options.onSuccess?.();
			},
			isPending: false,
		}),
	};
});

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
}));

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

vi.mock("@/app/[locale]/(app)/settings/skills/actions", () => ({
	createSkill: vi.fn(),
	deleteSkill: deleteSkillMock,
	updateSkill: vi.fn(),
}));

describe("SkillCatalogManagement", () => {
	beforeEach(() => {
		deleteSkillMock.mockResolvedValue({ success: true });
		invalidateQueriesMock.mockClear();
		vi.spyOn(window, "confirm").mockReturnValue(true);
	});

	it("uses qualification-oriented catalog copy", () => {
		render(<SkillCatalogManagement organizationId="org-1" canManageCatalog />);
		expect(screen.getByText("Skills & Qualifications")).toBeTruthy();
		expect(screen.getByText(/Manage skills and certifications/)).toBeTruthy();
	});

	it("invalidates the active skill catalog query after deleting a skill", async () => {
		render(<SkillCatalogManagement organizationId="org-1" canManageCatalog />);

		fireEvent.click(screen.getByLabelText("Delete"));

		await waitFor(() => {
			expect(invalidateQueriesMock).toHaveBeenCalledWith({
				queryKey: ["skills", "list", "org-1", false],
			});
		});
	});

	it("prefills the edit form with catalog qualification details", () => {
		render(<SkillCatalogManagement organizationId="org-1" canManageCatalog />);

		fireEvent.click(screen.getByText("Add Skill"));
		fireEvent.change(screen.getByLabelText("Name *"), { target: { value: "Stale draft" } });
		fireEvent.click(screen.getByText("Cancel"));

		fireEvent.click(screen.getByLabelText("Edit"));

		expect((screen.getByLabelText("Name *") as HTMLInputElement).value).toBe("Forklift License");
		expect(
			screen.getByRole("switch", { name: "Requires Expiry Date" }).getAttribute("aria-checked"),
		).toBe("true");
		expect((screen.getByLabelText("Warn before expiry") as HTMLInputElement).value).toBe("30");
	});

	it("resets the create form after canceling", () => {
		render(<SkillCatalogManagement organizationId="org-1" canManageCatalog />);

		fireEvent.click(screen.getByText("Add Skill"));
		fireEvent.change(screen.getByLabelText("Name *"), { target: { value: "Draft Skill" } });
		fireEvent.click(screen.getByRole("switch", { name: "Requires Expiry Date" }));
		fireEvent.change(screen.getByLabelText("Warn before expiry"), { target: { value: "90" } });
		fireEvent.click(screen.getByText("Cancel"));

		fireEvent.click(screen.getByText("Add Skill"));

		expect((screen.getByLabelText("Name *") as HTMLInputElement).value).toBe("");
		expect(
			screen.getByRole("switch", { name: "Requires Expiry Date" }).getAttribute("aria-checked"),
		).toBe("false");
		expect(screen.queryByLabelText("Warn before expiry")).toBeNull();
	});

	it("normalizes expiry warning days to finite whole days", () => {
		expect(normalizeExpiryWarningDays(Number.NaN)).toBe(30);
		expect(normalizeExpiryWarningDays(-3)).toBe(0);
		expect(normalizeExpiryWarningDays(14.8)).toBe(14);
		expect(normalizeExpiryWarningDays(400)).toBe(365);
	});
});
