"use client";

import {
	IconPencil,
	IconPlus,
	IconShieldCheck,
	IconTarget,
	IconTrash,
} from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import { toast } from "sonner";
import {
	deleteCoverageRule,
	getCoverageRules,
	getCoverageSettings,
	updateCoverageSettings,
} from "@/app/[locale]/(app)/settings/coverage-rules/actions";
import { DeleteConfirmDialog } from "@/components/settings/delete-confirm-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { LoadingRegion } from "@/components/ui/loading-region";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import type { CoverageRuleWithRelations } from "@/lib/effect/services/coverage.service";
import { actionErrorMessage } from "@/lib/organization-action/action-error-message";
import { queryKeys } from "@/lib/query/keys";
import { CoverageRuleDialog } from "./coverage-rule-dialog";
import { SettingsLoadError } from "./settings-load-error";

interface CoverageRulesManagementProps {
	organizationId: string;
	locations: Array<{
		id: string;
		name: string;
		subareas: Array<{
			id: string;
			name: string;
			isActive: boolean;
		}>;
	}>;
	manageableSubareaIds: string[] | null;
	canManageCoverageSettings: boolean;
}

/** The translated weekday of a coverage rule; the stored value only when it is unknown. */
function useDayLabel() {
	const { t } = useTranslate();
	const labels: Record<string, string> = {
		monday: t("common.days.monday", "Monday"),
		tuesday: t("common.days.tuesday", "Tuesday"),
		wednesday: t("common.days.wednesday", "Wednesday"),
		thursday: t("common.days.thursday", "Thursday"),
		friday: t("common.days.friday", "Friday"),
		saturday: t("common.days.saturday", "Saturday"),
		sunday: t("common.days.sunday", "Sunday"),
	};
	return (day: string) => labels[day] ?? day;
}

