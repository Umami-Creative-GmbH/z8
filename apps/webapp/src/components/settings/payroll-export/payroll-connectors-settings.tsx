"use client";

import { useState } from "react";
import { useTranslate } from "@tolgee/react";
import type {
	DatevConfigResult,
	LexwareConfigResult,
	PayrollIdentifierFieldOption,
	PersonioConfigResult,
	SageConfigResult,
	SuccessFactorsConfigResult,
	WorkdayConfigResult,
} from "@/app/[locale]/(app)/settings/payroll-export/actions";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { DatevConfigForm } from "./datev-config-form";
import { ExpenseWageTypeMappings } from "./expense-wage-type-mappings";
import { LexwareConfigForm } from "./lexware-config-form";
import { PersonioConfigForm } from "./personio-config-form";
import { SageConfigForm } from "./sage-config-form";
import { SuccessFactorsConfigForm } from "./successfactors-config-form";
import { WageTypeMappings } from "./wage-type-mappings";
import { WorkdayConfigForm } from "./workday-config-form";

export type PayrollConnectorId =
	| "datev"
	| "lexware"
	| "sage"
	| "personio"
	| "successfactors"
	| "workday";

export interface PayrollConnectorsSettingsProps {
	datevConfig: DatevConfigResult | null;
	lexwareConfig: LexwareConfigResult | null;
	sageConfig: SageConfigResult | null;
	personioConfig: PersonioConfigResult | null;
	successFactorsConfig: SuccessFactorsConfigResult | null;
	workdayConfig: WorkdayConfigResult | null;
	identifierFields: PayrollIdentifierFieldOption[];
	hasMappingFormat: boolean;
}

type TargetStatus = "configured" | "needsCredentials" | "notConfigured";

interface PayrollConnectorItem {
	id: PayrollConnectorId;
	labelKey: string;
	labelDefault: string;
	subtitleKey: string;
	subtitleDefault: string;
	status: TargetStatus;
}

function getDefaultTarget(items: readonly PayrollConnectorItem[]): PayrollConnectorId {
	return items.find((item) => item.status === "configured")?.id ?? "datev";
}

/**
 * Configuration-only Payroll Connectors & Wage Types workspace (#1958).
 * Replaces the legacy 9-tab strip (including operational Export/History tabs,
 * now owned by `/payroll?tab=export`) with two clean sections:
 * 1. Payroll Targets (selector + detail form for all six payroll connectors)
 * 2. Wage Types (work and expense wage-type mappings)
 */
