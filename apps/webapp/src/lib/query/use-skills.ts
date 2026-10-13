"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	assignSkillToEmployee,
	createSkill,
	deleteSkill,
	getEmployeeSkills,
	getOrganizationSkills,
	getQualifiedEmployeesForSkills,
	getSkillExpiryWindow,
	removeSkillFromEmployee,
	setSubareaSkillRequirements,
	setTemplateSkillRequirements,
	updateEmployeeSkillExpiry,
	updateSkill,
	validateEmployeeForShift,
} from "@/app/[locale]/(app)/settings/skills/actions";
import type {
	EmployeeSkillWithDetails,
	SkillExpiryWindow,
	SkillValidationResult,
	SkillWithRelations,
} from "@/lib/effect/services/skill.service";
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

/** The organization's today and the "Expiring soon" window the skill badges count from. */
export function useSkillExpiryWindow(options: { organizationId: string; enabled?: boolean }) {
	const { organizationId, enabled = true } = options;

	return useQuery({
		queryKey: queryKeys.skills.expiryWindow(organizationId),
		queryFn: async (): Promise<SkillExpiryWindow> => {
			const result = await getSkillExpiryWindow();
			if (!result.success) throw new Error(result.error);
			return result.data;
		},
		enabled: enabled && !!organizationId,
		staleTime: 5 * 60 * 1000, // 5 minutes
	});
}

export function useAssignSkillToEmployee() {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async (data: {
			employeeId: string;
			skillId: string;
			/** `YYYY-MM-DD`, the last valid day. */
			expiresAt?: string | null;
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

/** Changes an assigned employee skill's expiry date in place. */
export function useUpdateEmployeeSkillExpiry() {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async (data: {
			employeeId: string;
			skillId: string;
			/** `YYYY-MM-DD`, the last valid day; null never expires. */
			expiresAt: string | null;
		}) => {
			const result = await updateEmployeeSkillExpiry(data);
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

const PLAIN_DATE = /^\d{4}-\d{2}-\d{2}$/;

interface UseSkillValidationOptions {
	employeeId: string;
	subareaId: string;
	templateId?: string | null;
	/** The shift date, `YYYY-MM-DD`: skills count on it, not today. */
	date: string;
	enabled?: boolean;
}

export function useSkillValidation(options: UseSkillValidationOptions) {
	const { employeeId, subareaId, templateId, date, enabled = true } = options;

	return useQuery({
		queryKey: queryKeys.skills.validation(employeeId, subareaId, date, templateId ?? undefined),
		queryFn: async (): Promise<SkillValidationResult> => {
			const result = await validateEmployeeForShift(employeeId, {
				subareaId,
				templateId,
				date,
			});
			if (!result.success) throw new Error(result.error);
			return result.data;
		},
		enabled: enabled && !!employeeId && !!subareaId && PLAIN_DATE.test(date),
		staleTime: 30 * 1000, // 30 seconds - refresh frequently for real-time validation
	});
}

interface UseQualifiedEmployeesOptions {
	skillIds: string[];
	/** The shift date, `YYYY-MM-DD`: skills count on it, not today. */
	date: string;
	enabled?: boolean;
}

export function useQualifiedEmployees(options: UseQualifiedEmployeesOptions) {
	const { skillIds, date, enabled = true } = options;

	return useQuery({
		queryKey: queryKeys.skills.qualified(skillIds, date),
		queryFn: async (): Promise<string[]> => {
			const result = await getQualifiedEmployeesForSkills(skillIds, date);
			if (!result.success) throw new Error(result.error);
			return result.data;
		},
		enabled: enabled && skillIds.length > 0 && PLAIN_DATE.test(date),
		staleTime: 60 * 1000, // 1 minute
	});
}