export function CoverageRulesManagement({
	organizationId,
	locations,
	manageableSubareaIds,
	canManageCoverageSettings,
}: CoverageRulesManagementProps) {
	const { t } = useTranslate();
	const dayLabel = useDayLabel();
	const queryClient = useQueryClient();

	// Dialog states
	const [dialogOpen, setDialogOpen] = useState(false);
	const [editingRule, setEditingRule] =
		useState<CoverageRuleWithRelations | null>(null);
	const [deleteRuleId, setDeleteRuleId] = useState<string | null>(null);
	const [deleteRuleError, setDeleteRuleError] = useState<string | null>(null);

	// Fetch coverage rules
	const {
		data: rulesResult,
		isLoading,
		isError: rulesFailed,
		isFetching: rulesFetching,
		refetch: refetchRules,
	} = useQuery({
		queryKey: queryKeys.coverage.rules(organizationId),
		queryFn: async () => {
			const result = await getCoverageRules({});
			if (!result.success) throw new Error(result.error);
			return result.data;
		},
	});

	// Fetch coverage settings
	const {
		data: settingsResult,
		isError: settingsFailed,
		isFetching: settingsFetching,
		refetch: refetchSettings,
	} = useQuery({
		queryKey: ["coverage-settings", organizationId],
		enabled: canManageCoverageSettings,
		queryFn: async () => {
			const result = await getCoverageSettings();
			if (!result.success) throw new Error(result.error);
			return result.data;
		},
	});

	const settings = settingsResult;
	const visibleRules = filterManageableRules(rulesResult ?? [], manageableSubareaIds);

	// Delete mutation
	const deleteRuleMutation = useMutation({
		mutationFn: (ruleId: string) => deleteCoverageRule({ ruleId }),
		onSuccess: (result) => {
			if (result.success) {
				toast.success(
					t("settings.coverageRules.ruleDeleted", "Coverage rule deleted"),
				);
				queryClient.invalidateQueries({
					queryKey: queryKeys.coverage.rules(organizationId),
				});
				setDeleteRuleId(null);
			} else {
				// The dialog stays open with the reason so the deletion can be retried.
				setDeleteRuleError(
					actionErrorMessage(t, result, {}, [
						"settings.coverageRules.deleteFailed",
						"Failed to delete",
					]),
				);
			}
		},
		onError: () => {
			setDeleteRuleError(
				t("settings.coverageRules.deleteFailed", "Failed to delete rule"),
			);
		},
	});

	// Settings mutation
	const updateSettingsMutation = useMutation({
		mutationFn: (data: { allowPublishWithGaps: boolean }) =>
			updateCoverageSettings(data),
		onSuccess: (result) => {
			if (result.success) {
				toast.success(
					t("settings.coverageRules.settingsSaved", "Settings saved"),
				);
				queryClient.invalidateQueries({
					queryKey: ["coverage-settings", organizationId],
				});
			} else {
				toast.error(
					actionErrorMessage(t, result, {}, [
						"settings.coverageRules.settingsFailed",
						"Failed to save settings",
					]),
				);
			}
		},
		onError: () => {
			toast.error(
				t("settings.coverageRules.settingsFailed", "Failed to save settings"),
			);
		},
	});

	const handleCreateRule = () => {
		setEditingRule(null);
		setDialogOpen(true);
	};

	const handleEditRule = (rule: CoverageRuleWithRelations) => {
		setEditingRule(rule);
		setDialogOpen(true);
	};

	const handleDialogSuccess = () => {
		setDialogOpen(false);
		setEditingRule(null);
		queryClient.invalidateQueries({
			queryKey: queryKeys.coverage.rules(organizationId),
		});
	};

	const unknownLabel = t("common.unknown", "Unknown");
	// Group rules by subarea for display
	const rulesBySubarea = visibleRules.reduce(
		(acc, rule) => {
			const key = rule.subareaId;
			if (!acc[key]) {
				acc[key] = {
					subareaId: rule.subareaId,
					subareaName: rule.subarea?.name || unknownLabel,
					locationName: rule.subarea?.location?.name || unknownLabel,
					rules: [],
				};
			}
			acc[key].rules.push(rule);
			return acc;
		},
		{} as Record<
			string,
			{
				subareaId: string;
				subareaName: string;
				locationName: string;
				rules: CoverageRuleWithRelations[];
			}
		>,
	);

	if (isLoading) {
		return (
			<LoadingRegion
				className="flex flex-col gap-4"
				label={{
					labelKey: "settings.coverageRules.loading",
					labelDefault: "Loading coverage rules...",
				}}
			>
				{canManageCoverageSettings ? (
					<Skeleton aria-hidden="true" className="h-36 w-full" />
				) : null}
				<Skeleton aria-hidden="true" className="ml-auto h-9 w-28" />
				<Skeleton aria-hidden="true" className="h-64 w-full" />
			</LoadingRegion>
		);
	}

	return (
		<div className="flex flex-col gap-4">
			{canManageCoverageSettings ? (
				settingsFailed && !settings ? (
					<SettingsLoadError
						message={t(
							"settings.coverageRules.settingsLoadFailed",
							"Publishing settings could not be loaded.",
						)}
						onRetry={() => void refetchSettings()}
						isRetrying={settingsFetching}
					/>
				) : (
					<CoveragePublishingSettingsCard
						allowPublishWithGaps={settings?.allowPublishWithGaps ?? true}
						// The switch waits for the saved value instead of showing a default.
						isPending={updateSettingsMutation.isPending || !settings}
						onChange={(allowPublishWithGaps) =>
							updateSettingsMutation.mutate({ allowPublishWithGaps })
						}
					/>
				)
			) : null}

			<div className="flex justify-end">
				<Button onClick={handleCreateRule}>
					<IconPlus aria-hidden="true" className="mr-2 size-4" />
					{t("settings.coverageRules.addRule", "Add Rule")}
				</Button>
			</div>

			{/* A failed background refresh keeps showing the rules already loaded. */}
			{rulesFailed && !rulesResult ? (
				<SettingsLoadError
					message={t(
						"settings.coverageRules.loadFailed",
						"Coverage rules could not be loaded.",
					)}
					onRetry={() => void refetchRules()}
					isRetrying={rulesFetching}
				/>
			) : visibleRules.length === 0 ? (
				<Card>
					<CardContent className="flex flex-col items-center justify-center py-10 text-center">
						<IconTarget
							aria-hidden="true"
							className="text-muted-foreground mb-3 size-8"
						/>
						<h2 className="mb-1 text-base font-semibold">
							{t("settings.coverageRules.noRules", "No coverage rules")}
						</h2>
						<p className="text-muted-foreground mb-4 max-w-md text-sm">
							{t(
								"settings.coverageRules.noRulesDescription",
								"Create coverage rules to define minimum staffing requirements for your locations.",
							)}
						</p>
						<Button onClick={handleCreateRule}>
							<IconPlus aria-hidden="true" className="mr-2 size-4" />
							{t("settings.coverageRules.createFirstRule", "Create First Rule")}
						</Button>
					</CardContent>
				</Card>
			) : (
				<CoverageRuleGroups
					rulesBySubarea={rulesBySubarea}
					dayLabel={dayLabel}
					handleEditRule={handleEditRule}
					setDeleteRuleId={setDeleteRuleId}
					setDeleteRuleError={setDeleteRuleError}
				/>
			)}

			{/* Create/Edit Dialog */}
			<CoverageRuleDialog
				open={dialogOpen}
				onOpenChange={setDialogOpen}
				locations={locations}
				requireScopedSubareaSelection={manageableSubareaIds !== null}
				editingRule={editingRule}
				onSuccess={handleDialogSuccess}
			/>

			{/* Delete Confirmation */}
			<CoverageRuleDeleteDialog
				ruleId={deleteRuleId}
				ruleLabel={getCoverageRuleLabel(
					visibleRules.find((rule) => rule.id === deleteRuleId),
					unknownLabel,
					dayLabel,
				)}
				isDeleting={deleteRuleMutation.isPending}
				error={deleteRuleError}
				onClose={() => {
					setDeleteRuleId(null);
					setDeleteRuleError(null);
				}}
				onDelete={(ruleId) => {
					if (deleteRuleMutation.isPending) return;
					setDeleteRuleError(null);
					deleteRuleMutation.mutate(ruleId);
				}}
			/>
		</div>
	);
}

