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
import { useState } from "react";
import { toast } from "sonner";
import {
	type AuditPackageInfo,
	verifyAuditPackageAction,
} from "@/app/[locale]/(app)/settings/audit-export/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import type { VerificationResult } from "@/lib/audit-export";
import { useRouter } from "@/navigation";

function formatFileSize(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
	return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

interface AuditPackagesTableProps {
	organizationId: string;
	packages: AuditPackageInfo[];
}

export function AuditPackagesTable({ organizationId, packages }: AuditPackagesTableProps) {
	const { t } = useTranslate();
	const router = useRouter();
	const [verifying, setVerifying] = useState<string | null>(null);
	const [verificationResult, setVerificationResult] = useState<{
		packageId: string;
		result: VerificationResult;
	} | null>(null);

	const handleVerify = async (packageId: string) => {
		setVerifying(packageId);
		try {
			const result = await verifyAuditPackageAction(packageId, organizationId);
			if (result.success) {
				setVerificationResult({ packageId, result: result.data });
			} else {
				toast.error(
					result.error || t("settings.auditExport.packages.verifyError", "Verification failed"),
				);
			}
		} catch (error) {
			toast.error(t("common.unexpectedError", "An unexpected error occurred"));
			console.error("Verify error:", error);
		} finally {
			setVerifying(null);
		}
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
						{t("settings.auditExport.packages.emptyDescription", "No audit packages created yet")}
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
				<CardHeader className="flex flex-row items-center justify-between">
					<div>
						<CardTitle className="flex items-center gap-2">
							<IconFileZip className="size-5" />
							{t("settings.auditExport.packages.title", "Audit Packages")}
						</CardTitle>
						<CardDescription>
							{t(
								"settings.auditExport.packages.description",
								"Cryptographically hardened export packages",
							)}
						</CardDescription>
					</div>
					<Button variant="outline" size="sm" onClick={() => router.refresh()}>
						<IconRefresh className="mr-2 size-4" />
						{t("common.refresh", "Refresh")}
					</Button>
				</CardHeader>
				<CardContent>
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>{t("settings.auditExport.packages.colDate", "Date")}</TableHead>
								<TableHead>{t("settings.auditExport.packages.colType", "Type")}</TableHead>
								<TableHead>{t("settings.auditExport.packages.colStatus", "Status")}</TableHead>
								<TableHead>{t("settings.auditExport.packages.colFiles", "Files")}</TableHead>
								<TableHead>{t("settings.auditExport.packages.colSize", "Size")}</TableHead>
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
												{new Date(pkg.createdAt).toLocaleDateString()}
											</span>
											<span className="text-xs text-muted-foreground">
												{new Date(pkg.createdAt).toLocaleTimeString()}
											</span>
										</div>
									</TableCell>
									<TableCell>
										<Badge variant="outline">
											{pkg.exportType === "data"
												? t("settings.auditExport.packages.typeData", "Data")
												: t("settings.auditExport.packages.typePayroll", "Payroll")}
										</Badge>
									</TableCell>
									<TableCell>
										<PackageStatusBadge status={pkg.status} t={t} />
									</TableCell>
									<TableCell>{pkg.fileCount ?? "-"}</TableCell>
									<TableCell>
										{pkg.fileSizeBytes ? formatFileSize(pkg.fileSizeBytes) : "-"}
									</TableCell>
									<TableCell>
										<div className="flex items-center gap-1">
											{pkg.objectLockEnabled && (
												<IconLock className="size-4 text-green-600" title="WORM protected" />
											)}
											<span>{pkg.retentionYears}y</span>
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
													<IconLoader2 className="size-4 animate-spin" />
												) : (
													<IconShieldCheck className="size-4" />
												)}
												<span className="sr-only">
													{t("settings.auditExport.packages.verify", "Verify")}
												</span>
											</Button>
										)}
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				</CardContent>
			</Card>

			{/* Verification Result Dialog */}
			<Dialog
				open={verificationResult !== null}
				onOpenChange={(open) => !open && setVerificationResult(null)}
			>
				<DialogContent className="max-w-lg">
					<DialogHeader>
						<DialogTitle className="flex items-center gap-2">
							{verificationResult?.result.isValid ? (
								<>
									<IconCheck className="size-5 text-green-600" />
									{t("settings.auditExport.verification.valid", "Verification Passed")}
								</>
							) : (
								<>
									<IconX className="size-5 text-red-600" />
									{t("settings.auditExport.verification.invalid", "Verification Failed")}
								</>
							)}
						</DialogTitle>
						<DialogDescription>{verificationResult?.result.summary}</DialogDescription>
					</DialogHeader>
					{verificationResult && (
						<div className="space-y-4">
							<div className="space-y-2">
								{verificationResult.result.checks.map((check) => (
									<div
										key={check.name}
										className={`flex items-start gap-2 rounded-lg border p-3 ${
											check.passed
												? "border-green-500/30 bg-green-500/5"
												: "border-red-500/30 bg-red-500/5"
										}`}
									>
										{check.passed ? (
											<IconCheck className="size-4 text-green-600 mt-0.5" />
										) : (
											<IconX className="size-4 text-red-600 mt-0.5" />
										)}
										<div className="flex-1 min-w-0">
											<p className="font-medium text-sm">{check.name}</p>
											<p className="text-xs text-muted-foreground">{check.details}</p>
										</div>
									</div>
								))}
							</div>
							<p className="text-xs text-muted-foreground text-center">
								{t("settings.auditExport.verification.verifiedAt", "Verified at {time}", {
									time: new Date(verificationResult.result.verifiedAt).toLocaleString(),
								})}
							</p>
						</div>
					)}
				</DialogContent>
			</Dialog>
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
				<Badge className="gap-1 bg-green-600 hover:bg-green-600">
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
