"use client";

import {
	IconAlertTriangle,
	IconAward,
	IconCalendarDue,
	IconCertificate,
	IconFileCertificate,
	IconLanguage,
	IconLoader2,
	IconPencil,
	IconPlus,
	IconSchool,
	IconShieldCheck,
	IconTools,
	IconTrash,
} from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useStore } from "@tanstack/react-store";
import { useTolgee, useTranslate } from "@tolgee/react";
import { useState } from "react";
import { toast } from "sonner";
import {
	assignSkillToEmployee,
	removeSkillFromEmployee,
} from "@/app/[locale]/(app)/settings/skills/actions";
import {
	ActionPanel,
	ActionPanelBody,
	ActionPanelContent,
	ActionPanelDescription,
	ActionPanelFooter,
	ActionPanelHeader,
	ActionPanelTitle,
} from "@/components/ui/action-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DatePicker } from "@/components/ui/date-picker";
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
import { parsePlainDate } from "@/lib/datetime/temporal-core";
import { formatPlainDate } from "@/lib/datetime/temporal-format";
import type { EmployeeSkillWithDetails } from "@/lib/effect/services/skill.service";
import { queryKeys } from "@/lib/query/keys";
import {
	useEmployeeSkills,
	useOrganizationSkills,
	useSkillExpiryWindow,
	useUpdateEmployeeSkillExpiry,
} from "@/lib/query/use-skills";
import { type SkillExpiryBadge, skillExpiryBadge } from "@/lib/scheduling/skill-expiry";

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

/** A skill expiry date (`YYYY-MM-DD`) in the app language; never shifted by the viewer's zone. */
function formatExpiryDate(expiresAt: string, locale: string): string {
	return formatPlainDate(parsePlainDate(expiresAt), locale, "dateMedium");
}

export function EmployeeSkillsCard({
	employeeId,
	organizationId,
	canManageSkills,
}: EmployeeSkillsCardProps) {
	const { t } = useTranslate();
	const locale = useTolgee().getLanguage() || "en";
	const queryClient = useQueryClient();
	const [dialogOpen, setDialogOpen] = useState(false);
	const [editing, setEditing] = useState<EmployeeSkillWithDetails | null>(null);

	// Fetch employee's skills
	const { data: employeeSkills, isLoading } = useEmployeeSkills({
		employeeId,
		enabled: !!employeeId,
	});
	// Badges count from the organization's today, not the viewer's
	const { data: expiryWindow } = useSkillExpiryWindow({ organizationId });
	const badgeFor = (expiresAt: string | null): SkillExpiryBadge | null =>
		expiryWindow
			? skillExpiryBadge({
					expiresAt,
					today: expiryWindow.today,
					expiringSoonDays: expiryWindow.expiringSoonDays,
				})
			: null;

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
		if (
			confirm(
				t("settings.skills.confirmRemove", 'Remove "{skillName}" from this employee?', {
					skillName,
				}),
			)
		) {
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
							{t(
								"settings.skills.employeeSkillsDescription",
								"Certifications and skills assigned to this employee",
							)}
						</CardDescription>
					</div>
					{canManageSkills && (
						<Button size="sm" onClick={() => setDialogOpen(true)}>
							<IconPlus className="mr-2 size-4" aria-hidden="true" />
							{t("settings.skills.assignSkill", "Assign Skill")}
						</Button>
					)}
				</div>
			</CardHeader>
			<CardContent>
				{isLoading ? (
					<div className="flex items-center justify-center py-8">
						<IconLoader2 className="size-6 animate-spin text-muted-foreground" aria-hidden="true" />
					</div>
				) : skills.length === 0 ? (
					<div className="py-8 text-center text-muted-foreground">
						<IconAward className="mx-auto size-12 mb-4 opacity-50" aria-hidden="true" />
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
							const badge = badgeFor(employeeSkill.expiresAt);
							const expired = badge === "expired";
							const expiringSoon = badge === "expiringSoon";

							return (
								<div
									key={employeeSkill.id}
									className={`flex items-start justify-between rounded-lg border p-3 ${
										expired ? "border-destructive/50 bg-destructive/5" : ""
									} ${expiringSoon && !expired ? "border-yellow-500/50 bg-yellow-500/5" : ""}`}
								>
									<div className="flex items-start gap-3">
										<div
											className={`mt-0.5 ${expired ? "text-destructive" : "text-muted-foreground"}`}
										>
											<CategoryIcon className="size-5" aria-hidden="true" />
										</div>
										<div className="space-y-1">
											<div className="flex items-center gap-2">
												<span className="font-medium">{employeeSkill.skill.name}</span>
												{expired && (
													<Badge variant="destructive">
														<IconAlertTriangle className="mr-1 size-3" aria-hidden="true" />
														{t("settings.skills.expired", "Expired")}
													</Badge>
												)}
												{expiringSoon && !expired && (
													<Badge variant="secondary" className="bg-yellow-500/20 text-yellow-700">
														<IconCalendarDue className="mr-1 size-3" aria-hidden="true" />
														{t("settings.skills.expiringSoon", "Expiring Soon")}
													</Badge>
												)}
												{employeeSkill.certificateOnFile && (
													<Badge variant="outline">
														<IconFileCertificate className="mr-1 size-3" aria-hidden="true" />
														{t("settings.skills.certificateOnFile", "Certificate on file")}
													</Badge>
												)}
											</div>
											{employeeSkill.expiresAt && (
												<p
													className={`text-xs ${expired ? "text-destructive" : "text-muted-foreground"}`}
												>
													{expired
														? t("settings.skills.expiredOn", "Expired on {date}", {
																date: formatExpiryDate(employeeSkill.expiresAt, locale),
															})
														: t("settings.skills.expiresOn", "Expires {date}", {
																date: formatExpiryDate(employeeSkill.expiresAt, locale),
															})}
												</p>
											)}
											{employeeSkill.notes && (
												<p className="text-xs text-muted-foreground">{employeeSkill.notes}</p>
											)}
										</div>
									</div>
									{canManageSkills && (
										<TooltipProvider>
											<div className="flex items-center gap-1">
												<Tooltip>
													<TooltipTrigger asChild>
														<Button
															variant="ghost"
															size="icon"
															className="size-8"
															onClick={() => setEditing(employeeSkill)}
															aria-label={t(
																"settings.skills.editExpiryDateFor",
																"Edit expiry date of {skillName}",
																{ skillName: employeeSkill.skill.name },
															)}
														>
															<IconPencil className="size-4" aria-hidden="true" />
														</Button>
													</TooltipTrigger>
													<TooltipContent>
														{t("settings.skills.editExpiryDate", "Edit expiry date")}
													</TooltipContent>
												</Tooltip>
												<Tooltip>
													<TooltipTrigger asChild>
														<Button
															variant="ghost"
															size="icon"
															className="size-8"
															onClick={() =>
																handleRemove(employeeSkill.skillId, employeeSkill.skill.name)
															}
															disabled={removeMutation.isPending}
															aria-label={t("common.remove", "Remove")}
														>
															<IconTrash className="size-4" aria-hidden="true" />
														</Button>
													</TooltipTrigger>
													<TooltipContent>{t("common.remove", "Remove")}</TooltipContent>
												</Tooltip>
											</div>
										</TooltipProvider>
									)}
								</div>
							);
						})}
					</div>
				)}
			</CardContent>

			{/* Assign Skill ActionPanel */}
			{canManageSkills ? (
				<AssignSkillDialog
					employeeId={employeeId}
					organizationId={organizationId}
					existingSkillIds={skills.map((s) => s.skillId)}
					open={dialogOpen}
					onOpenChange={setDialogOpen}
					onSuccess={handleSuccess}
					minDate={expiryWindow?.today}
				/>
			) : null}

			{canManageSkills && editing ? (
				<EditSkillExpiryDialog
					key={editing.id}
					employeeId={employeeId}
					employeeSkill={editing}
					onClose={() => setEditing(null)}
				/>
			) : null}
		</Card>
	);
}

