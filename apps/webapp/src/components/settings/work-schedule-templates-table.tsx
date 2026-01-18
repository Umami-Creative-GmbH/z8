"use client";

import {
	IconCopy,
	IconDots,
	IconLoader2,
	IconPencil,
	IconPlus,
	IconRefresh,
	IconStar,
	IconTrash,
} from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { useTranslate } from "@tolgee/react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
	deleteWorkScheduleTemplate,
	duplicateWorkScheduleTemplate,
	getWorkScheduleTemplates,
	setDefaultTemplate,
	type WorkScheduleTemplateWithDays,
} from "@/app/[locale]/(app)/settings/work-schedules/actions";
import {
	DataTable,
	DataTableSkeleton,
	DataTableToolbar,
} from "@/components/data-table-server";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { queryKeys } from "@/lib/query";

interface WorkScheduleTemplatesTableProps {
	organizationId: string;
	onCreateClick: () => void;
	onEditClick: (template: WorkScheduleTemplateWithDays) => void;
}

const cycleLabels: Record<string, string> = {
	daily: "Daily",
	weekly: "Weekly",
	biweekly: "Biweekly",
	monthly: "Monthly",
	yearly: "Yearly",
};

const workingDaysLabels: Record<string, string> = {
	weekdays: "Mon-Fri",
	weekends: "Sat-Sun",
	all_days: "All Days",
	custom: "Custom",
};

