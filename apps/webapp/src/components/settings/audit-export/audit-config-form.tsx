"use client";

import { IconLoader2, IconShieldCheck } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import { toast } from "sonner";
import {
	initializeAuditExportAction,
	type UpdateAuditConfigInput,
	updateAuditConfigAction,
} from "@/app/[locale]/(app)/settings/audit-export/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import type { AuditExportConfigData } from "@/lib/audit-export";
import { useRouter } from "@/navigation";

interface AuditConfigFormProps {
	organizationId: string;
	initialConfig: AuditExportConfigData | null;
}

export function AuditConfigForm({ organizationId, initialConfig }: AuditConfigFormProps) {
	const { t } = useTranslate();
	const router = useRouter();
	const [loading, setLoading] = useState(false);
	const [config, setConfig] = useState<AuditExportConfigData | null>(initialConfig);

	const handleInitialize = async () => {
		setLoading(true);
		try {
			const result = await initializeAuditExportAction(organizationId);
			if (result.success) {
				setConfig(result.data.config);
				toast.success(
					t(
						"settings.auditExport.config.initSuccess",
						"Audit export initialized. Signing key generated.",
					),
				);
				router.refresh();
			} else {
				toast.error(
					result.error || t("settings.auditExport.config.initError", "Initialization failed"),
				);
			}
		} catch (error) {
			toast.error(t("common.unexpectedError", "An unexpected error occurred"));
			console.error("Initialize error:", error);
		} finally {
			setLoading(false);
		}
	};

	const handleUpdate = async (updates: Partial<UpdateAuditConfigInput>) => {
		setLoading(true);
		try {
			const result = await updateAuditConfigAction({
				organizationId,
				...updates,
			});
			if (result.success) {
				setConfig(result.data);
				toast.success(t("settings.auditExport.config.updateSuccess", "Configuration updated"));
			} else {
				toast.error(result.error || t("settings.auditExport.config.updateError", "Update failed"));
			}
		} catch (error) {
			toast.error(t("common.unexpectedError", "An unexpected error occurred"));
			console.error("Update error:", error);
		} finally {
			setLoading(false);
		}
	};

	if (!config) {
		return (
			<Card>
				<CardHeader>
					<CardTitle className="flex items-center gap-2">
						<IconShieldCheck className="size-5" />
						{t("settings.auditExport.config.notConfiguredTitle", "Enable Audit Export")}
					</CardTitle>
					<CardDescription>
						{t(
							"settings.auditExport.config.notConfiguredDescription",
							"Audit export provides GoBD-compliant cryptographic hardening for your data and payroll exports with digital signatures, timestamps, and optional WORM retention.",
						)}
					</CardDescription>
				</CardHeader>
				<CardContent>
					<div className="space-y-4">
						<div className="bg-muted/50 rounded-lg p-4 text-sm space-y-2">
							<p className="font-medium">
								{t("settings.auditExport.config.features", "Features include:")}
							</p>
							<ul className="list-disc list-inside space-y-1 text-muted-foreground">
								<li>
									{t(
										"settings.auditExport.config.featureHashes",
										"SHA-256 per-file hashes with Merkle tree integrity",
									)}
								</li>
								<li>
									{t(
										"settings.auditExport.config.featureSignature",
										"Ed25519 digital signatures for authenticity",
									)}
								</li>
								<li>
									{t(
										"settings.auditExport.config.featureTimestamp",
										"RFC 3161 trusted timestamps for non-repudiation",
									)}
								</li>
								<li>
									{t(
										"settings.auditExport.config.featureWorm",
										"Optional S3 Object Lock (WORM) for immutability",
									)}
								</li>
							</ul>
						</div>
						<Button onClick={handleInitialize} disabled={loading}>
							{loading && <IconLoader2 className="mr-2 size-4 animate-spin" />}
							{t("settings.auditExport.config.enableButton", "Enable Audit Export")}
						</Button>
					</div>
				</CardContent>
			</Card>
		);
	}

	return (
		<Card>
			<CardHeader>
				<div className="flex items-center justify-between">
					<div>
						<CardTitle className="flex items-center gap-2">
							<IconShieldCheck className="size-5" />
							{t("settings.auditExport.config.title", "Audit Export Configuration")}
						</CardTitle>
						<CardDescription>
							{t(
								"settings.auditExport.config.description",
								"Configure retention periods and automatic audit hardening",
							)}
						</CardDescription>
					</div>
					<Badge variant={config.isEnabled ? "default" : "secondary"}>
						{config.isEnabled
							? t("settings.auditExport.config.enabled", "Enabled")
							: t("settings.auditExport.config.disabled", "Disabled")}
					</Badge>
				</div>
			</CardHeader>
			<CardContent className="space-y-6">
				{/* Retention Settings */}
				<div className="space-y-4">
					<h3 className="font-medium">
						{t("settings.auditExport.config.retentionTitle", "Retention Settings")}
					</h3>

					<div className="grid gap-4 sm:grid-cols-2">
						<div className="space-y-2">
							<Label htmlFor="retentionYears">
								{t("settings.auditExport.config.retentionYears", "Retention Period")}
							</Label>
							<Select
								value={config.retentionYears.toString()}
								onValueChange={(value) => handleUpdate({ retentionYears: parseInt(value) })}
								disabled={loading}
							>
								<SelectTrigger id="retentionYears">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((years) => (
										<SelectItem key={years} value={years.toString()}>
											{t("settings.auditExport.config.yearsOption", "{years} years", { years })}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
							<p className="text-xs text-muted-foreground">
								{t(
									"settings.auditExport.config.retentionYearsHint",
									"GoBD requires 10 years for tax-relevant documents",
								)}
							</p>
						</div>

						<div className="space-y-2">
							<Label htmlFor="retentionMode">
								{t("settings.auditExport.config.retentionMode", "WORM Mode")}
							</Label>
							<Select
								value={config.retentionMode}
								onValueChange={(value: "governance" | "compliance") =>
									handleUpdate({ retentionMode: value })
								}
								disabled={loading}
							>
								<SelectTrigger id="retentionMode">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="governance">
										{t("settings.auditExport.config.modeGovernance", "Governance")}
									</SelectItem>
									<SelectItem value="compliance">
										{t("settings.auditExport.config.modeCompliance", "Compliance")}
									</SelectItem>
								</SelectContent>
							</Select>
							<p className="text-xs text-muted-foreground">
								{config.retentionMode === "governance"
									? t(
											"settings.auditExport.config.modeGovernanceHint",
											"Governance: Admins can override locks if needed",
										)
									: t(
											"settings.auditExport.config.modeComplianceHint",
											"Compliance: Locks cannot be removed by anyone",
										)}
							</p>
						</div>
					</div>

					{!config.objectLockSupported && (
						<div className="rounded-lg border border-yellow-500/50 bg-yellow-500/10 p-3 text-sm">
							<p className="font-medium text-yellow-600 dark:text-yellow-400">
								{t(
									"settings.auditExport.config.objectLockNotSupported",
									"Object Lock Not Available",
								)}
							</p>
							<p className="mt-1 text-muted-foreground">
								{t(
									"settings.auditExport.config.objectLockNotSupportedHint",
									"Your S3 bucket does not have Object Lock enabled. Cryptographic proofs will still be generated, but WORM protection will not be enforced at the storage level.",
								)}
							</p>
						</div>
					)}
				</div>

				{/* Auto-Enable Settings */}
				<div className="space-y-4">
					<h3 className="font-medium">
						{t("settings.auditExport.config.autoEnableTitle", "Automatic Hardening")}
					</h3>

					<div className="space-y-4">
						<div className="flex items-center justify-between rounded-lg border p-4">
							<div className="space-y-0.5">
								<Label htmlFor="autoEnableDataExports" className="text-base">
									{t("settings.auditExport.config.autoEnableData", "Data Exports")}
								</Label>
								<p className="text-sm text-muted-foreground">
									{t(
										"settings.auditExport.config.autoEnableDataHint",
										"Automatically create audit packages for all data exports",
									)}
								</p>
							</div>
							<Switch
								id="autoEnableDataExports"
								checked={config.autoEnableDataExports}
								onCheckedChange={(checked) => handleUpdate({ autoEnableDataExports: checked })}
								disabled={loading}
							/>
						</div>

						<div className="flex items-center justify-between rounded-lg border p-4">
							<div className="space-y-0.5">
								<Label htmlFor="autoEnablePayrollExports" className="text-base">
									{t("settings.auditExport.config.autoEnablePayroll", "Payroll Exports")}
								</Label>
								<p className="text-sm text-muted-foreground">
									{t(
										"settings.auditExport.config.autoEnablePayrollHint",
										"Automatically create audit packages for all payroll exports",
									)}
								</p>
							</div>
							<Switch
								id="autoEnablePayrollExports"
								checked={config.autoEnablePayrollExports}
								onCheckedChange={(checked) => handleUpdate({ autoEnablePayrollExports: checked })}
								disabled={loading}
							/>
						</div>
					</div>
				</div>

				{/* Key Info */}
				{config.signingKeyFingerprint && (
					<div className="space-y-2 rounded-lg bg-muted/50 p-4">
						<h3 className="font-medium">
							{t("settings.auditExport.config.signingKeyTitle", "Active Signing Key")}
						</h3>
						<div className="font-mono text-sm text-muted-foreground">
							{config.signingKeyFingerprint}
						</div>
						<p className="text-xs text-muted-foreground">
							{t("settings.auditExport.config.signingKeyVersion", "Version {version}", {
								version: config.signingKeyVersion ?? 1,
							})}
						</p>
					</div>
				)}
			</CardContent>
		</Card>
	);
}
