"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useCallback, useState } from "react";
import {
	getComplianceConfig,
	getComplianceFindings,
	getComplianceStats,
	type ComplianceFindingWithDetails,
	type GetFindingsFilters,
} from "@/app/[locale]/(app)/settings/compliance-radar/actions";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ComplianceRadarStats } from "./compliance-radar-stats";
import { ComplianceFindingsTable } from "./compliance-findings-table";
import { ComplianceConfigForm } from "./compliance-config-form";
import { ComplianceFindingDialog } from "./compliance-finding-dialog";
import { queryKeys } from "@/lib/query";

// Hoist default values to avoid recreating on every render
const DEFAULT_FILTERS: GetFindingsFilters = {
	statuses: ["open", "acknowledged"],
};

const DEFAULT_PAGINATION = { limit: 25, offset: 0 };

interface ComplianceRadarManagementProps {
	organizationId: string;
	isAdmin: boolean;
}

export function ComplianceRadarManagement({
	organizationId,
	isAdmin,
}: ComplianceRadarManagementProps) {
	const { t } = useTranslate();
	const queryClient = useQueryClient();

	// Finding detail dialog
	const [selectedFinding, setSelectedFinding] = useState<ComplianceFindingWithDetails | null>(
		null,
	);
	const [findingDialogOpen, setFindingDialogOpen] = useState(false);

	// Filters
	const [filters, setFilters] = useState<GetFindingsFilters>(DEFAULT_FILTERS);

	// Pagination
	const [pagination, setPagination] = useState(DEFAULT_PAGINATION);

	// Fetch stats
	const { data: statsResult } = useQuery({
		queryKey: queryKeys.complianceRadar.stats(organizationId),
		queryFn: () => getComplianceStats(),
	});

	// Fetch config
	const { data: configResult } = useQuery({
		queryKey: queryKeys.complianceRadar.config(organizationId),
		queryFn: () => getComplianceConfig(),
		enabled: isAdmin,
	});

	const handleFindingClick = useCallback((finding: ComplianceFindingWithDetails) => {
		setSelectedFinding(finding);
		setFindingDialogOpen(true);
	}, []);

	const handleFindingAction = useCallback(() => {
		// Invalidate queries after action
		queryClient.invalidateQueries({
			queryKey: queryKeys.complianceRadar.findings(organizationId),
		});
		queryClient.invalidateQueries({
			queryKey: queryKeys.complianceRadar.stats(organizationId),
		});
		setFindingDialogOpen(false);
		setSelectedFinding(null);
	}, [queryClient, organizationId]);

	const handleConfigSaved = useCallback(() => {
		queryClient.invalidateQueries({
			queryKey: queryKeys.complianceRadar.config(organizationId),
		});
	}, [queryClient, organizationId]);

	return (
		<div className="flex flex-1 flex-col gap-4 p-4">
			<div className="flex flex-col gap-2">
				<h1 className="text-2xl font-semibold tracking-tight">
					{t("settings.complianceRadar.title", "Compliance Radar")}
				</h1>
				<p className="text-sm text-muted-foreground">
					{t(
						"settings.complianceRadar.description",
						"Monitor labor-law compliance, review findings, and manage waivers",
					)}
				</p>
			</div>

			{/* Stats Overview */}
			{statsResult?.success && statsResult.data && (
				<ComplianceRadarStats stats={statsResult.data} />
			)}

			<Tabs defaultValue="findings" className="space-y-4">
				<TabsList>
					<TabsTrigger value="findings">
						{t("settings.complianceRadar.tab.findings", "Findings")}
					</TabsTrigger>
					{isAdmin && (
						<TabsTrigger value="config">
							{t("settings.complianceRadar.tab.config", "Configuration")}
						</TabsTrigger>
					)}
				</TabsList>

				<TabsContent value="findings" className="space-y-4">
					<ComplianceFindingsTable
						organizationId={organizationId}
						isAdmin={isAdmin}
						filters={filters}
						onFiltersChange={setFilters}
						pagination={pagination}
						onPaginationChange={setPagination}
						onFindingClick={handleFindingClick}
					/>
				</TabsContent>

				{isAdmin && (
					<TabsContent value="config" className="space-y-4">
						<ComplianceConfigForm
							config={configResult?.success ? configResult.data : null}
							onSaved={handleConfigSaved}
						/>
					</TabsContent>
				)}
			</Tabs>

			<ComplianceFindingDialog
				finding={selectedFinding}
				open={findingDialogOpen}
				onOpenChange={setFindingDialogOpen}
				isAdmin={isAdmin}
				onAction={handleFindingAction}
			/>
		</div>
	);
}