export function WorkScheduleTemplatesTable({
	organizationId,
	onCreateClick,
	onEditClick,
}: WorkScheduleTemplatesTableProps) {
	const { t } = useTranslate();
	const queryClient = useQueryClient();
	const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
	const [templateToDelete, setTemplateToDelete] = useState<WorkScheduleTemplateWithDays | null>(
		null,
	);
	const [search, setSearch] = useState("");

	// Fetch templates
	const {
		data: templates,
		isLoading,
		isFetching,
		isError,
		refetch,
	} = useQuery({
		queryKey: queryKeys.workScheduleTemplates.list(organizationId),
		queryFn: async () => {
			const result = await getWorkScheduleTemplates(organizationId);
			if (!result.success) {
				throw new Error(result.error || "Failed to fetch templates");
			}
			return result.data;
		},
	});

	// Delete mutation
	const deleteMutation = useMutation({
		mutationFn: (templateId: string) => deleteWorkScheduleTemplate(templateId),
		onSuccess: (result) => {
			if (result.success) {
				toast.success(t("settings.workSchedules.deleted", "Template deleted"));
				queryClient.invalidateQueries({
					queryKey: queryKeys.workScheduleTemplates.list(organizationId),
				});
				setDeleteDialogOpen(false);
				setTemplateToDelete(null);
			} else {
				toast.error(result.error || t("settings.workSchedules.deleteFailed", "Failed to delete"));
			}
		},
		onError: () => {
			toast.error(t("settings.workSchedules.deleteFailed", "Failed to delete template"));
		},
	});

	// Set default mutation
	const setDefaultMutation = useMutation({
		mutationFn: (templateId: string) => setDefaultTemplate(templateId),
		onSuccess: (result) => {
			if (result.success) {
				toast.success(t("settings.workSchedules.defaultSet", "Default template set"));
				queryClient.invalidateQueries({
					queryKey: queryKeys.workScheduleTemplates.list(organizationId),
				});
			} else {
				toast.error(
					result.error || t("settings.workSchedules.defaultFailed", "Failed to set default"),
				);
			}
		},
		onError: () => {
			toast.error(t("settings.workSchedules.defaultFailed", "Failed to set default template"));
		},
	});

	// Duplicate mutation
	const duplicateMutation = useMutation({
		mutationFn: (templateId: string) => duplicateWorkScheduleTemplate(templateId),
		onSuccess: (result) => {
			if (result.success) {
				toast.success(t("settings.workSchedules.duplicated", "Template duplicated"));
				queryClient.invalidateQueries({
					queryKey: queryKeys.workScheduleTemplates.list(organizationId),
				});
			} else {
				toast.error(
					result.error || t("settings.workSchedules.duplicateFailed", "Failed to duplicate"),
				);
			}
		},
		onError: () => {
			toast.error(t("settings.workSchedules.duplicateFailed", "Failed to duplicate template"));
		},
	});

	const handleDeleteClick = (template: WorkScheduleTemplateWithDays) => {
		setTemplateToDelete(template);
		setDeleteDialogOpen(true);
	};

	const handleDeleteConfirm = () => {
		if (templateToDelete) {
			deleteMutation.mutate(templateToDelete.id);
		}
	};

	const handleSetDefault = (templateId: string) => {
		setDefaultMutation.mutate(templateId);
	};

	const handleDuplicate = (templateId: string) => {
		duplicateMutation.mutate(templateId);
	};

	// Calculate total hours for detailed schedules
	const calculateTotalHours = (template: WorkScheduleTemplateWithDays): string => {
		if (template.scheduleType === "simple") {
			return template.hoursPerCycle || "0";
		}
		const total = template.days
			.filter((d) => d.isWorkDay)
			.reduce((sum, d) => sum + Number.parseFloat(d.hoursPerDay || "0"), 0);
		return total.toFixed(1);
	};

	// Filter templates by search (client-side since typically small list)
	const filteredTemplates = useMemo(() => {
		if (!templates) return [];
		if (!search) return templates;

		const searchLower = search.toLowerCase();
		return templates.filter(
			(tpl) =>
				tpl.name.toLowerCase().includes(searchLower) ||
				tpl.description?.toLowerCase().includes(searchLower),
		);
	}, [templates, search]);

	// Column definitions
	const columns = useMemo<ColumnDef<WorkScheduleTemplateWithDays>[]>(
		() => [
			{
				accessorKey: "name",
				header: t("settings.workSchedules.name", "Name"),
				cell: ({ row }) => (
					<div>
						<div className="flex items-center gap-2">
							<span className="font-medium">{row.original.name}</span>
							{row.original.isDefault && (
								<Badge variant="secondary" className="text-xs">
									<IconStar className="h-3 w-3 mr-1" />
									{t("settings.workSchedules.default", "Default")}
								</Badge>
							)}
						</div>
						{row.original.description && (
							<p className="text-xs text-muted-foreground mt-0.5">
								{row.original.description}
							</p>
						)}
					</div>
				),
			},
			{
				accessorKey: "scheduleCycle",
				header: t("settings.workSchedules.cycle.label", "Cycle"),
				cell: ({ row }) => (
					<Badge variant="outline">
						{cycleLabels[row.original.scheduleCycle] || row.original.scheduleCycle}
					</Badge>
				),
			},
			{
				accessorKey: "workingDaysPreset",
				header: t("settings.workSchedules.workingDays.label", "Working Days"),
				cell: ({ row }) => (
					<Badge variant="secondary">
						{workingDaysLabels[row.original.workingDaysPreset] || row.original.workingDaysPreset}
					</Badge>
				),
			},
			{
				accessorKey: "hours",
				header: () => (
					<div className="text-right">{t("settings.workSchedules.hours", "Hours")}</div>
				),
				cell: ({ row }) => (
					<div className="text-right tabular-nums">{calculateTotalHours(row.original)}h</div>
				),
			},
			{
				accessorKey: "homeOfficeDaysPerCycle",
				header: () => (
					<div className="text-right">{t("settings.workSchedules.homeOffice", "Home Office")}</div>
				),
				cell: ({ row }) => (
					<div className="text-right tabular-nums">
						{row.original.homeOfficeDaysPerCycle || 0}{" "}
						{t("settings.workSchedules.daysShort", "d")}
					</div>
				),
			},
			{
				id: "actions",
				cell: ({ row }) => (
					<DropdownMenu>
						<DropdownMenuTrigger asChild>
							<Button variant="ghost" size="icon" className="h-8 w-8">
								<IconDots className="h-4 w-4" />
								<span className="sr-only">{t("common.openMenu", "Open menu")}</span>
							</Button>
						</DropdownMenuTrigger>
						<DropdownMenuContent align="end">
							<DropdownMenuItem onClick={() => onEditClick(row.original)}>
								<IconPencil className="mr-2 h-4 w-4" />
								{t("common.edit", "Edit")}
							</DropdownMenuItem>
							<DropdownMenuItem
								onClick={() => handleDuplicate(row.original.id)}
								disabled={duplicateMutation.isPending}
							>
								<IconCopy className="mr-2 h-4 w-4" />
								{t("settings.workSchedules.duplicate", "Duplicate")}
							</DropdownMenuItem>
							{!row.original.isDefault && (
								<DropdownMenuItem onClick={() => handleSetDefault(row.original.id)}>
									<IconStar className="mr-2 h-4 w-4" />
									{t("settings.workSchedules.setDefault", "Set as Default")}
								</DropdownMenuItem>
							)}
							<DropdownMenuSeparator />
							<DropdownMenuItem
								className="text-destructive"
								onClick={() => handleDeleteClick(row.original)}
							>
								<IconTrash className="mr-2 h-4 w-4" />
								{t("common.delete", "Delete")}
							</DropdownMenuItem>
						</DropdownMenuContent>
					</DropdownMenu>
				),
			},
		],
		[t, onEditClick, duplicateMutation.isPending, calculateTotalHours],
	);

	if (isLoading) {
		return (
			<div className="space-y-4">
				<div className="flex justify-end">
					<Button onClick={onCreateClick}>
						<IconPlus className="mr-2 h-4 w-4" />
						{t("settings.workSchedules.createTemplate", "Create Template")}
					</Button>
				</div>
				<DataTableSkeleton columnCount={6} rowCount={5} />
			</div>
		);
	}

	if (isError) {
		return (
			<div className="flex flex-col items-center justify-center py-12 text-center border rounded-lg">
				<p className="text-destructive">
					{t("settings.workSchedules.loadError", "Failed to load templates")}
				</p>
				<Button className="mt-4" variant="outline" onClick={() => refetch()}>
					<IconRefresh className="mr-2 h-4 w-4" />
					{t("common.retry", "Retry")}
				</Button>
			</div>
		);
	}

	return (
		<div className="space-y-4">
			<DataTableToolbar
				search={search}
				onSearchChange={setSearch}
				searchPlaceholder={t(
					"settings.workSchedules.searchPlaceholder",
					"Search templates...",
				)}
				actions={
					<div className="flex items-center gap-2">
						<Button variant="ghost" size="icon" onClick={() => refetch()} disabled={isFetching}>
							{isFetching ? (
								<IconLoader2 className="h-4 w-4 animate-spin" />
							) : (
								<IconRefresh className="h-4 w-4" />
							)}
							<span className="sr-only">{t("common.refresh", "Refresh")}</span>
						</Button>
						<Button onClick={onCreateClick}>
							<IconPlus className="mr-2 h-4 w-4" />
							{t("settings.workSchedules.createTemplate", "Create Template")}
						</Button>
					</div>
				}
			/>

			<DataTable
				columns={columns}
				data={filteredTemplates}
				isFetching={isFetching}
				emptyMessage={
					search
						? t("settings.workSchedules.noSearchResults", "No templates match your search.")
						: t(
								"settings.workSchedules.noTemplates",
								"No work schedule templates. Create a template to define work schedules for your team.",
							)
				}
			/>

			<AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>
							{t("settings.workSchedules.deleteTitle", "Delete Template")}
						</AlertDialogTitle>
						<AlertDialogDescription>
							{t(
								"settings.workSchedules.deleteDescription",
								'Are you sure you want to delete "{name}"? This will also remove all assignments for this template. This action cannot be undone.',
								{ name: templateToDelete?.name },
							)}
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel disabled={deleteMutation.isPending}>
							{t("common.cancel", "Cancel")}
						</AlertDialogCancel>
						<AlertDialogAction
							onClick={handleDeleteConfirm}
							className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
							disabled={deleteMutation.isPending}
						>
							{deleteMutation.isPending && <IconLoader2 className="mr-2 h-4 w-4 animate-spin" />}
							{t("common.delete", "Delete")}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</div>
	);
}
