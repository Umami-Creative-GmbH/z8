"use client";

import { IconPlus, IconPencil, IconTrash, IconTarget, IconShieldCheck } from "@tabler/icons-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import { toast } from "sonner";
import {
	getCoverageRules,
	deleteCoverageRule,
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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { queryKeys } from "@/lib/query/keys";
import type { CoverageRuleWithRelations } from "@/lib/effect/services/coverage.service";
import { CoverageRuleDialog } from "./coverage-rule-dialog";

interface CoverageRulesManagementProps {
	organizationId: string;
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

export function CoverageRulesManagement({ organizationId }: CoverageRulesManagementProps) {
	const { t } = useTranslate();
	const queryClient = useQueryClient();

	// Dialog states
	const [dialogOpen, setDialogOpen] = useState(false);
	const [editingRule, setEditingRule] = useState<CoverageRuleWithRelations | null>(null);
	const [deleteRuleId, setDeleteRuleId] = useState<string | null>(null);

	// Fetch coverage rules
	const { data: rulesResult, isLoading } = useQuery({
		queryKey: queryKeys.coverage.rules(organizationId),
		queryFn: async () => {
			const result = await getCoverageRules();
			if (!result.success) throw new Error(result.error);
			return result.data;
		},
	});

	// Fetch coverage settings
	const { data: settingsResult } = useQuery({
		queryKey: ["coverage-settings", organizationId],
		queryFn: async () => {
			const result = await getCoverageSettings();
			if (!result.success) throw new Error(result.error);
			return result.data;
		},
	});

	const rules = rulesResult || [];
	const settings = settingsResult;

	// Delete mutation
	const deleteRuleMutation = useMutation({
		mutationFn: (ruleId: string) => deleteCoverageRule(ruleId),
		onSuccess: (result) => {
			if (result.success) {
				toast.success(t("settings.coverageRules.ruleDeleted", "Coverage rule deleted"));
				queryClient.invalidateQueries({ queryKey: queryKeys.coverage.rules(organizationId) });
			} else {
				toast.error(result.error || t("settings.coverageRules.deleteFailed", "Failed to delete"));
			}
			setDeleteRuleId(null);
		},
		onError: () => {
			toast.error(t("settings.coverageRules.deleteFailed", "Failed to delete rule"));
			setDeleteRuleId(null);
		},
	});

	// Settings mutation
	const updateSettingsMutation = useMutation({
		mutationFn: (data: { allowPublishWithGaps: boolean }) => updateCoverageSettings(data),
		onSuccess: (result) => {
			if (result.success) {
				toast.success(t("settings.coverageRules.settingsSaved", "Settings saved"));
				queryClient.invalidateQueries({ queryKey: ["coverage-settings", organizationId] });
			} else {
				toast.error(result.error || t("settings.coverageRules.settingsFailed", "Failed to save settings"));
			}
		},
		onError: () => {
			toast.error(t("settings.coverageRules.settingsFailed", "Failed to save settings"));
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
		queryClient.invalidateQueries({ queryKey: queryKeys.coverage.rules(organizationId) });
	};

	// Group rules by subarea for display
	const rulesBySubarea = rules.reduce(
		(acc, rule) => {
			const key = rule.subareaId;
			if (!acc[key]) {
				acc[key] = {
					subareaId: rule.subareaId,
					subareaName: rule.subarea?.name || "Unknown",
					locationName: rule.subarea?.location?.name || "Unknown",
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

			{/* Settings Card */}
			<Card>
				<CardHeader>
					<CardTitle className="flex items-center gap-2 text-base">
						<IconShieldCheck className="h-5 w-5" />
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
								{t("settings.coverageRules.allowPublishWithGaps", "Allow publishing with coverage gaps")}
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
							onCheckedChange={(checked) => {
								updateSettingsMutation.mutate({ allowPublishWithGaps: checked });
							}}
							disabled={updateSettingsMutation.isPending}
						/>
					</div>
				</CardContent>
			</Card>

			<div className="flex justify-end">
				<Button onClick={handleCreateRule}>
					<IconPlus className="mr-2 h-4 w-4" />
					{t("settings.coverageRules.addRule", "Add Rule")}
				</Button>
			</div>

			{rules.length === 0 ? (
				<Card>
					<CardContent className="flex flex-col items-center justify-center py-12">
						<IconTarget className="text-muted-foreground mb-4 h-12 w-12" />
						<h3 className="mb-2 text-lg font-semibold">
							{t("settings.coverageRules.noRules", "No coverage rules")}
						</h3>
						<p className="text-muted-foreground mb-4 text-center">
							{t(
								"settings.coverageRules.noRulesDescription",
								"Create coverage rules to define minimum staffing requirements for your locations.",
							)}
						</p>
						<Button onClick={handleCreateRule}>
							<IconPlus className="mr-2 h-4 w-4" />
							{t("settings.coverageRules.createFirstRule", "Create First Rule")}
						</Button>
					</CardContent>
				</Card>
			) : (
				<div className="space-y-4">
					{Object.values(rulesBySubarea).map((group) => (
						<Card key={group.subareaId}>
							<CardHeader>
								<CardTitle className="text-lg">{group.subareaName}</CardTitle>
								<CardDescription>{group.locationName}</CardDescription>
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
															className="h-8 w-8"
															onClick={() => handleEditRule(rule)}
															aria-label={t("settings.coverageRules.editRule", "Edit Coverage Rule")}
														>
															<IconPencil className="h-4 w-4" />
														</Button>
														<Button
															variant="ghost"
															size="icon"
															className="h-8 w-8 text-destructive hover:text-destructive"
															onClick={() => setDeleteRuleId(rule.id)}
															aria-label={t("settings.coverageRules.deleteRule", "Delete Coverage Rule")}
														>
															<IconTrash className="h-4 w-4" />
														</Button>
													</div>
												</TableCell>
											</TableRow>
										))}
									</TableBody>
								</Table>
							</CardContent>
						</Card>
					))}
				</div>
			)}

			{/* Create/Edit Dialog */}
			<CoverageRuleDialog
				open={dialogOpen}
				onOpenChange={setDialogOpen}
				organizationId={organizationId}
				editingRule={editingRule}
				onSuccess={handleDialogSuccess}
			/>

			{/* Delete Confirmation */}
			<AlertDialog open={!!deleteRuleId} onOpenChange={() => setDeleteRuleId(null)}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>
							{t("settings.coverageRules.deleteRuleTitle", "Delete Coverage Rule?")}
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
							onClick={() => deleteRuleId && deleteRuleMutation.mutate(deleteRuleId)}
						>
							{t("common.delete", "Delete")}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</div>
	);
}
