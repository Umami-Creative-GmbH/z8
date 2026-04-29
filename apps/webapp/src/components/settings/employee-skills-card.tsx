"use client";

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
import { useForm } from "@tanstack/react-form";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useStore } from "@tanstack/react-store";
import { useTranslate } from "@tolgee/react";
import { DateTime } from "luxon";
import { useState } from "react";
import { toast } from "sonner";
import {
	assignSkillToEmployee,
	removeSkillFromEmployee,
} from "@/app/[locale]/(app)/settings/skills/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { getQualificationStatus } from "@/lib/qualifications/status";
import { queryKeys } from "@/lib/query/keys";
import { useEmployeeSkills, useOrganizationSkills } from "@/lib/query/use-skills";

type SkillCategory = "safety" | "equipment" | "certification" | "training" | "language" | "custom";

interface EmployeeSkillsCardProps {
	employeeId: string;
	organizationId: string;
	canManageSkills: boolean;
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

export function EmployeeSkillsCard({
	employeeId,
	organizationId,
	canManageSkills,
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
			queryClient.invalidateQueries({ queryKey: queryKeys.skills.all });
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
		queryClient.invalidateQueries({ queryKey: queryKeys.skills.all });
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
							{t(
								"settings.skills.employeeSkillsDescription",
								"Certifications and skills assigned to this employee",
							)}
						</CardDescription>
					</div>
					{canManageSkills && (
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
						<IconLoader2
							className="h-6 w-6 animate-spin text-muted-foreground"
							aria-hidden="true"
						/>
					</div>
				) : skills.length === 0 ? (
					<div className="py-8 text-center text-muted-foreground">
						<IconAward className="mx-auto h-12 w-12 mb-4 opacity-50" aria-hidden="true" />
						<p>{t("settings.skills.noSkillsAssigned", "No skills assigned")}</p>
						{canManageSkills && (
							<p className="text-sm mt-1">
								{t("settings.skills.assignSkillHint", "Click 'Assign Skill' to add qualifications")}
							</p>
						)}
					</div>
				) : (
					<div className="space-y-3">
						{skills.map((employeeSkill) => {
							const CategoryIcon = getCategoryIcon(employeeSkill.skill.category as SkillCategory);
							const qualificationStatus = getQualificationStatus({
								expiresAt: employeeSkill.expiresAt,
								warningDays: employeeSkill.skill.expiryWarningDays ?? 30,
							});
							const expired = qualificationStatus === "expired";
							const expiringSoon = qualificationStatus === "expiringSoon";

							return (
								<div
									key={employeeSkill.id}
									className={`flex items-start justify-between rounded-lg border p-3 ${
										expired ? "border-destructive/50 bg-destructive/5" : ""
									} ${expiringSoon && !expired ? "border-yellow-500/50 bg-yellow-500/5" : ""}`}
								>
									<div className="flex min-w-0 items-start gap-3">
										<div
											className={`mt-0.5 ${expired ? "text-destructive" : "text-muted-foreground"}`}
										>
											<CategoryIcon className="h-5 w-5" aria-hidden="true" />
										</div>
										<div className="min-w-0 space-y-1">
											<div className="flex items-center gap-2">
												<span className="break-words font-medium">{employeeSkill.skill.name}</span>
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
												<p
													className={`text-xs ${expired ? "text-destructive" : "text-muted-foreground"}`}
												>
													{expired
														? t("settings.skills.expiredOn", "Expired on {{date}}", {
																date: DateTime.fromJSDate(employeeSkill.expiresAt, {
																	zone: "utc",
																}).toLocaleString(DateTime.DATE_MED),
															})
														: t("settings.skills.expiresOn", "Expires {{date}}", {
																date: DateTime.fromJSDate(employeeSkill.expiresAt, {
																	zone: "utc",
																}).toLocaleString(DateTime.DATE_MED),
															})}
												</p>
											)}
											{employeeSkill.issuedAt && (
												<p className="break-words text-xs text-muted-foreground">
													{t("settings.skills.issuedOn", "Issued {{date}}", {
														date: DateTime.fromJSDate(employeeSkill.issuedAt, {
															zone: "utc",
														}).toLocaleString(DateTime.DATE_MED),
													})}
												</p>
											)}
											{employeeSkill.issuer && (
												<p className="break-words text-xs text-muted-foreground">
													{t("settings.skills.issuerValue", "Issuer: {{issuer}}", {
														issuer: employeeSkill.issuer,
													})}
												</p>
											)}
											{employeeSkill.certificateNumber && (
												<p className="break-words text-xs text-muted-foreground">
													{t(
														"settings.skills.certificateNumberValue",
														"Certificate: {{certificateNumber}}",
														{
															certificateNumber: employeeSkill.certificateNumber,
														},
													)}
												</p>
											)}
											{employeeSkill.notes && (
												<p className="break-words text-xs text-muted-foreground">
													{employeeSkill.notes}
												</p>
											)}
										</div>
									</div>
									{canManageSkills && (
										<TooltipProvider>
											<Tooltip>
												<TooltipTrigger asChild>
													<Button
														variant="ghost"
														size="icon"
														className="h-8 w-8"
														onClick={() =>
															handleRemove(employeeSkill.skillId, employeeSkill.skill.name)
														}
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
			{canManageSkills ? (
				<AssignSkillDialog
					employeeId={employeeId}
					organizationId={organizationId}
					existingSkillIds={skills.map((s) => s.skillId)}
					open={dialogOpen}
					onOpenChange={setDialogOpen}
					onSuccess={handleSuccess}
				/>
			) : null}
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
	issuedAt: string;
	expiresAt: string;
	issuer: string;
	certificateNumber: string;
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
		issuedAt: "",
		expiresAt: "",
		issuer: "",
		certificateNumber: "",
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
			const issuer = data.issuer.trim();
			const certificateNumber = data.certificateNumber.trim();
			const notes = data.notes.trim();
			const result = await assignSkillToEmployee({
				employeeId,
				skillId: data.skillId,
				issuedAt: data.issuedAt
					? DateTime.fromISO(data.issuedAt, { zone: "utc" }).toJSDate()
					: undefined,
				expiresAt: data.expiresAt
					? DateTime.fromISO(data.expiresAt, { zone: "utc" }).toJSDate()
					: undefined,
				issuer: issuer || undefined,
				certificateNumber: certificateNumber || undefined,
				notes: notes || undefined,
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
						{t(
							"settings.skills.assignSkillDescription",
							"Add a skill or certification to this employee",
						)}
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
						<form.Field
							name="skillId"
							validators={{
								onSubmit: ({ value }) =>
									value ? undefined : t("settings.skills.skillRequired", "Skill is required"),
							}}
						>
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
												"All skills have been assigned or no skills are defined",
											)}
										</p>
									) : (
										<Select
											name="skillId"
											value={field.state.value}
											onValueChange={field.handleChange}
										>
											<SelectTrigger id="assign-skill">
												<SelectValue
													placeholder={t("settings.skills.selectSkill", "Select a skill")}
												/>
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
									{field.state.meta.errors.length > 0 && (
										<p className="text-sm text-destructive" aria-live="polite">
											{field.state.meta.errors[0]}
										</p>
									)}
								</div>
							)}
						</form.Field>

						{/* Expiry Date */}
						<form.Field
							name="expiresAt"
							validators={{
								onSubmit: ({ value }) =>
									selectedSkill?.requiresExpiry && !value
										? t(
												"settings.skills.expiryDateRequired",
												"Expiry date is required for this skill",
											)
										: undefined,
							}}
						>
							{(field) => (
								<div className="grid gap-2">
									<Label htmlFor="assign-expiry">
										{t("settings.skills.expiryDate", "Expiry Date")}
										{selectedSkill?.requiresExpiry && " *"}
									</Label>
									<Input
										id="assign-expiry"
										name="expiresAt"
										type="date"
										autoComplete="off"
										value={field.state.value}
										onChange={(e) => field.handleChange(e.target.value)}
										onBlur={field.handleBlur}
										min={DateTime.now().toISODate() ?? undefined}
									/>
									{selectedSkill?.requiresExpiry && (
										<p className="text-xs text-muted-foreground">
											{t(
												"settings.skills.expiryRequiredHint",
												"This certification requires an expiry date",
											)}
										</p>
									)}
									{field.state.meta.errors.length > 0 && (
										<p className="text-sm text-destructive" aria-live="polite">
											{field.state.meta.errors[0]}
										</p>
									)}
								</div>
							)}
						</form.Field>

						{/* Issue Date */}
						<form.Field name="issuedAt">
							{(field) => (
								<div className="grid gap-2">
									<Label htmlFor="assign-issued-at">
										{t("settings.skills.issueDate", "Issue Date")}
									</Label>
									<Input
										id="assign-issued-at"
										name="issuedAt"
										type="date"
										autoComplete="off"
										value={field.state.value}
										onChange={(e) => field.handleChange(e.target.value)}
										onBlur={field.handleBlur}
										max={DateTime.now().toISODate() ?? undefined}
									/>
								</div>
							)}
						</form.Field>

						{/* Issuer */}
						<form.Field name="issuer">
							{(field) => (
								<div className="grid gap-2">
									<Label htmlFor="assign-issuer">{t("settings.skills.issuer", "Issuer")}</Label>
									<Input
										id="assign-issuer"
										name="issuer"
										autoComplete="off"
										value={field.state.value}
										onChange={(e) => field.handleChange(e.target.value)}
										onBlur={field.handleBlur}
										placeholder={t("settings.skills.issuerPlaceholder", "e.g., Safety Council…")}
									/>
								</div>
							)}
						</form.Field>

						{/* Certificate Number */}
						<form.Field name="certificateNumber">
							{(field) => (
								<div className="grid gap-2">
									<Label htmlFor="assign-certificate-number">
										{t("settings.skills.certificateNumber", "Certificate Number")}
									</Label>
									<Input
										id="assign-certificate-number"
										name="certificateNumber"
										autoComplete="off"
										spellCheck={false}
										value={field.state.value}
										onChange={(e) => field.handleChange(e.target.value)}
										onBlur={field.handleBlur}
										placeholder={t(
											"settings.skills.certificateNumberPlaceholder",
											"e.g., CERT-12345…",
										)}
									/>
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
										name="notes"
										autoComplete="off"
										value={field.state.value}
										onChange={(e) => field.handleChange(e.target.value)}
										onBlur={field.handleBlur}
										placeholder={t(
											"settings.skills.notesPlaceholder",
											"e.g., Certificate number, training date…",
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
							onClick={() => handleOpenChange(false)}
							disabled={assignMutation.isPending}
						>
							{t("common.cancel", "Cancel")}
						</Button>
						<Button
							type="submit"
							disabled={assignMutation.isPending || availableSkills.length === 0}
						>
							{assignMutation.isPending && (
								<IconLoader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
							)}
							{t("settings.skills.assign", "Assign")}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
