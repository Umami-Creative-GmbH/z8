"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import { toast } from "sonner";
import {
	createShiftTemplate,
	deleteShiftTemplate,
	getShiftTemplates,
	updateShiftTemplate,
} from "@/app/[locale]/(app)/scheduling/actions";
import type { ShiftTemplate } from "@/app/[locale]/(app)/scheduling/types";
import { queryKeys } from "@/lib/query/keys";

export type ShiftTemplateLocations = Array<{
	id: string;
	name: string;
	subareas: Array<{ id: string; name: string; isActive: boolean }>;
}>;

export interface ShiftTemplateValues {
	name: string;
	startTime: string;
	endTime: string;
	color?: string;
	subareaId?: string;
}

export function useShiftTemplateManagementController({
	organizationId,
	locations,
	manageableSubareaIds,
}: {
	organizationId: string;
	locations: ShiftTemplateLocations;
	manageableSubareaIds: string[] | null;
}) {
	const { t } = useTranslate();
	const queryClient = useQueryClient();
	const manageableSubareaIdSet = manageableSubareaIds
		? new Set(manageableSubareaIds)
		: null;
	const [dialogOpen, setDialogOpen] = useState(false);
	const [editingTemplate, setEditingTemplate] = useState<ShiftTemplate | null>(
		null,
	);
	const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
	const [templateToDelete, setTemplateToDelete] =
		useState<ShiftTemplate | null>(null);
	const { data: templates = [], isLoading } = useQuery({
		queryKey: queryKeys.shiftTemplates.list(organizationId),
		queryFn: async () => {
			const result = await getShiftTemplates();
			if (!result.success) throw new Error(result.error);
			return result.data;
		},
	});
	const invalidate = () =>
		queryClient.invalidateQueries({
			queryKey: queryKeys.shiftTemplates.list(organizationId),
		});
	const createMutation = useMutation({
		mutationFn: async (values: ShiftTemplateValues) => {
			const result = await createShiftTemplate(values);
			if (!result.success) throw new Error(result.error);
			return result.data;
		},
		onSuccess: () => {
			toast.success(
				t("settings.shiftTemplates.created", "Shift template created"),
			);
			invalidate();
			setDialogOpen(false);
		},
		onError: (error) =>
			toast.error(
				t("settings.shiftTemplates.createError", "Failed to create template"),
				{
					description: error.message,
				},
			),
	});
	const updateMutation = useMutation({
		mutationFn: async ({
			id,
			values,
		}: {
			id: string;
			values: ShiftTemplateValues;
		}) => {
			const result = await updateShiftTemplate(id, values);
			if (!result.success) throw new Error(result.error);
			return result.data;
		},
		onSuccess: () => {
			toast.success(
				t("settings.shiftTemplates.updated", "Shift template updated"),
			);
			invalidate();
			setDialogOpen(false);
			setEditingTemplate(null);
		},
		onError: (error) =>
			toast.error(
				t("settings.shiftTemplates.updateError", "Failed to update template"),
				{
					description: error.message,
				},
			),
	});
	const deleteMutation = useMutation({
		mutationFn: async (id: string) => {
			const result = await deleteShiftTemplate(id);
			if (!result.success) throw new Error(result.error);
		},
		onSuccess: () => {
			toast.success(
				t("settings.shiftTemplates.deleted", "Shift template deleted"),
			);
			invalidate();
			setDeleteDialogOpen(false);
			setTemplateToDelete(null);
		},
		onError: (error) =>
			toast.error(
				t("settings.shiftTemplates.deleteError", "Failed to delete template"),
				{
					description: error.message,
				},
			),
	});
	const toggleActiveMutation = useMutation({
		mutationFn: async ({ id, isActive }: { id: string; isActive: boolean }) => {
			const result = await updateShiftTemplate(id, { isActive });
			if (!result.success) throw new Error(result.error);
			return result.data;
		},
		onSuccess: (_, variables) => {
			toast.success(
				variables.isActive
					? t("settings.shiftTemplates.activated", "Template activated")
					: t("settings.shiftTemplates.deactivated", "Template deactivated"),
			);
			invalidate();
		},
		onError: (error) =>
			toast.error(
				t("settings.shiftTemplates.toggleError", "Failed to update template"),
				{
					description: error.message,
				},
			),
	});
	const visibleLocations = manageableSubareaIdSet
		? locations.flatMap((location) => {
				const subareas = location.subareas.filter((subarea) =>
					manageableSubareaIdSet.has(subarea.id),
				);
				return subareas.length > 0 ? [{ ...location, subareas }] : [];
			})
		: locations;

	return {
		createMutation,
		deleteDialogOpen,
		deleteMutation,
		dialogOpen,
		editingTemplate,
		isLoading,
		requireScopedSubareaSelection: manageableSubareaIdSet !== null,
		setDeleteDialogOpen,
		setDialogOpen,
		setEditingTemplate,
		setTemplateToDelete,
		templateToDelete,
		templates,
		toggleActiveMutation,
		updateMutation,
		visibleLocations,
	};
}

export type ShiftTemplateManagementController = ReturnType<
	typeof useShiftTemplateManagementController
>;
