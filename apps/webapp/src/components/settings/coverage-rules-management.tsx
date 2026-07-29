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
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
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
import { queryKeys } from "@/lib/query/keys";
import { CoverageRuleDialog } from "./coverage-rule-dialog";

interface CoverageRulesManagementProps {
	organizationId: string;
	locations: Array<{
		id: string;
		name: string;
		subareas: Array<{ id: string; name: string; isActive: boolean }>;
	}>;
	manageableSubareaIds: string[] | null;
	canManageCoverageSettings: boolean;
}

interface CoverageRuleGroup {
	subareaId: string;
	subareaName: string;
	locationName: string;
	rules: CoverageRuleWithRelations[];
}

const DAY_LABELS: Record<string, string> = {
	monday: "Mon",
	tuesday: "Tue",
	wednesday: "Wed",
	thursday: "Thu",
	friday: "Fri",
	saturday: "Sat",
	sunday: "Sun",
};

function useCoverageRulesManagement({
	organizationId,
	manageableSubareaIds,
	canManageCoverageSettings,
}: Omit<CoverageRulesManagementProps, "locations">) {
	const { t } = useTranslate();
	const queryClient = useQueryClient();
	const [dialogOpen, setDialogOpen] = useState(false);
	const [editingRule, setEditingRule] =
		useState<CoverageRuleWithRelations | null>(null);
	const [deleteRuleId, setDeleteRuleId] = useState<string | null>(null);
	const { data: rulesResult, isLoading } = useQuery({
		queryKey: queryKeys.coverage.rules(organizationId),
		queryFn: async () => {
			const result = await getCoverageRules();
			if (!result.success) throw new Error(result.error);
			return result.data;
		},
	});
	const { data: settings } = useQuery({
		queryKey: ["coverage-settings", organizationId],
		enabled: canManageCoverageSettings,
		queryFn: async () => {
			const result = await getCoverageSettings();
			if (!result.success) throw new Error(result.error);
			return result.data;
		},
	});
	const manageableSubareaIdSet = manageableSubareaIds
		? new Set(manageableSubareaIds)
		: null;
	const visibleRules = manageableSubareaIdSet
		? (rulesResult || []).filter((rule) =>
				manageableSubareaIdSet.has(rule.subareaId),
			)
		: rulesResult || [];
	const groups = Object.values(
		visibleRules.reduce<Record<string, CoverageRuleGroup>>((acc, rule) => {
			const group = acc[rule.subareaId] ?? {
				subareaId: rule.subareaId,
				subareaName: rule.subarea?.name || "Unknown",
				locationName: rule.subarea?.location?.name || "Unknown",
				rules: [],
			};
			group.rules.push(rule);
			acc[rule.subareaId] = group;
			return acc;
		}, {}),
	);
	const deleteRuleMutation = useMutation({
		mutationFn: (ruleId: string) => deleteCoverageRule(ruleId),
		onSuccess: (result) => {
			if (result.success) {
				toast.success(
					t("settings.coverageRules.ruleDeleted", "Coverage rule deleted"),
				);
				queryClient.invalidateQueries({
					queryKey: queryKeys.coverage.rules(organizationId),
				});
			} else {
				toast.error(
					result.error ||
						t("settings.coverageRules.deleteFailed", "Failed to delete"),
				);
			}
			setDeleteRuleId(null);
		},
		onError: () => {
			toast.error(
				t("settings.coverageRules.deleteFailed", "Failed to delete rule"),
			);
			setDeleteRuleId(null);
		},
	});
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
					result.error ||
						t(
							"settings.coverageRules.settingsFailed",
							"Failed to save settings",
						),
				);
			}
		},
		onError: () =>
			toast.error(
				t("settings.coverageRules.settingsFailed", "Failed to save settings"),
			),
	});

	return {
		deleteRuleId,
		deleteRuleMutation,
		dialogOpen,
		editingRule,
		groups,
		isLoading,
		manageableSubareaIdSet,
		settings,
		setDeleteRuleId,
		setDialogOpen,
		setEditingRule,
		updateSettingsMutation,
		visibleRules,
		refreshRules: () =>
			queryClient.invalidateQueries({
				queryKey: queryKeys.coverage.rules(organizationId),
			}),
	};
}