// ============================================
// Edit Skill Expiry Date ActionPanel
// ============================================

interface EditSkillExpiryDialogProps {
	employeeId: string;
	employeeSkill: EmployeeSkillWithDetails;
	onClose: () => void;
}

function EditSkillExpiryDialog({ employeeId, employeeSkill, onClose }: EditSkillExpiryDialogProps) {
	const { t } = useTranslate();
	const updateMutation = useUpdateEmployeeSkillExpiry();
	const requiresExpiry = employeeSkill.skill.requiresExpiry;

	const form = useForm({
		defaultValues: { expiresAt: employeeSkill.expiresAt ?? "" },
		onSubmit: async ({ value }) => {
			try {
				await updateMutation.mutateAsync({
					employeeId,
					skillId: employeeSkill.skillId,
					expiresAt: value.expiresAt || null,
				});
				toast.success(t("settings.skills.expiryDateUpdated", "Expiry date updated"));
				onClose();
			} catch (error) {
				toast.error(
					(error instanceof Error && error.message) ||
						t("settings.skills.expiryDateUpdateError", "Failed to update the expiry date"),
				);
			}
		},
	});

	const expiresAt = useStore(form.store, (state) => state.values.expiresAt);
	const isSubmitting = useStore(form.store, (state) => state.isSubmitting);

	return (
		<ActionPanel open onOpenChange={(open) => (open ? undefined : onClose())}>
			<ActionPanelContent>
				<ActionPanelHeader>
					<ActionPanelTitle>
						{t("settings.skills.editExpiryDate", "Edit expiry date")}
					</ActionPanelTitle>
					<ActionPanelDescription>
						{t(
							"settings.skills.editExpiryDateDescription",
							"The last day {skillName} is valid. Shifts after this day show it as expired.",
							{ skillName: employeeSkill.skill.name },
						)}
					</ActionPanelDescription>
				</ActionPanelHeader>

				<form
					onSubmit={(e) => {
						e.preventDefault();
						form.handleSubmit();
					}}
					className="flex min-h-0 flex-1 flex-col"
				>
					<ActionPanelBody className="grid gap-4">
						<form.Field name="expiresAt">
							{(field) => (
								<div className="grid gap-2">
									<Label htmlFor="edit-skill-expiry">
										{t("settings.skills.expiryDate", "Expiry Date")}
										{requiresExpiry && " *"}
									</Label>
									<DatePicker
										id="edit-skill-expiry"
										value={field.state.value}
										onChange={field.handleChange}
										onBlur={field.handleBlur}
										required={requiresExpiry}
									/>
									{requiresExpiry && (
										<p className="text-xs text-muted-foreground">
											{t(
												"settings.skills.expiryRequiredHint",
												"This certification requires an expiry date",
											)}
										</p>
									)}
								</div>
							)}
						</form.Field>
					</ActionPanelBody>

					<ActionPanelFooter>
						<Button type="button" variant="outline" onClick={onClose} disabled={isSubmitting}>
							{t("common.cancel", "Cancel")}
						</Button>
						<Button type="submit" disabled={isSubmitting || (requiresExpiry && !expiresAt)}>
							{isSubmitting && (
								<IconLoader2 className="mr-2 size-4 animate-spin" aria-hidden="true" />
							)}
							{t("common.save", "Save")}
						</Button>
					</ActionPanelFooter>
				</form>
			</ActionPanelContent>
		</ActionPanel>
	);
}