function CoverageRuleDeleteDialog({
	ruleId,
	ruleLabel,
	isDeleting,
	error,
	onClose,
	onDelete,
}: {
	ruleId: string | null;
	/** The rule's subarea, day and time block, so the confirmation names what is deleted. */
	ruleLabel: string | null;
	isDeleting: boolean;
	error: string | null;
	onClose: () => void;
	onDelete: (ruleId: string) => void;
}) {
	const { t } = useTranslate();
	return (
		<DeleteConfirmDialog
			open={!!ruleId}
			onOpenChange={(open) => {
				if (!open) onClose();
			}}
			title={t("settings.coverageRules.deleteRuleTitle", "Delete Coverage Rule?")}
			description={
				<>
					{ruleLabel ? (
						<span className="mb-2 block font-medium text-foreground tabular-nums">{ruleLabel}</span>
					) : null}
					{t(
						"settings.coverageRules.deleteRuleDescription",
						"This will permanently delete this coverage rule. This action cannot be undone.",
					)}
				</>
			}
			isDeleting={isDeleting}
			error={error}
			onConfirm={() => {
				if (ruleId) onDelete(ruleId);
			}}
		/>
	);
}

function CoveragePublishingSettingsCard({
	allowPublishWithGaps,
	isPending,
	onChange,
}: {
	allowPublishWithGaps: boolean;
	isPending: boolean;
	onChange: (checked: boolean) => void;
}) {
	const { t } = useTranslate();
	return (
		<Card>
			<CardHeader>
				<CardTitle className="flex items-center gap-2 text-base">
					<IconShieldCheck className="size-5" aria-hidden="true" />
					{t("settings.coverageRules.publishSettings", "Publishing Settings")}
				</CardTitle>
				<CardDescription>
					{t(
						"settings.coverageRules.publishSettingsDescription",
						"Control whether schedules can be published when coverage gaps exist.",
					)}
				</CardDescription>
			</CardHeader>
			<CardContent>
				<div className="flex items-center justify-between gap-4">
					<div className="min-w-0 space-y-0.5">
						<Label htmlFor="allow-publish-gaps">
							{t(
								"settings.coverageRules.allowPublishWithGaps",
								"Allow publishing with coverage gaps",
							)}
						</Label>
						<p className="text-muted-foreground text-sm">
							{t(
								"settings.coverageRules.allowPublishWithGapsDescription",
								"When disabled, managers cannot publish schedules that have understaffed time blocks.",
							)}
						</p>
					</div>
					<Switch
						id="allow-publish-gaps"
						checked={allowPublishWithGaps}
						onCheckedChange={onChange}
						disabled={isPending}
					/>
				</div>
			</CardContent>
		</Card>
	);
}

