"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	createSkill,
	updateSkill,
	deleteSkill,
	getOrganizationSkills,
	assignSkillToEmployee,
	removeSkillFromEmployee,
	getEmployeeSkills,
	setSubareaSkillRequirements,
	setTemplateSkillRequirements,
	validateEmployeeForShift,
	getQualifiedEmployeesForSkills,
	type SkillWithRelations,
	type EmployeeSkillWithDetails,
	type SkillValidationResult,
} from "@/app/[locale]/(app)/settings/skills/actions";
import { queryKeys } from "./keys";

// =============================================================================
// Skill Catalog Hooks
// =============================================================================

interface UseOrganizationSkillsOptions {
	organizationId: string;
	includeInactive?: boolean;
	enabled?: boolean;
}

export function useOrganizationSkills(options: UseOrganizationSkillsOptions) {
	const { organizationId, includeInactive = false, enabled = true } = options;

	return useQuery({
		queryKey: queryKeys.skills.list(organizationId, includeInactive),
		queryFn: async (): Promise<SkillWithRelations[]> => {
			const result = await getOrganizationSkills({ includeInactive });
			if (!result.success) throw new Error(result.error);
			return result.data;
		},
		enabled: enabled && !!organizationId,
		staleTime: 5 * 60 * 1000, // 5 minutes
	});
}

export function useCreateSkill(organizationId: string) {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async (data: {
			name: string;
			description?: string;
			category: "safety" | "equipment" | "certification" | "training" | "language" | "custom";
			customCategoryName?: string;
			requiresExpiry: boolean;
		}) => {
			const result = await createSkill(data);
			if (!result.success) throw new Error(result.error);
			return result.data;
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: queryKeys.skills.list(organizationId) });
		},
	});
}

export function useUpdateSkill(organizationId: string) {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async ({
			skillId,
			data,
		}: {
			skillId: string;
			data: {
				name?: string;
				description?: string;
				category?: "safety" | "equipment" | "certification" | "training" | "language" | "custom";
				customCategoryName?: string;
				requiresExpiry?: boolean;
				isActive?: boolean;
			};
		}) => {
			const result = await updateSkill(skillId, data);
			if (!result.success) throw new Error(result.error);
			return result.data;
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: queryKeys.skills.list(organizationId) });
		},
	});
}

export function useDeleteSkill(organizationId: string) {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async (skillId: string) => {
			const result = await deleteSkill(skillId);
			if (!result.success) throw new Error(result.error);
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: queryKeys.skills.list(organizationId) });
		},
	});
}

// =============================================================================
// Employee Skills Hooks
// =============================================================================

interface UseEmployeeSkillsOptions {
	employeeId: string;
	enabled?: boolean;
}

export function useEmployeeSkills(options: UseEmployeeSkillsOptions) {
	const { employeeId, enabled = true } = options;

	return useQuery({
		queryKey: queryKeys.skills.employee(employeeId),
		queryFn: async (): Promise<EmployeeSkillWithDetails[]> => {
			const result = await getEmployeeSkills(employeeId);
			if (!result.success) throw new Error(result.error);
			return result.data;
		},
		enabled: enabled && !!employeeId,
		staleTime: 2 * 60 * 1000, // 2 minutes
	});
}

export function useAssignSkillToEmployee() {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async (data: {
			employeeId: string;
			skillId: string;
			expiresAt?: Date;
			notes?: string;
		}) => {
			const result = await assignSkillToEmployee(data);
			if (!result.success) throw new Error(result.error);
			return result.data;
		},
		onSuccess: (_, variables) => {
			queryClient.invalidateQueries({
				queryKey: queryKeys.skills.employee(variables.employeeId),
			});
		},
	});
}

export function useRemoveSkillFromEmployee() {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async ({ employeeId, skillId }: { employeeId: string; skillId: string }) => {
			const result = await removeSkillFromEmployee(employeeId, skillId);
			if (!result.success) throw new Error(result.error);
		},
		onSuccess: (_, variables) => {
			queryClient.invalidateQueries({
				queryKey: queryKeys.skills.employee(variables.employeeId),
			});
		},
	});
}

// =============================================================================
// Skill Requirements Hooks
// =============================================================================

export function useSetSubareaSkillRequirements() {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async ({
			subareaId,
			requirements,
		}: {
			subareaId: string;
			requirements: Array<{ skillId: string; isRequired: boolean }>;
		}) => {
			const result = await setSubareaSkillRequirements(subareaId, requirements);
			if (!result.success) throw new Error(result.error);
		},
		onSuccess: (_, variables) => {
			queryClient.invalidateQueries({
				queryKey: queryKeys.skills.subarea(variables.subareaId),
			});
		},
	});
}

export function useSetTemplateSkillRequirements() {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async ({
			templateId,
			requirements,
		}: {
			templateId: string;
			requirements: Array<{ skillId: string; isRequired: boolean }>;
		}) => {
			const result = await setTemplateSkillRequirements(templateId, requirements);
			if (!result.success) throw new Error(result.error);
		},
		onSuccess: (_, variables) => {
			queryClient.invalidateQueries({
				queryKey: queryKeys.skills.template(variables.templateId),
			});
		},
	});
}

// =============================================================================
// Skill Validation Hooks
// =============================================================================

interface UseSkillValidationOptions {
	employeeId: string;
	subareaId: string;
	templateId?: string | null;
	enabled?: boolean;
}

export function useSkillValidation(options: UseSkillValidationOptions) {
	const { employeeId, subareaId, templateId, enabled = true } = options;

	return useQuery({
		queryKey: queryKeys.skills.validation(employeeId, subareaId, templateId ?? undefined),
		queryFn: async (): Promise<SkillValidationResult> => {
			const result = await validateEmployeeForShift(employeeId, {
				subareaId,
				templateId,
			});
			if (!result.success) throw new Error(result.error);
			return result.data;
		},
		enabled: enabled && !!employeeId && !!subareaId,
		staleTime: 30 * 1000, // 30 seconds - refresh frequently for real-time validation
	});
}

interface UseQualifiedEmployeesOptions {
	skillIds: string[];
	enabled?: boolean;
}

export function useQualifiedEmployees(options: UseQualifiedEmployeesOptions) {
	const { skillIds, enabled = true } = options;

	return useQuery({
		queryKey: queryKeys.skills.qualified(skillIds),
		queryFn: async (): Promise<string[]> => {
			const result = await getQualifiedEmployeesForSkills(skillIds);
			if (!result.success) throw new Error(result.error);
			return result.data;
		},
		enabled: enabled && skillIds.length > 0,
		staleTime: 60 * 1000, // 1 minute
	});
}