// ============================================
// Assign Skill ActionPanel
// ============================================

interface AssignSkillDialogProps {
	employeeId: string;
	organizationId: string;
	existingSkillIds: string[];
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onSuccess: () => void;
	/** The organization's today (`YYYY-MM-DD`), the earliest expiry date offered. */
	minDate?: string;
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
	minDate,
}: AssignSkillDialogProps) {
	const { t } = useTranslate();
	const queryClient = useQueryClient();

	// Fetch available skills
	const { data: allSkills, isLoading: isLoadingSkills } = useOrganizationSkills({
		organizationId,
		includeInactive: false,
		enabled: open,
	});

	// Filter out already assigned skills
	const existingSkillIdSet = new Set(existingSkillIds);
	const availableSkills = (allSkills ?? []).filter((s) => !existingSkillIdSet.has(s.id));

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
				// The picked plain day is the skill expiry date, never a timestamp
				expiresAt: data.expiresAt || null,
				notes: data.notes || undefined,
			});
			if (!result.success) throw new Error(result.error);
			return result.data;
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: queryKeys.skills.employee(employeeId) });
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
		<ActionPanel open={open} onOpenChange={handleOpenChange}>
			<ActionPanelContent>
				<ActionPanelHeader>
					<ActionPanelTitle>{t("settings.skills.assignSkill", "Assign Skill")}</ActionPanelTitle>
					<ActionPanelDescription>
						{t(
							"settings.skills.assignSkillDescription",
							"Add a skill or certification to this employee",
						)}
					</ActionPanelDescription>
				</ActionPanelHeader>

				<form
					onSubmit={(e) => {
						e.preventDefault();
						form.handleSubmit();
					}}
					className="flex min-h-0 flex-1 flex-col"
				>
					<ActionPanelBody className="grid gap-4">
						{/* Skill Selection */}
						<form.Field name="skillId">
							{(field) => (
								<div className="grid gap-2">
									<Label htmlFor="assign-skill">{t("settings.skills.skill", "Skill")} *</Label>
									{isLoadingSkills ? (
										<div className="flex items-center gap-2 text-muted-foreground">
											<IconLoader2 className="size-4 animate-spin" aria-hidden="true" />
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
										<Select value={field.state.value} onValueChange={field.handleChange}>
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
																<CategoryIcon className="size-4" aria-hidden="true" />
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
									<DatePicker
										id="assign-expiry"
										value={field.state.value}
										onChange={field.handleChange}
										onBlur={field.handleBlur}
										min={minDate}
									/>
									{selectedSkill?.requiresExpiry && (
										<p className="text-xs text-muted-foreground">
											{t(
												"settings.skills.expiryRequiredHint",
												"This certification requires an expiry date",
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
											"e.g., Certificate number, training date…",
										)}
										rows={2}
									/>
								</div>
							)}
						</form.Field>
					</ActionPanelBody>

					<ActionPanelFooter>
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
							disabled={
								assignMutation.isPending || !selectedSkillId || availableSkills.length === 0
							}
						>
							{assignMutation.isPending && (
								<IconLoader2 className="mr-2 size-4 animate-spin" aria-hidden="true" />
							)}
							{t("settings.skills.assign", "Assign")}
						</Button>
					</ActionPanelFooter>
				</form>
			</ActionPanelContent>
		</ActionPanel>
	);
}