export function CoverageRulesManagement(props: CoverageRulesManagementProps) {
	const { locations, canManageCoverageSettings } = props;
	const { t } = useTranslate();
	const controller = useCoverageRulesManagement(props);
	const openCreateDialog = () => {
		controller.setEditingRule(null);
		controller.setDialogOpen(true);
	};

	if (controller.isLoading) {
		return (
			<div className="flex h-64 items-center justify-center">
				<div className="text-muted-foreground">
					{t("settings.coverageRules.loading", "Loading coverage rules...")}
				</div>
			</div>
		);
	}

	return (
		<div className="flex flex-1 flex-col gap-4 p-4">
			<div className="flex flex-col gap-2">
				<h1 className="text-2xl font-bold">
					{t("settings.coverageRules.title", "Coverage Targets")}
				</h1>
				<p className="text-muted-foreground">
					{t(
						"settings.coverageRules.description",
						"Define minimum staffing requirements per location, day, and time block.",
					)}
				</p>
			</div>
			{canManageCoverageSettings && (
				<PublishingSettingsCard
					settings={controller.settings}
					mutation={controller.updateSettingsMutation}
				/>
			)}
			<div className="flex justify-end">
				<Button onClick={openCreateDialog}>
					<IconPlus className="mr-2 size-4" />
					{t("settings.coverageRules.addRule", "Add Rule")}
				</Button>
			</div>
			<CoverageRulesList
				groups={controller.groups}
				isEmpty={controller.visibleRules.length === 0}
				onCreate={openCreateDialog}
				onEdit={(rule) => {
					controller.setEditingRule(rule);
					controller.setDialogOpen(true);
				}}
				onDelete={controller.setDeleteRuleId}
			/>
			<CoverageRuleDialog
				open={controller.dialogOpen}
				onOpenChange={controller.setDialogOpen}
				locations={locations}
				requireScopedSubareaSelection={
					controller.manageableSubareaIdSet !== null
				}
				editingRule={controller.editingRule}
				onSuccess={() => {
					controller.setDialogOpen(false);
					controller.setEditingRule(null);
					controller.refreshRules();
				}}
			/>
			<DeleteCoverageRuleDialog
				ruleId={controller.deleteRuleId}
				onOpenChange={controller.setDeleteRuleId}
				onDelete={(ruleId) => controller.deleteRuleMutation.mutate(ruleId)}
			/>
		</div>
	);
}

function PublishingSettingsCard({
	settings,
	mutation,
}: {
	settings: { allowPublishWithGaps: boolean } | undefined;
	mutation: ReturnType<
		typeof useCoverageRulesManagement
	>["updateSettingsMutation"];
}) {
	const { t } = useTranslate();
	return (
		<Card>
			<CardHeader>
				<CardTitle className="flex items-center gap-2 text-base">
					<IconShieldCheck className="size-5" />
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
				<div className="flex items-center justify-between">
					<div className="space-y-0.5">
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
						checked={settings?.allowPublishWithGaps ?? true}
						onCheckedChange={(checked) =>
							mutation.mutate({ allowPublishWithGaps: checked })
						}
						disabled={mutation.isPending}
					/>
				</div>
			</CardContent>
		</Card>
	);
}

