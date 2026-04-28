/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { queryKeys } from "./keys";
import { useCreateSkill, useDeleteSkill, useUpdateSkill } from "./use-skills";

const { createSkillMock, deleteSkillMock, updateSkillMock } = vi.hoisted(() => ({
	createSkillMock: vi.fn(),
	deleteSkillMock: vi.fn(),
	updateSkillMock: vi.fn(),
}));

vi.mock("@/app/[locale]/(app)/my-qualifications/actions", () => ({
	submitMyQualificationRenewal: vi.fn(),
}));

vi.mock("@/app/[locale]/(app)/settings/skills/actions", () => ({
	assignSkillToEmployee: vi.fn(),
	createSkill: createSkillMock,
	deleteSkill: deleteSkillMock,
	getEmployeeSkills: vi.fn(),
	getOrganizationSkills: vi.fn(),
	getQualifiedEmployeesForSkills: vi.fn(),
	removeSkillFromEmployee: vi.fn(),
	setSubareaSkillRequirements: vi.fn(),
	setTemplateSkillRequirements: vi.fn(),
	updateSkill: updateSkillMock,
	validateEmployeeForShift: vi.fn(),
}));

function createWrapper(queryClient: QueryClient) {
	return function Wrapper({ children }: { children: ReactNode }) {
		return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
	};
}

function createQueryClientWithSkillLists() {
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
	});
	queryClient.setQueryData(queryKeys.skills.list("org-1", false), []);
	queryClient.setQueryData(queryKeys.skills.list("org-1", true), []);
	return queryClient;
}

function expectSkillListsInvalidated(queryClient: QueryClient) {
	expect(queryClient.getQueryState(queryKeys.skills.list("org-1", false))?.isInvalidated).toBe(
		true,
	);
	expect(queryClient.getQueryState(queryKeys.skills.list("org-1", true))?.isInvalidated).toBe(true);
}

describe("skill catalog mutation hooks", () => {
	beforeEach(() => {
		createSkillMock.mockResolvedValue({ success: true, data: { id: "skill-1" } });
		updateSkillMock.mockResolvedValue({ success: true, data: { id: "skill-1" } });
		deleteSkillMock.mockResolvedValue({ success: true });
	});

	it("invalidates active and inactive catalog lists after creating a skill", async () => {
		const queryClient = createQueryClientWithSkillLists();
		const { result } = renderHook(() => useCreateSkill("org-1"), {
			wrapper: createWrapper(queryClient),
		});

		result.current.mutate({
			name: "Forklift License",
			category: "certification",
			requiresExpiry: true,
		});

		await waitFor(() => expect(createSkillMock).toHaveBeenCalled());
		expectSkillListsInvalidated(queryClient);
	});

	it("invalidates active and inactive catalog lists after updating a skill", async () => {
		const queryClient = createQueryClientWithSkillLists();
		const { result } = renderHook(() => useUpdateSkill("org-1"), {
			wrapper: createWrapper(queryClient),
		});

		result.current.mutate({
			skillId: "skill-1",
			data: { name: "Updated Forklift License" },
		});

		await waitFor(() => expect(updateSkillMock).toHaveBeenCalled());
		expectSkillListsInvalidated(queryClient);
	});

	it("invalidates active and inactive catalog lists after deleting a skill", async () => {
		const queryClient = createQueryClientWithSkillLists();
		const { result } = renderHook(() => useDeleteSkill("org-1"), {
			wrapper: createWrapper(queryClient),
		});

		result.current.mutate("skill-1");

		await waitFor(() => expect(deleteSkillMock).toHaveBeenCalled());
		expectSkillListsInvalidated(queryClient);
	});
});