export function PayrollConnectorsSettings({
	datevConfig,
	lexwareConfig,
	sageConfig,
	personioConfig,
	successFactorsConfig,
	workdayConfig,
	identifierFields,
	hasMappingFormat,
}: PayrollConnectorsSettingsProps) {
	const { t } = useTranslate();

	const targets: PayrollConnectorItem[] = [
		{
			id: "datev",
			labelKey: "settings.payrollExport.tabs.datev",
			labelDefault: "DATEV",
			subtitleKey: "settings.payrollExport.targets.datevSubtitle",
			subtitleDefault: "DATEV Lohn & Gehalt (CSV)",
			status: datevConfig ? "configured" : "notConfigured",
		},
		{
			id: "lexware",
			labelKey: "settings.payrollExport.tabs.lexware",
			labelDefault: "Lexware",
			subtitleKey: "settings.payrollExport.targets.lexwareSubtitle",
			subtitleDefault: "Lexware lohn+gehalt (CSV)",
			status: lexwareConfig ? "configured" : "notConfigured",
		},
		{
			id: "sage",
			labelKey: "settings.payrollExport.tabs.sage",
			labelDefault: "Sage",
			subtitleKey: "settings.payrollExport.targets.sageSubtitle",
			subtitleDefault: "Sage Lohn (CSV)",
			status: sageConfig ? "configured" : "notConfigured",
		},
		{
			id: "personio",
			labelKey: "settings.payrollExport.tabs.personio",
			labelDefault: "Personio",
			subtitleKey: "settings.payrollExport.targets.personioSubtitle",
			subtitleDefault: "Personio API",
			status: !personioConfig
				? "notConfigured"
				: personioConfig.hasCredentials
					? "configured"
					: "needsCredentials",
		},
		{
			id: "successfactors",
			labelKey: "settings.payrollExport.tabs.successfactors",
			labelDefault: "SAP SuccessFactors",
			subtitleKey: "settings.payrollExport.targets.successfactorsSubtitle",
			subtitleDefault: "API & CSV",
			status: !successFactorsConfig
				? "notConfigured"
				: successFactorsConfig.hasCredentials
					? "configured"
					: "needsCredentials",
		},
		{
			id: "workday",
			labelKey: "settings.payrollExport.tabs.workday",
			labelDefault: "Workday",
			subtitleKey: "settings.payrollExport.targets.workdaySubtitle",
			subtitleDefault: "Workday API",
			status: !workdayConfig
				? "notConfigured"
				: workdayConfig.hasCredentials
					? "configured"
					: "needsCredentials",
		},
	];

	const [selectedTarget, setSelectedTarget] = useState<PayrollConnectorId>(() =>
		getDefaultTarget(targets),
	);

	function renderStatusBadge(status: TargetStatus) {
		switch (status) {
			case "configured":
				return (
					<Badge variant="secondary" className="shrink-0">
						{t("settings.payrollExport.targets.statusConfigured", "Configured")}
					</Badge>
				);
			case "needsCredentials":
				return (
					<Badge variant="outline" className="shrink-0">
						{t("settings.payrollExport.targets.statusNeedsCredentials", "Needs credentials")}
					</Badge>
				);
			case "notConfigured":
				return (
					<Badge variant="outline" className="shrink-0 text-muted-foreground">
						{t("settings.payrollExport.targets.statusNotConfigured", "Not configured")}
					</Badge>
				);
		}
	}

	return (
		<Tabs defaultValue="targets" className="w-full min-w-0">
			<TabsList
				aria-label={t(
					"settings.payrollExport.connectorsTitle",
					"Payroll Connectors & Wage Types",
				)}
				className="w-full sm:w-fit"
			>
				<TabsTrigger value="targets">
					{t("settings.payrollExport.sections.targets", "Payroll Targets")}
				</TabsTrigger>
				<TabsTrigger value="mappings">
					{t("settings.payrollExport.tabs.mappings", "Wage Types")}
				</TabsTrigger>
			</TabsList>

			<TabsContent value="targets" className="mt-4 min-w-0">
				<div className="grid min-w-0 items-start gap-6 lg:grid-cols-[minmax(0,17rem)_minmax(0,1fr)]">
					<div
						role="group"
						aria-label={t("settings.payrollExport.sections.targets", "Payroll Targets")}
						className="flex flex-col gap-1.5"
					>
						{targets.map((target) => {
							const isSelected = target.id === selectedTarget;
							return (
								<button
									key={target.id}
									type="button"
									aria-pressed={isSelected}
									onClick={() => setSelectedTarget(target.id)}
									className={cn(
										"flex w-full items-start justify-between gap-2 rounded-lg border px-3 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
										isSelected
											? "border-primary bg-accent/60 text-accent-foreground"
											: "border-border bg-card hover:bg-accent/30",
									)}
								>
									<span className="min-w-0 space-y-0.5">
										<span className="block truncate font-medium text-sm">
											{t(target.labelKey, target.labelDefault)}
										</span>
										<span className="block truncate text-muted-foreground text-xs">
											{t(target.subtitleKey, target.subtitleDefault)}
										</span>
									</span>
									{renderStatusBadge(target.status)}
								</button>
							);
						})}
					</div>

					<div className="min-w-0">
						{selectedTarget === "datev" ? (
							<DatevConfigForm
								initialConfig={datevConfig}
								identifierFields={identifierFields}
							/>
						) : null}
						{selectedTarget === "lexware" ? (
							<LexwareConfigForm
								initialConfig={lexwareConfig}
								identifierFields={identifierFields}
							/>
						) : null}
						{selectedTarget === "sage" ? (
							<SageConfigForm
								initialConfig={sageConfig}
								identifierFields={identifierFields}
							/>
						) : null}
						{selectedTarget === "personio" ? (
							<PersonioConfigForm
								initialConfig={personioConfig}
								identifierFields={identifierFields}
							/>
						) : null}
						{selectedTarget === "successfactors" ? (
							<SuccessFactorsConfigForm
								initialConfig={successFactorsConfig}
								identifierFields={identifierFields}
							/>
						) : null}
						{selectedTarget === "workday" ? (
							<WorkdayConfigForm
								initialConfig={workdayConfig}
								identifierFields={identifierFields}
							/>
						) : null}
					</div>
				</div>
			</TabsContent>

			<TabsContent value="mappings" className="mt-4 min-w-0 space-y-6">
				<WageTypeMappings hasMappingFormat={hasMappingFormat} />
				<ExpenseWageTypeMappings />
			</TabsContent>
		</Tabs>
	);
}
