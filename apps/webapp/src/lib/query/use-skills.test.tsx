/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { queryKeys } from "./keys";
import {
	useAssignSkillToEmployee,
	useCreateSkill,
	useDeleteSkill,
	useRemoveSkillFromEmployee,
	useUpdateSkill,
} from "./use-skills";

const {
	assignSkillToEmployeeMock,
	createSkillMock,
	deleteSkillMock,
	removeSkillFromEmployeeMock,
	updateSkillMock,
} = vi.hoisted(() => ({
	assignSkillToEmployeeMock: vi.fn(),
	createSkillMock: vi.fn(),
	deleteSkillMock: vi.fn(),
	removeSkillFromEmployeeMock: vi.fn(),
	updateSkillMock: vi.fn(),
}));

vi.mock("@/app/[locale]/(app)/my-qualifications/actions", () => ({
	submitMyQualificationRenewal: vi.fn(),
}));

vi.mock("@/app/[locale]/(app)/settings/skills/actions", () => ({
	assignSkillToEmployee: assignSkillToEmployeeMock,
	createSkill: createSkillMock,
	deleteSkill: deleteSkillMock,
	getEmployeeSkills: vi.fn(),
	getOrganizationSkills: vi.fn(),
	getQualifiedEmployeesForSkills: vi.fn(),
	removeSkillFromEmployee: removeSkillFromEmployeeMock,
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
	queryClient.setQueryData(queryKeys.skills.qualified(["skill-1"]), []);
	queryClient.setQueryData(queryKeys.skills.validation("employee-1", "subarea-1"), {});
	return queryClient;
}

function expectSkillsNamespaceInvalidated(queryClient: QueryClient) {
	expect(queryClient.getQueryState(queryKeys.skills.list("org-1", false))?.isInvalidated).toBe(
		true,
	);
	expect(queryClient.getQueryState(queryKeys.skills.list("org-1", true))?.isInvalidated).toBe(true);
	expect(queryClient.getQueryState(queryKeys.skills.qualified(["skill-1"]))?.isInvalidated).toBe(
		true,
	);
	expect(
		queryClient.getQueryState(queryKeys.skills.validation("employee-1", "subarea-1"))
			?.isInvalidated,
	).toBe(true);
}

describe("skill catalog mutation hooks", () => {
	beforeEach(() => {
		createSkillMock.mockResolvedValue({ success: true, data: { id: "skill-1" } });
		updateSkillMock.mockResolvedValue({ success: true, data: { id: "skill-1" } });
		deleteSkillMock.mockResolvedValue({ success: true });
	});

	it("invalidates the skills namespace after creating a skill", async () => {
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
		expectSkillsNamespaceInvalidated(queryClient);
	});

	it("invalidates the skills namespace after updating a skill", async () => {
		const queryClient = createQueryClientWithSkillLists();
		const { result } = renderHook(() => useUpdateSkill("org-1"), {
			wrapper: createWrapper(queryClient),
		});

		result.current.mutate({
			skillId: "skill-1",
			data: { name: "Updated Forklift License" },
		});

		await waitFor(() => expect(updateSkillMock).toHaveBeenCalled());
		expectSkillsNamespaceInvalidated(queryClient);
	});

	it("invalidates the skills namespace after deleting a skill", async () => {
		const queryClient = createQueryClientWithSkillLists();
		const { result } = renderHook(() => useDeleteSkill("org-1"), {
			wrapper: createWrapper(queryClient),
		});

		result.current.mutate("skill-1");

		await waitFor(() => expect(deleteSkillMock).toHaveBeenCalled());
		expectSkillsNamespaceInvalidated(queryClient);
	});
});

describe("employee skill mutation hooks", () => {
	beforeEach(() => {
		assignSkillToEmployeeMock.mockResolvedValue({
			success: true,
			data: { id: "employee-skill-1" },
		});
		removeSkillFromEmployeeMock.mockResolvedValue({ success: true });
	});

	it("invalidates the skills namespace after assigning a skill", async () => {
		const queryClient = createQueryClientWithSkillLists();
		queryClient.setQueryData(queryKeys.skills.employee("employee-1"), []);
		const { result } = renderHook(() => useAssignSkillToEmployee(), {
			wrapper: createWrapper(queryClient),
		});

		result.current.mutate({ employeeId: "employee-1", skillId: "skill-1" });

		await waitFor(() => expect(assignSkillToEmployeeMock).toHaveBeenCalled());
		expect(queryClient.getQueryState(queryKeys.skills.employee("employee-1"))?.isInvalidated).toBe(
			true,
		);
		expectSkillsNamespaceInvalidated(queryClient);
	});

	it("invalidates the skills namespace after removing a skill", async () => {
		const queryClient = createQueryClientWithSkillLists();
		queryClient.setQueryData(queryKeys.skills.employee("employee-1"), []);
		const { result } = renderHook(() => useRemoveSkillFromEmployee(), {
			wrapper: createWrapper(queryClient),
		});

		result.current.mutate({ employeeId: "employee-1", skillId: "skill-1" });

		await waitFor(() => expect(removeSkillFromEmployeeMock).toHaveBeenCalled());
		expect(queryClient.getQueryState(queryKeys.skills.employee("employee-1"))?.isInvalidated).toBe(
			true,
		);
		expectSkillsNamespaceInvalidated(queryClient);
	});
});