function CoverageRulesList({
	groups,
	isEmpty,
	onCreate,
	onEdit,
	onDelete,
}: {
	groups: CoverageRuleGroup[];
	isEmpty: boolean;
	onCreate: () => void;
	onEdit: (rule: CoverageRuleWithRelations) => void;
	onDelete: (ruleId: string) => void;
}) {
	const { t } = useTranslate();
	if (isEmpty) {
		return (
			<Card>
				<CardContent className="flex flex-col items-center justify-center py-12">
					<IconTarget className="text-muted-foreground mb-4 size-12" />
					<h3 className="mb-2 text-lg font-semibold">
						{t("settings.coverageRules.noRules", "No coverage rules")}
					</h3>
					<p className="text-muted-foreground mb-4 text-center">
						{t(
							"settings.coverageRules.noRulesDescription",
							"Create coverage rules to define minimum staffing requirements for your locations.",
						)}
					</p>
					<Button onClick={onCreate}>
						<IconPlus className="mr-2 size-4" />
						{t("settings.coverageRules.createFirstRule", "Create First Rule")}
					</Button>
				</CardContent>
			</Card>
		);
	}
	return (
		<div className="space-y-4">
			{groups.map((group) => (
				<CoverageRuleGroupCard
					key={group.subareaId}
					group={group}
					onEdit={onEdit}
					onDelete={onDelete}
				/>
			))}
		</div>
	);
}

function CoverageRuleGroupCard({
	group,
	onEdit,
	onDelete,
}: {
	group: CoverageRuleGroup;
	onEdit: (rule: CoverageRuleWithRelations) => void;
	onDelete: (ruleId: string) => void;
}) {
	const { t } = useTranslate();
	return (
		<Card>
			<CardHeader>
				<CardTitle className="text-lg">{group.subareaName}</CardTitle>
				<CardDescription>{group.locationName}</CardDescription>
			</CardHeader>
			<CardContent>
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>{t("settings.coverageRules.day", "Day")}</TableHead>
							<TableHead>
								{t("settings.coverageRules.timeRange", "Time Range")}
							</TableHead>
							<TableHead className="text-center">
								{t("settings.coverageRules.minStaff", "Min Staff")}
							</TableHead>
							<TableHead className="w-[100px]"></TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{group.rules.map((rule) => (
							<TableRow key={rule.id}>
								<TableCell>
									<Badge variant="outline">
										{DAY_LABELS[rule.dayOfWeek] || rule.dayOfWeek}
									</Badge>
								</TableCell>
								<TableCell>
									{rule.startTime} - {rule.endTime}
								</TableCell>
								<TableCell className="text-center font-medium">
									{rule.minimumStaffCount}
								</TableCell>
								<TableCell>
									<div className="flex items-center gap-1">
										<Button
											variant="ghost"
											size="icon"
											className="size-8"
											onClick={() => onEdit(rule)}
											aria-label={t(
												"settings.coverageRules.editRule",
												"Edit Coverage Rule",
											)}
										>
											<IconPencil className="size-4" />
										</Button>
										<Button
											variant="ghost"
											size="icon"
											className="size-8 text-destructive hover:text-destructive"
											onClick={() => onDelete(rule.id)}
											aria-label={t(
												"settings.coverageRules.deleteRule",
												"Delete Coverage Rule",
											)}
										>
											<IconTrash className="size-4" />
										</Button>
									</div>
								</TableCell>
							</TableRow>
						))}
					</TableBody>
				</Table>
			</CardContent>
		</Card>
	);
}

function DeleteCoverageRuleDialog({
	ruleId,
	onOpenChange,
	onDelete,
}: {
	ruleId: string | null;
	onOpenChange: (ruleId: string | null) => void;
	onDelete: (ruleId: string) => void;
}) {
	const { t } = useTranslate();
	return (
		<AlertDialog open={!!ruleId} onOpenChange={() => onOpenChange(null)}>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>
						{t(
							"settings.coverageRules.deleteRuleTitle",
							"Delete Coverage Rule?",
						)}
					</AlertDialogTitle>
					<AlertDialogDescription>
						{t(
							"settings.coverageRules.deleteRuleDescription",
							"This will permanently delete this coverage rule. This action cannot be undone.",
						)}
					</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogCancel>{t("common.cancel", "Cancel")}</AlertDialogCancel>
					<AlertDialogAction
						className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
						onClick={() => ruleId && onDelete(ruleId)}
					>
						{t("common.delete", "Delete")}
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}
