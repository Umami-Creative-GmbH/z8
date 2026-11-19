"use client";

import {
	IconCheck,
	IconClock,
	IconFileZip,
	IconLoader2,
	IconLock,
	IconRefresh,
	IconShieldCheck,
	IconX,
} from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useLocale } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import {
	type AuditPackageInfo,
	verifyAuditPackageAction,
} from "@/app/[locale]/(app)/settings/audit-export/actions";
import {
	ActionPanel,
	ActionPanelBody,
	ActionPanelContent,
	ActionPanelDescription,
	ActionPanelHeader,
	ActionPanelTitle,
} from "@/components/ui/action-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardAction,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import type { VerificationResult } from "@/lib/audit-export";
import {
	formatDateOnly,
	formatDateTime,
	formatTimeOnly,
} from "@/lib/datetime/format";
import { actionErrorMessage } from "@/lib/organization-action/action-error-message";
import { useRouter } from "@/navigation";
import { useOrganizationTimezone } from "@/stores/organization-settings-store";

function formatFileSize(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	if (bytes < 1024 * 1024 * 1024)
		return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
	return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

interface AuditPackagesTableProps {
	packages: AuditPackageInfo[];
}

export function AuditPackagesTable({
	packages,
}: AuditPackagesTableProps) {
	const { t } = useTranslate();
	const locale = useLocale();
	const timezone = useOrganizationTimezone();
	const router = useRouter();
	const [verifying, setVerifying] = useState<string | null>(null);
	const [verificationResult, setVerificationResult] = useState<{
		packageId: string;
		result: VerificationResult;
	} | null>(null);

	const handleVerify = async (packageId: string) => {
		setVerifying(packageId);
		try {
			const result = await verifyAuditPackageAction({ packageId });
			if (result.success) {
				setVerificationResult({ packageId, result: result.data });
			} else {
				toast.error(
					actionErrorMessage(t, result, {}, [
						"settings.auditExport.packages.verifyError",
						"Verification failed",
					]),
				);
			}
		} catch (error) {
			toast.error(t("common.unexpectedError", "An unexpected error occurred"));
			console.error("Verify error:", error);
		}
		setVerifying(null);
	};

	if (packages.length === 0) {
		return (
			<Card>
				<CardHeader>
					<CardTitle className="flex items-center gap-2">
						<IconFileZip className="size-5" />
						{t("settings.auditExport.packages.title", "Audit Packages")}
					</CardTitle>
					<CardDescription>
						{t(
							"settings.auditExport.packages.emptyDescription",
							"No audit packages created yet",
						)}
					</CardDescription>
				</CardHeader>
				<CardContent>
					<p className="text-sm text-muted-foreground">
						{t(
							"settings.auditExport.packages.emptyHint",
							"Audit packages are created when you enable automatic hardening or manually harden an export.",
						)}
					</p>
				</CardContent>
			</Card>
		);
	}

	return (
		<>
			<Card>
				<CardHeader>
					<CardTitle className="flex items-center gap-2">
						<IconFileZip className="size-5 shrink-0" aria-hidden="true" />
						{t("settings.auditExport.packages.title", "Audit Packages")}
					</CardTitle>
					<CardDescription>
						{t(
							"settings.auditExport.packages.description",
							"Cryptographically hardened export packages",
						)}
					</CardDescription>
					<CardAction>
						<Button variant="outline" size="sm" onClick={() => router.refresh()}>
							<IconRefresh className="size-4" aria-hidden="true" />
							{t("common.refresh", "Refresh")}
						</Button>
					</CardAction>
				</CardHeader>
				<CardContent>
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>
									{t("settings.auditExport.packages.colDate", "Date")}
								</TableHead>
								<TableHead>
									{t("settings.auditExport.packages.colType", "Type")}
								</TableHead>
								<TableHead>
									{t("settings.auditExport.packages.colStatus", "Status")}
								</TableHead>
								<TableHead>
									{t("settings.auditExport.packages.colFiles", "Files")}
								</TableHead>
								<TableHead>
									{t("settings.auditExport.packages.colSize", "Size")}
								</TableHead>
								<TableHead>
									{t("settings.auditExport.packages.colRetention", "Retention")}
								</TableHead>
								<TableHead className="text-right">
									{t("settings.auditExport.packages.colActions", "Actions")}
								</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{packages.map((pkg) => (
								<TableRow key={pkg.id}>
									<TableCell>
										<div className="flex flex-col">
											<span className="font-medium">
												{formatDateOnly(new Date(pkg.createdAt), {
													locale,
													timezone,
												})}
											</span>
											<span className="text-xs text-muted-foreground">
												{formatTimeOnly(new Date(pkg.createdAt), {
													locale,
													timezone,
												})}
											</span>
										</div>
									</TableCell>
									<TableCell>
										<Badge variant="outline">
											{pkg.exportType === "data"
												? t("settings.auditExport.packages.typeData", "Data")
												: pkg.exportType === "payroll"
													? t(
															"settings.auditExport.packages.typePayroll",
															"Payroll",
														)
													: t(
															"settings.auditExport.packages.typeAuditPack",
															"Audit Pack",
														)}
										</Badge>
									</TableCell>
									<TableCell>
										<PackageStatusBadge status={pkg.status} t={t} />
									</TableCell>
									<TableCell className="tabular-nums">{pkg.fileCount ?? "-"}</TableCell>
									<TableCell className="whitespace-nowrap tabular-nums">
										{pkg.fileSizeBytes
											? formatFileSize(pkg.fileSizeBytes)
											: "-"}
									</TableCell>
									<TableCell>
										<div className="flex items-center gap-1 whitespace-nowrap">
											{pkg.objectLockEnabled && (
												<>
													<IconLock
														className="size-4 text-muted-foreground"
														aria-hidden="true"
														title={t(
															"settings.auditExport.wORMProtected",
															"WORM protected",
														)}
													/>
													<span className="sr-only">
														{t(
															"settings.auditExport.wORMProtected",
															"WORM protected",
														)}
													</span>
												</>
											)}
											<span className="tabular-nums">
												{t("settings.auditExport.config.yearsOption", "{years} years", {
													years: pkg.retentionYears,
												})}
											</span>
										</div>
									</TableCell>
									<TableCell className="text-right">
										{pkg.status === "completed" && (
											<Button
												variant="outline"
												size="sm"
												onClick={() => handleVerify(pkg.id)}
												disabled={verifying === pkg.id}
											>
												{verifying === pkg.id ? (
													<IconLoader2 className="size-4 animate-spin" aria-hidden="true" />
												) : (
													<IconShieldCheck className="size-4" aria-hidden="true" />
												)}
												{t("settings.auditExport.packages.verify", "Verify")}
											</Button>
										)}
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				</CardContent>
			</Card>

			{/* Verification Result ActionPanel */}
			<ActionPanel
				open={verificationResult !== null}
				onOpenChange={(open) => !open && setVerificationResult(null)}
			>
				<ActionPanelContent>
					<ActionPanelHeader>
						<ActionPanelTitle className="flex items-center gap-2">
							{verificationResult?.result.isValid ? (
								<>
									<IconCheck
										className="size-5 shrink-0 text-success"
										aria-hidden="true"
									/>
									{t(
										"settings.auditExport.verification.valid",
										"Verification Passed",
									)}
								</>
							) : (
								<>
									<IconX className="size-5 shrink-0 text-destructive" aria-hidden="true" />
									{t(
										"settings.auditExport.verification.invalid",
										"Verification Failed",
									)}
								</>
							)}
						</ActionPanelTitle>
						<ActionPanelDescription>
							{verificationResult?.result.summary}
						</ActionPanelDescription>
					</ActionPanelHeader>
					<ActionPanelBody className="space-y-4">
						{verificationResult && (
							<>
								<div className="space-y-2">
									{verificationResult.result.checks.map((check) => (
										<div
											key={check.name}
											className={`flex items-start gap-2 rounded-lg border p-3 ${
												check.passed
													? "border-success/30 bg-success/5"
													: "border-destructive/30 bg-destructive/5"
											}`}
										>
											{check.passed ? (
												<IconCheck
													className="mt-0.5 size-4 shrink-0 text-success"
													aria-hidden="true"
												/>
											) : (
												<IconX
													className="mt-0.5 size-4 shrink-0 text-destructive"
													aria-hidden="true"
												/>
											)}
											<div className="flex-1 min-w-0">
												<p className="font-medium text-sm">{check.name}</p>
												<p className="text-xs text-muted-foreground">
													{check.details}
												</p>
											</div>
										</div>
									))}
								</div>
								<p className="text-xs text-muted-foreground text-center">
									{t(
										"settings.auditExport.verification.verifiedAt",
										"Verified at {time}",
										{
											time: formatDateTime(
												verificationResult.result.verifiedAt,
												{
													locale,
													timezone,
												},
											),
										},
									)}
								</p>
							</>
						)}
					</ActionPanelBody>
				</ActionPanelContent>
			</ActionPanel>
		</>
	);
}

function PackageStatusBadge({
	status,
	t,
}: {
	status: string;
	t: (key: string, defaultValue?: string) => string;
}) {
	switch (status) {
		case "pending":
			return (
				<Badge variant="outline" className="gap-1">
					<IconClock className="size-3" />
					{t("settings.auditExport.packages.statusPending", "Pending")}
				</Badge>
			);
		case "building_manifest":
		case "signing":
		case "timestamping":
		case "uploading":
			return (
				<Badge variant="secondary" className="gap-1">
					<IconLoader2 className="size-3 animate-spin" />
					{t("settings.auditExport.packages.statusProcessing", "Processing")}
				</Badge>
			);
		case "completed":
			return (
				<Badge variant="success" className="gap-1">
					<IconCheck className="size-3" />
					{t("settings.auditExport.packages.statusCompleted", "Completed")}
				</Badge>
			);
		case "failed":
			return (
				<Badge variant="destructive" className="gap-1">
					<IconX className="size-3" />
					{t("settings.auditExport.packages.statusFailed", "Failed")}
				</Badge>
			);
		default:
			return <Badge variant="outline">{status}</Badge>;
	}
}
