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
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import { toast } from "sonner";
import {
	deleteWorkScheduleTemplate,
	duplicateWorkScheduleTemplate,
	getWorkScheduleTemplates,
	setDefaultTemplate,
	type WorkScheduleTemplateWithDays,
} from "@/app/[locale]/(app)/settings/work-schedules/actions";
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
import { Skeleton } from "@/components/ui/skeleton";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
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

	// Fetch templates
	const {
		data: templates,
		isLoading,
		error,
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
			.reduce((sum, d) => sum + parseFloat(d.hoursPerDay || "0"), 0);
		return total.toFixed(1);
	};

	if (isLoading) {
		return (
			<div className="space-y-2">
				<div className="flex justify-end">
					<Skeleton className="h-10 w-32" />
				</div>
				<Skeleton className="h-10 w-full" />
				<Skeleton className="h-10 w-full" />
				<Skeleton className="h-10 w-full" />
			</div>
		);
	}

	if (error) {
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
			<div className="flex items-center justify-end gap-2">
				<Button variant="ghost" size="icon" onClick={() => refetch()}>
					<IconRefresh className="h-4 w-4" />
					<span className="sr-only">{t("common.refresh", "Refresh")}</span>
				</Button>
				<Button onClick={onCreateClick}>
					<IconPlus className="mr-2 h-4 w-4" />
					{t("settings.workSchedules.createTemplate", "Create Template")}
				</Button>
			</div>

			{!templates || templates.length === 0 ? (
				<div className="flex flex-col items-center justify-center py-12 text-center border rounded-lg">
					<p className="text-muted-foreground">
						{t("settings.workSchedules.noTemplates", "No work schedule templates")}
					</p>
					<p className="text-muted-foreground text-sm mt-1">
						{t(
							"settings.workSchedules.noTemplatesDescription",
							"Create a template to define work schedules for your team.",
						)}
					</p>
					<Button className="mt-4" onClick={onCreateClick}>
						<IconPlus className="mr-2 h-4 w-4" />
						{t("settings.workSchedules.createTemplate", "Create Template")}
					</Button>
				</div>
			) : (
				<div className="rounded-md border">
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>{t("settings.workSchedules.name", "Name")}</TableHead>
								<TableHead>{t("settings.workSchedules.cycle", "Cycle")}</TableHead>
								<TableHead>{t("settings.workSchedules.workingDays", "Working Days")}</TableHead>
								<TableHead className="text-right">
									{t("settings.workSchedules.hours", "Hours")}
								</TableHead>
								<TableHead className="text-right">
									{t("settings.workSchedules.homeOffice", "Home Office")}
								</TableHead>
								<TableHead className="w-[70px]" />
							</TableRow>
						</TableHeader>
						<TableBody>
							{templates.map((template) => (
								<TableRow key={template.id}>
									<TableCell className="font-medium">
										<div className="flex items-center gap-2">
											{template.name}
											{template.isDefault && (
												<Badge variant="secondary" className="text-xs">
													<IconStar className="h-3 w-3 mr-1" />
													{t("settings.workSchedules.default", "Default")}
												</Badge>
											)}
										</div>
										{template.description && (
											<p className="text-xs text-muted-foreground mt-0.5">{template.description}</p>
										)}
									</TableCell>
									<TableCell>
										<Badge variant="outline">
											{cycleLabels[template.scheduleCycle] || template.scheduleCycle}
										</Badge>
									</TableCell>
									<TableCell>
										<Badge variant="secondary">
											{workingDaysLabels[template.workingDaysPreset] || template.workingDaysPreset}
										</Badge>
									</TableCell>
									<TableCell className="text-right tabular-nums">
										{calculateTotalHours(template)}h
									</TableCell>
									<TableCell className="text-right tabular-nums">
										{template.homeOfficeDaysPerCycle || 0}{" "}
										{t("settings.workSchedules.daysShort", "d")}
									</TableCell>
									<TableCell>
										<DropdownMenu>
											<DropdownMenuTrigger asChild>
												<Button variant="ghost" size="icon" className="h-8 w-8">
													<IconDots className="h-4 w-4" />
													<span className="sr-only">{t("common.openMenu", "Open menu")}</span>
												</Button>
											</DropdownMenuTrigger>
											<DropdownMenuContent align="end">
												<DropdownMenuItem onClick={() => onEditClick(template)}>
													<IconPencil className="mr-2 h-4 w-4" />
													{t("common.edit", "Edit")}
												</DropdownMenuItem>
												<DropdownMenuItem
													onClick={() => handleDuplicate(template.id)}
													disabled={duplicateMutation.isPending}
												>
													<IconCopy className="mr-2 h-4 w-4" />
													{t("settings.workSchedules.duplicate", "Duplicate")}
												</DropdownMenuItem>
												{!template.isDefault && (
													<DropdownMenuItem onClick={() => handleSetDefault(template.id)}>
														<IconStar className="mr-2 h-4 w-4" />
														{t("settings.workSchedules.setDefault", "Set as Default")}
													</DropdownMenuItem>
												)}
												<DropdownMenuSeparator />
												<DropdownMenuItem
													className="text-destructive"
													onClick={() => handleDeleteClick(template)}
												>
													<IconTrash className="mr-2 h-4 w-4" />
													{t("common.delete", "Delete")}
												</DropdownMenuItem>
											</DropdownMenuContent>
										</DropdownMenu>
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				</div>
			)}

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