function CoverageRuleGroups({
	rulesBySubarea,
	dayLabel,
	handleEditRule,
	setDeleteRuleId,
	setDeleteRuleError,
}: {
	rulesBySubarea: Record<
		string,
		{
			subareaId: string;
			subareaName: string;
			locationName: string;
			rules: CoverageRuleWithRelations[];
		}
	>;
	dayLabel: (day: string) => string;
	handleEditRule: (rule: CoverageRuleWithRelations) => void;
	setDeleteRuleId: (id: string) => void;
	setDeleteRuleError: (error: null) => void;
}) {
	const { t } = useTranslate();
	return (
		<div className="space-y-4">
			{Object.values(rulesBySubarea).map((group) => (
				<Card key={group.subareaId}>
					<CardHeader>
						<CardTitle className="text-lg break-words">
							<h2>{group.subareaName}</h2>
						</CardTitle>
						<CardDescription className="break-words">{group.locationName}</CardDescription>
					</CardHeader>
					<CardContent>
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>{t("settings.coverageRules.day", "Day")}</TableHead>
									<TableHead>{t("settings.coverageRules.timeRange", "Time Range")}</TableHead>
									<TableHead className="text-center">
										{t("settings.coverageRules.minStaff", "Min Staff")}
									</TableHead>
									<TableHead className="w-[100px]">
										<span className="sr-only">{t("common.actions", "Actions")}</span>
									</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{group.rules.map((rule) => {
									const ruleLabel = `${group.subareaName}, ${dayLabel(rule.dayOfWeek)} ${rule.startTime}–${rule.endTime}`;
									return (
										<TableRow key={rule.id}>
											<TableCell>
												<Badge variant="outline">{dayLabel(rule.dayOfWeek)}</Badge>
											</TableCell>
											<TableCell className="tabular-nums">
												{rule.startTime}–{rule.endTime}
											</TableCell>
											<TableCell className="text-center font-medium tabular-nums">
												{rule.minimumStaffCount}
											</TableCell>
											<TableCell>
												<div className="flex items-center justify-end gap-1">
													<Button
														variant="ghost"
														size="icon"
														className="size-8"
														onClick={() => handleEditRule(rule)}
														aria-label={`${t(
															"settings.coverageRules.editRule",
															"Edit Coverage Rule",
														)}: ${ruleLabel}`}
													>
														<IconPencil aria-hidden="true" className="size-4" />
													</Button>
													<Button
														variant="ghost"
														size="icon"
														className="size-8 text-destructive hover:text-destructive"
														onClick={() => {
															setDeleteRuleError(null);
															setDeleteRuleId(rule.id);
														}}
														aria-label={`${t(
															"settings.coverageRules.deleteRule",
															"Delete Coverage Rule",
														)}: ${ruleLabel}`}
													>
														<IconTrash aria-hidden="true" className="size-4" />
													</Button>
												</div>
											</TableCell>
										</TableRow>
									);
								})}
							</TableBody>
						</Table>
					</CardContent>
				</Card>
			))}
		</div>
	);
}

function filterManageableRules(rules: CoverageRuleWithRelations[], subareaIds: string[] | null) {
	if (!subareaIds) return rules;
	const allowed = new Set(subareaIds);
	return rules.filter((rule) => allowed.has(rule.subareaId));
}

function getCoverageRuleLabel(
	rule: CoverageRuleWithRelations | undefined,
	unknownLabel: string,
	dayLabel: (day: string) => string,
) {
	if (!rule) return null;
	return `${rule.subarea?.name || unknownLabel}, ${dayLabel(rule.dayOfWeek)} ${rule.startTime}–${rule.endTime}`;
}
