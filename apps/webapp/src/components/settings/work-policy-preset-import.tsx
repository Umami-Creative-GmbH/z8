"use client";

import { IconDownload, IconLoader2 } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import { toast } from "sonner";
import {
	getWorkPolicyPresets,
	importWorkPolicyPreset,
} from "@/app/[locale]/(app)/settings/work-policies/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { queryKeys } from "@/lib/query";

interface WorkPolicyPresetImportProps {
	organizationId: string;
	onImportSuccess: () => void;
}

function formatMinutesToHours(minutes: number | null): string {
	if (minutes === null) return "—";
	const hours = Math.floor(minutes / 60);
	const mins = minutes % 60;
	if (mins === 0) return `${hours}h`;
	return `${hours}h ${mins}m`;
}

const countryFlags: Record<string, string> = {
	DE: "🇩🇪",
	EU: "🇪🇺",
	FR: "🇫🇷",
	GB: "🇬🇧",
	CH: "🇨🇭",
	AT: "🇦🇹",
	US: "🇺🇸",
	INT: "🌍",
};

export function WorkPolicyPresetImport({
	organizationId,
	onImportSuccess,
}: WorkPolicyPresetImportProps) {
	const { t } = useTranslate();
	const queryClient = useQueryClient();
	const [setAsDefault, setSetAsDefault] = useState(false);
	const [importingPresetId, setImportingPresetId] = useState<string | null>(null);

	// Fetch presets
	const {
		data: presets,
		isLoading,
		error,
	} = useQuery({
		queryKey: queryKeys.workPolicies.presets(),
		queryFn: async () => {
			const result = await getWorkPolicyPresets();
			if (!result.success) {
				throw new Error(result.error || "Failed to fetch presets");
			}
			return result.data;
		},
		staleTime: 5 * 60 * 1000,
		refetchOnWindowFocus: false,
	});

	// Import mutation
	const importMutation = useMutation({
		mutationFn: ({ presetId }: { presetId: string }) =>
			importWorkPolicyPreset(organizationId, presetId, setAsDefault),
		onSuccess: (result) => {
			if (result.success) {
				toast.success(
					t("settings.workPolicies.importSuccess", "Policy imported successfully"),
				);
				// Invalidate policies list to show new policy
				queryClient.invalidateQueries({
					queryKey: queryKeys.workPolicies.list(organizationId),
				});
				if (setAsDefault) {
					queryClient.invalidateQueries({
						queryKey: queryKeys.workPolicies.assignments(organizationId),
					});
				}
				onImportSuccess();
			} else {
				toast.error(
					result.error || t("settings.workPolicies.importError", "Failed to import preset"),
				);
			}
			setImportingPresetId(null);
		},
		onError: () => {
			toast.error(t("settings.workPolicies.importError", "Failed to import preset"));
			setImportingPresetId(null);
		},
	});

	const handleImport = (presetId: string) => {
		setImportingPresetId(presetId);
		importMutation.mutate({ presetId });
	};

	if (isLoading) {
		return (
			<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
				{[1, 2, 3].map((i) => (
					<Card key={i}>
						<CardHeader>
							<Skeleton className="h-6 w-40" />
							<Skeleton className="h-4 w-full" />
						</CardHeader>
						<CardContent>
							<Skeleton className="h-24 w-full" />
						</CardContent>
					</Card>
				))}
			</div>
		);
	}

	if (error) {
		return (
			<Card>
				<CardContent className="py-8 text-center">
					<p className="text-destructive">
						{t("settings.workPolicies.presetsLoadError", "Failed to load presets")}
					</p>
				</CardContent>
			</Card>
		);
	}

	if (!presets || presets.length === 0) {
		return (
			<Card>
				<CardContent className="py-12 text-center">
					<div className="flex flex-col items-center gap-4">
						<div className="rounded-full bg-muted p-4">
							<IconDownload className="h-8 w-8 text-muted-foreground" />
						</div>
						<div>
							<h3 className="text-lg font-medium">
								{t("settings.workPolicies.noPresets", "No presets available")}
							</h3>
							<p className="text-sm text-muted-foreground mt-1">
								{t(
									"settings.workPolicies.noPresetsDescription",
									"Labor law presets will be added here in a future update. Create custom policies for now.",
								)}
							</p>
						</div>
					</div>
				</CardContent>
			</Card>
		);
	}

	return (
		<div className="space-y-4">
			<div className="flex items-center space-x-2">
				<Checkbox
					id="set-default"
					checked={setAsDefault}
					onCheckedChange={(checked) => setSetAsDefault(!!checked)}
				/>
				<Label htmlFor="set-default" className="text-sm">
					{t(
						"settings.workPolicies.setAsDefaultOnImport",
						"Set as organization default after import",
					)}
				</Label>
			</div>

			<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
				{presets.map((preset) => (
					<Card key={preset.id} className="flex flex-col">
						<CardHeader className="pb-2">
							<div className="flex items-center justify-between">
								<CardTitle className="text-base flex items-center gap-2">
									<span className="text-lg">
										{preset.countryCode
											? (countryFlags[preset.countryCode] ?? countryFlags.INT)
											: countryFlags.INT}
									</span>
									{preset.name}
								</CardTitle>
								<Badge variant="outline" className="text-xs">
									{preset.countryCode}
								</Badge>
							</div>
							{preset.description && (
								<CardDescription className="text-xs">{preset.description}</CardDescription>
							)}
						</CardHeader>
						<CardContent className="flex-1 flex flex-col justify-between space-y-4">
							<div className="space-y-2">
								<div className="grid grid-cols-2 gap-2 text-sm">
									<div>
										<span className="text-muted-foreground">Max Daily:</span>
										<span className="ml-1 font-medium">
											{formatMinutesToHours(preset.maxDailyMinutes)}
										</span>
									</div>
									<div>
										<span className="text-muted-foreground">Max Weekly:</span>
										<span className="ml-1 font-medium">
											{formatMinutesToHours(preset.maxWeeklyMinutes)}
										</span>
									</div>
								</div>
							</div>

							<Button
								variant="outline"
								size="sm"
								className="w-full"
								disabled={importingPresetId !== null}
								onClick={() => handleImport(preset.id)}
							>
								{importingPresetId === preset.id ? (
									<>
										<IconLoader2 className="mr-2 h-4 w-4 animate-spin" />
										{t("settings.workPolicies.importing", "Importing...")}
									</>
								) : (
									<>
										<IconDownload className="mr-2 h-4 w-4" />
										{t("settings.workPolicies.import", "Import")}
									</>
								)}
							</Button>
						</CardContent>
					</Card>
				))}
			</div>
		</div>
	);
}
