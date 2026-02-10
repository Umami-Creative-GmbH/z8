"use client";

import { useForm } from "@tanstack/react-form";
import { useStore } from "@tanstack/react-store";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import {
	IconAlertTriangle,
	IconAward,
	IconCalendarDue,
	IconCertificate,
	IconLanguage,
	IconLoader2,
	IconPlus,
	IconSchool,
	IconShieldCheck,
	IconTools,
	IconTrash,
} from "@tabler/icons-react";
import { DateTime } from "luxon";
import { useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import {
	assignSkillToEmployee,
	removeSkillFromEmployee,
} from "@/app/[locale]/(app)/settings/skills/actions";
import type { EmployeeSkillWithDetails } from "@/lib/effect/services/skill.service";
import {
	useEmployeeSkills,
	useOrganizationSkills,
} from "@/lib/query/use-skills";
import { queryKeys } from "@/lib/query/keys";

type SkillCategory = "safety" | "equipment" | "certification" | "training" | "language" | "custom";

interface EmployeeSkillsCardProps {
	employeeId: string;
	organizationId: string;
	isAdmin: boolean;
}

const CATEGORY_ICONS: Record<SkillCategory, typeof IconShieldCheck> = {
	safety: IconShieldCheck,
	equipment: IconTools,
	certification: IconCertificate,
	training: IconSchool,
	language: IconLanguage,
	custom: IconAward,
};

function getCategoryIcon(category: SkillCategory) {
	return CATEGORY_ICONS[category] ?? IconAward;
}

function isExpired(expiresAt: Date | null): boolean {
	if (!expiresAt) return false;
	return DateTime.fromJSDate(expiresAt) < DateTime.now();
}

function isExpiringSoon(expiresAt: Date | null, days = 30): boolean {
	if (!expiresAt) return false;
	const expiry = DateTime.fromJSDate(expiresAt);
	const threshold = DateTime.now().plus({ days });
	return expiry > DateTime.now() && expiry <= threshold;
}

export function EmployeeSkillsCard({
	employeeId,
	organizationId,
	isAdmin,
}: EmployeeSkillsCardProps) {
	const { t } = useTranslate();
	const queryClient = useQueryClient();
	const [dialogOpen, setDialogOpen] = useState(false);

	// Fetch employee's skills
	const { data: employeeSkills, isLoading } = useEmployeeSkills({
		employeeId,
		enabled: !!employeeId,
	});

	// Remove skill mutation
	const removeMutation = useMutation({
		mutationFn: async ({ skillId }: { skillId: string }) => {
			const result = await removeSkillFromEmployee(employeeId, skillId);
			if (!result.success) throw new Error(result.error);
		},
		onSuccess: () => {
			toast.success(t("settings.skills.skillRemoved", "Skill removed"));
			queryClient.invalidateQueries({ queryKey: queryKeys.skills.employee(employeeId) });
		},
		onError: (error) => {
			toast.error(error.message || t("settings.skills.removeError", "Failed to remove skill"));
		},
	});

	const handleRemove = (skillId: string, skillName: string) => {
		if (confirm(t("settings.skills.confirmRemove", `Remove "${skillName}" from this employee?`))) {
			removeMutation.mutate({ skillId });
		}
	};

	const handleSuccess = () => {
		queryClient.invalidateQueries({ queryKey: queryKeys.skills.employee(employeeId) });
		setDialogOpen(false);
	};

	const skills = employeeSkills ?? [];

	return (
		<Card>
			<CardHeader>
				<div className="flex items-center justify-between">
					<div>
						<CardTitle>{t("settings.skills.employeeSkills", "Skills & Qualifications")}</CardTitle>
						<CardDescription>
							{t("settings.skills.employeeSkillsDescription", "Certifications and skills assigned to this employee")}
						</CardDescription>
					</div>
					{isAdmin && (
						<Button size="sm" onClick={() => setDialogOpen(true)}>
							<IconPlus className="mr-2 h-4 w-4" aria-hidden="true" />
							{t("settings.skills.assignSkill", "Assign Skill")}
						</Button>
					)}
				</div>
			</CardHeader>
			<CardContent>
				{isLoading ? (
					<div className="flex items-center justify-center py-8">
						<IconLoader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-hidden="true" />
					</div>
				) : skills.length === 0 ? (
					<div className="py-8 text-center text-muted-foreground">
						<IconAward className="mx-auto h-12 w-12 mb-4 opacity-50" aria-hidden="true" />
						<p>{t("settings.skills.noSkillsAssigned", "No skills assigned")}</p>
						{isAdmin && (
							<p className="text-sm mt-1">
								{t("settings.skills.assignSkillHint", "Click 'Assign Skill' to add qualifications")}
							</p>
						)}
					</div>
				) : (
					<div className="space-y-3">
						{skills.map((employeeSkill) => {
							const CategoryIcon = getCategoryIcon(employeeSkill.skill.category as SkillCategory);
							const expired = isExpired(employeeSkill.expiresAt);
							const expiringSoon = isExpiringSoon(employeeSkill.expiresAt);

							return (
								<div
									key={employeeSkill.id}
									className={`flex items-start justify-between rounded-lg border p-3 ${
										expired ? "border-destructive/50 bg-destructive/5" : ""
									} ${expiringSoon && !expired ? "border-yellow-500/50 bg-yellow-500/5" : ""}`}
								>
									<div className="flex items-start gap-3">
										<div className={`mt-0.5 ${expired ? "text-destructive" : "text-muted-foreground"}`}>
											<CategoryIcon className="h-5 w-5" aria-hidden="true" />
										</div>
										<div className="space-y-1">
											<div className="flex items-center gap-2">
												<span className="font-medium">{employeeSkill.skill.name}</span>
												{expired && (
													<Badge variant="destructive">
														<IconAlertTriangle className="mr-1 h-3 w-3" aria-hidden="true" />
														{t("settings.skills.expired", "Expired")}
													</Badge>
												)}
												{expiringSoon && !expired && (
													<Badge variant="secondary" className="bg-yellow-500/20 text-yellow-700">
														<IconCalendarDue className="mr-1 h-3 w-3" aria-hidden="true" />
														{t("settings.skills.expiringSoon", "Expiring Soon")}
													</Badge>
												)}
											</div>
											{employeeSkill.expiresAt && (
												<p className={`text-xs ${expired ? "text-destructive" : "text-muted-foreground"}`}>
													{expired
														? t("settings.skills.expiredOn", "Expired on {{date}}", {
																date: DateTime.fromJSDate(employeeSkill.expiresAt).toLocaleString(
																	DateTime.DATE_MED
																),
															})
														: t("settings.skills.expiresOn", "Expires {{date}}", {
																date: DateTime.fromJSDate(employeeSkill.expiresAt).toLocaleString(
																	DateTime.DATE_MED
																),
															})}
												</p>
											)}
											{employeeSkill.notes && (
												<p className="text-xs text-muted-foreground">{employeeSkill.notes}</p>
											)}
										</div>
									</div>
									{isAdmin && (
										<TooltipProvider>
											<Tooltip>
												<TooltipTrigger asChild>
													<Button
														variant="ghost"
														size="icon"
														className="h-8 w-8"
														onClick={() => handleRemove(employeeSkill.skillId, employeeSkill.skill.name)}
														disabled={removeMutation.isPending}
														aria-label={t("common.remove", "Remove")}
													>
														<IconTrash className="h-4 w-4" aria-hidden="true" />
													</Button>
												</TooltipTrigger>
												<TooltipContent>{t("common.remove", "Remove")}</TooltipContent>
											</Tooltip>
										</TooltipProvider>
									)}
								</div>
							);
						})}
					</div>
				)}
			</CardContent>

			{/* Assign Skill Dialog */}
			<AssignSkillDialog
				employeeId={employeeId}
				organizationId={organizationId}
				existingSkillIds={skills.map((s) => s.skillId)}
				open={dialogOpen}
				onOpenChange={setDialogOpen}
				onSuccess={handleSuccess}
			/>
		</Card>
	);
}

// ============================================
// Assign Skill Dialog
// ============================================

interface AssignSkillDialogProps {
	employeeId: string;
	organizationId: string;
	existingSkillIds: string[];
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onSuccess: () => void;
}

interface AssignSkillFormValues {
	skillId: string;
	expiresAt: string;
	notes: string;
}

function AssignSkillDialog({
	employeeId,
	organizationId,
	existingSkillIds,
	open,
	onOpenChange,
	onSuccess,
}: AssignSkillDialogProps) {
	const { t } = useTranslate();

	// Fetch available skills
	const { data: allSkills, isLoading: isLoadingSkills } = useOrganizationSkills({
		organizationId,
		includeInactive: false,
		enabled: open,
	});

	// Filter out already assigned skills
	const availableSkills = (allSkills ?? []).filter((s) => !existingSkillIds.includes(s.id));

	const defaultValues: AssignSkillFormValues = {
		skillId: "",
		expiresAt: "",
		notes: "",
	};

	const form = useForm({
		defaultValues,
		onSubmit: async ({ value }) => {
			assignMutation.mutate(value);
		},
	});

	const assignMutation = useMutation({
		mutationFn: async (data: AssignSkillFormValues) => {
			const result = await assignSkillToEmployee({
				employeeId,
				skillId: data.skillId,
				expiresAt: data.expiresAt ? new Date(data.expiresAt) : undefined,
				notes: data.notes || undefined,
			});
			if (!result.success) throw new Error(result.error);
			return result.data;
		},
		onSuccess: () => {
			toast.success(t("settings.skills.skillAssigned", "Skill assigned"));
			form.reset();
			onSuccess();
		},
		onError: (error) => {
			toast.error(error.message || t("settings.skills.assignError", "Failed to assign skill"));
		},
	});

	// Get selected skill to check if it requires expiry
	const selectedSkillId = useStore(form.store, (state) => state.values.skillId);
	const selectedSkill = availableSkills.find((s) => s.id === selectedSkillId);

	const handleOpenChange = (newOpen: boolean) => {
		if (!newOpen) {
			form.reset();
		}
		onOpenChange(newOpen);
	};

	return (
		<Dialog open={open} onOpenChange={handleOpenChange}>
			<DialogContent className="sm:max-w-[450px]">
				<DialogHeader>
					<DialogTitle>{t("settings.skills.assignSkill", "Assign Skill")}</DialogTitle>
					<DialogDescription>
						{t("settings.skills.assignSkillDescription", "Add a skill or certification to this employee")}
					</DialogDescription>
				</DialogHeader>

				<form
					onSubmit={(e) => {
						e.preventDefault();
						form.handleSubmit();
					}}
				>
					<div className="grid gap-4 py-4">
						{/* Skill Selection */}
						<form.Field name="skillId">
							{(field) => (
								<div className="grid gap-2">
									<Label htmlFor="assign-skill">{t("settings.skills.skill", "Skill")} *</Label>
									{isLoadingSkills ? (
										<div className="flex items-center gap-2 text-muted-foreground">
											<IconLoader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
											{t("common.loading", "Loading…")}
										</div>
									) : availableSkills.length === 0 ? (
										<p className="text-sm text-muted-foreground">
											{t(
												"settings.skills.noAvailableSkills",
												"All skills have been assigned or no skills are defined"
											)}
										</p>
									) : (
										<Select
											value={field.state.value}
											onValueChange={field.handleChange}
										>
											<SelectTrigger id="assign-skill">
												<SelectValue placeholder={t("settings.skills.selectSkill", "Select a skill")} />
											</SelectTrigger>
											<SelectContent>
												{availableSkills.map((skill) => {
													const CategoryIcon = getCategoryIcon(skill.category as SkillCategory);
													return (
														<SelectItem key={skill.id} value={skill.id}>
															<span className="flex items-center gap-2">
																<CategoryIcon className="h-4 w-4" aria-hidden="true" />
																{skill.name}
																{skill.requiresExpiry && (
																	<Badge variant="outline" className="ml-2 text-xs">
																		{t("settings.skills.expiryRequired", "Expiry Required")}
																	</Badge>
																)}
															</span>
														</SelectItem>
													);
												})}
											</SelectContent>
										</Select>
									)}
								</div>
							)}
						</form.Field>

						{/* Expiry Date */}
						<form.Field name="expiresAt">
							{(field) => (
								<div className="grid gap-2">
									<Label htmlFor="assign-expiry">
										{t("settings.skills.expiryDate", "Expiry Date")}
										{selectedSkill?.requiresExpiry && " *"}
									</Label>
									<Input
										id="assign-expiry"
										type="date"
										value={field.state.value}
										onChange={(e) => field.handleChange(e.target.value)}
										onBlur={field.handleBlur}
										min={DateTime.now().toISODate() ?? undefined}
									/>
									{selectedSkill?.requiresExpiry && (
										<p className="text-xs text-muted-foreground">
											{t(
												"settings.skills.expiryRequiredHint",
												"This certification requires an expiry date"
											)}
										</p>
									)}
								</div>
							)}
						</form.Field>

						{/* Notes */}
						<form.Field name="notes">
							{(field) => (
								<div className="grid gap-2">
									<Label htmlFor="assign-notes">{t("settings.skills.notes", "Notes")}</Label>
									<Textarea
										id="assign-notes"
										value={field.state.value}
										onChange={(e) => field.handleChange(e.target.value)}
										onBlur={field.handleBlur}
										placeholder={t(
											"settings.skills.notesPlaceholder",
											"e.g., Certificate number, training date…"
										)}
										rows={2}
									/>
								</div>
							)}
						</form.Field>
					</div>

					<DialogFooter>
						<Button
							type="button"
							variant="outline"
							onClick={() => onOpenChange(false)}
							disabled={assignMutation.isPending}
						>
							{t("common.cancel", "Cancel")}
						</Button>
						<Button
							type="submit"
							disabled={assignMutation.isPending || !selectedSkillId || availableSkills.length === 0}
						>
							{assignMutation.isPending && <IconLoader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
							{t("settings.skills.assign", "Assign")}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
