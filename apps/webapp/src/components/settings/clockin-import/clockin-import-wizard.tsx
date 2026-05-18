"use client";

import {
	IconArrowLeft,
	IconArrowRight,
	IconCheck,
	IconKey,
	IconLoader2,
	IconUsers,
} from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
	type ClockinEmployeeInfo,
	type ClockinPreview,
	fetchClockinEmployees,
	fetchZ8Employees,
	validateClockinCredentials,
	type Z8EmployeeInfo,
} from "@/app/[locale]/(app)/settings/import/clockin-actions";
import { startImportReviewScan } from "@/app/[locale]/(app)/settings/import/review-actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DatePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ClockinImportSelections, ClockinImportUserMapping } from "@/lib/clockin/import-types";
import { Link } from "@/navigation";

type WizardStep = "connect" | "preview" | "mapping" | "selection" | "importing" | "review";

interface ClockinImportWizardProps {
	organizationId: string;
}

interface MappingRow {
	clockinEmployeeId: number;
	clockinEmployeeName: string;
	clockinEmployeeEmail: string | null;
	employeeId: string | null;
	userId: string | null;
	employeeName: string | null;
	mappingType: ClockinImportUserMapping["mappingType"];
}

export function ClockinImportWizard({ organizationId }: ClockinImportWizardProps) {
	const { t } = useTranslate();
	const [step, setStep] = useState<WizardStep>("connect");
	const [token, setToken] = useState("");
	const [preview, setPreview] = useState<ClockinPreview | null>(null);
	const [z8Employees, setZ8Employees] = useState<Z8EmployeeInfo[]>([]);
	const [mappings, setMappings] = useState<MappingRow[]>([]);
	const [busyAction, setBusyAction] = useState<"connect" | "mapping" | "import" | null>(null);
	const [reviewBatchId, setReviewBatchId] = useState<string | null>(null);
	const [selections, setSelections] = useState<ClockinImportSelections>({
		workdays: true,
		absences: true,
		schedules: false,
		dateRange: {
			startDate: new Date(new Date().getFullYear(), 0, 1).toISOString().slice(0, 10),
			endDate: new Date().toISOString().slice(0, 10),
		},
	});

	const mappedCount = useMemo(
		() => mappings.filter((entry) => entry.employeeId != null).length,
		[mappings],
	);

	const handleConnect = async () => {
		setBusyAction("connect");
		try {
			const result = await validateClockinCredentials(token, organizationId);
			if (!result.success) {
				toast.error(result.error);
				return;
			}

			setPreview(result.data);
			setStep("preview");
		} finally {
			setBusyAction(null);
		}
	};

	const handleLoadMappings = async () => {
		setBusyAction("mapping");
		try {
			const [clockinResult, z8Result] = await Promise.all([
				fetchClockinEmployees(token, organizationId),
				fetchZ8Employees(organizationId),
			]);

			if (!clockinResult.success) {
				toast.error(clockinResult.error);
				return;
			}

			if (!z8Result.success) {
				toast.error(z8Result.error);
				return;
			}

			setZ8Employees(z8Result.data);
			const employeesByEmail = new Map<string, Z8EmployeeInfo>();
			for (const employee of z8Result.data) {
				employeesByEmail.set(employee.email.toLowerCase(), employee);
			}

			setMappings(
				clockinResult.data.map((entry: ClockinEmployeeInfo) => {
					const match = entry.email ? employeesByEmail.get(entry.email.toLowerCase()) : null;
					return {
						clockinEmployeeId: entry.id,
						clockinEmployeeName: entry.name,
						clockinEmployeeEmail: entry.email,
						employeeId: match?.id ?? null,
						userId: match?.userId ?? null,
						employeeName: match?.name ?? null,
						mappingType: match ? "auto_email" : "skipped",
					};
				}),
			);
			setStep("mapping");
		} finally {
			setBusyAction(null);
		}
	};

	const handleImport = async () => {
		setBusyAction("import");
		setStep("importing");
		try {
			const employeeMappings = mappings
				.filter((entry) => entry.employeeId != null)
				.map((entry) => ({
					providerEmployeeId: String(entry.clockinEmployeeId),
					employeeId: entry.employeeId as string,
					userId: entry.userId,
				}));
			const entityTypes = [
				...(selections.workdays ? (["work_period"] as const) : []),
				...(selections.absences ? (["absence"] as const) : []),
			];
			const scanResult = await startImportReviewScan({
				organizationId,
				provider: "clockin",
				credential: token,
				selectedScope: selections,
				dateRange: selections.dateRange,
				employeeIds: employeeMappings.map((entry) => entry.providerEmployeeId),
				employeeMappings,
				entityTypes,
			});

			if (!scanResult.success) {
				toast.error(scanResult.error);
				setStep("selection");
				return;
			}

			setReviewBatchId(scanResult.data.batchId);
			toast.success("Import review scan started. Review is required before records are committed.");
			setStep("review");
		} finally {
			setBusyAction(null);
		}
	};

	const updateMapping = (clockinEmployeeId: number, employeeId: string) => {
		const employee = z8Employees.find((entry) => entry.id === employeeId) ?? null;
		setMappings((current) =>
			current.map((entry) =>
				entry.clockinEmployeeId === clockinEmployeeId
					? {
							...entry,
							employeeId: employee?.id ?? null,
							userId: employee?.userId ?? null,
							employeeName: employee?.name ?? null,
							mappingType: employee ? "manual" : "skipped",
						}
					: entry,
			),
		);
	};

	return (
		<div className="space-y-6">
			{step === "connect" && (
				<Card>
					<CardHeader>
						<CardTitle className="flex items-center gap-2">
							<IconKey className="size-5" />
							{t("settings.clockinImport.credentials.title", "Clockin API Token")}
						</CardTitle>
						<CardDescription>
							{t(
								"settings.clockinImport.credentials.description",
								"Enter a Clockin customer API bearer token. The token is only used for this import session.",
							)}
						</CardDescription>
					</CardHeader>
					<CardContent className="space-y-4">
						<div className="space-y-2">
							<Label htmlFor="clockin-token">
								{t("settings.clockinImport.credentials.token", "Bearer Token")}
							</Label>
							<Input
								id="clockin-token"
								type="password"
								value={token}
								onChange={(event) => setToken(event.target.value)}
								placeholder="clk_..."
								autoComplete="off"
							/>
						</div>
						<div className="flex justify-end">
							<Button onClick={handleConnect} disabled={!token.trim() || busyAction === "connect"}>
								{busyAction === "connect" ? (
									<IconLoader2 className="mr-2 size-4 animate-spin" />
								) : (
									<IconArrowRight className="mr-2 size-4" />
								)}
								{t("settings.clockinImport.credentials.connect", "Connect & Preview")}
							</Button>
						</div>
					</CardContent>
				</Card>
			)}

			{step === "preview" && preview && (
				<Card>
					<CardHeader>
						<CardTitle>{t("settings.clockinImport.preview.title", "Clockin Preview")}</CardTitle>
						<CardDescription>
							{t(
								"settings.clockinImport.preview.description",
								"Review what Clockin data is available before mapping employees and scanning records.",
							)}
						</CardDescription>
					</CardHeader>
					<CardContent className="space-y-4">
						<div className="grid gap-3 sm:grid-cols-3">
							<PreviewStat label="Employees" value={preview.employees} />
							<PreviewStat label="Workdays" value={preview.workdays} />
							<PreviewStat label="Absences" value={preview.absences} />
						</div>
						<div className="flex justify-between">
							<Button variant="outline" onClick={() => setStep("connect")}>
								<IconArrowLeft className="mr-2 size-4" />
								{t("common.back", "Back")}
							</Button>
							<Button onClick={handleLoadMappings} disabled={busyAction === "mapping"}>
								{busyAction === "mapping" ? (
									<IconLoader2 className="mr-2 size-4 animate-spin" />
								) : (
									<IconUsers className="mr-2 size-4" />
								)}
								{t("settings.clockinImport.preview.next", "Map Employees")}
							</Button>
						</div>
					</CardContent>
				</Card>
			)}

			{step === "mapping" && (
				<Card>
					<CardHeader>
						<CardTitle>{t("settings.clockinImport.mapping.title", "Map Employees")}</CardTitle>
						<CardDescription>
							{t(
								"settings.clockinImport.mapping.description",
								"Match Clockin employees to existing Z8 employees. Automatic email matches are preselected.",
							)}
						</CardDescription>
					</CardHeader>
					<CardContent className="space-y-4">
						<p className="text-sm text-muted-foreground">
							{t("settings.clockinImport.mapping.summary", "Mapped employees")}: {mappedCount}/
							{mappings.length}
						</p>
						<div className="space-y-3">
							{mappings.map((entry) => (
								<div
									key={entry.clockinEmployeeId}
									className="grid gap-2 rounded-lg border p-3 md:grid-cols-[1.3fr_1fr]"
								>
									<div>
										<p className="font-medium">{entry.clockinEmployeeName}</p>
										<p className="text-sm text-muted-foreground">
											{entry.clockinEmployeeEmail ?? "No email in Clockin"}
										</p>
									</div>
									<select
										value={entry.employeeId ?? ""}
										aria-label={`Map ${entry.clockinEmployeeName}`}
										onChange={(event) => updateMapping(entry.clockinEmployeeId, event.target.value)}
										className="h-10 rounded-md border border-input bg-background px-3 text-sm"
									>
										<option value="">Skip this employee</option>
										{z8Employees.map((employee) => (
											<option key={employee.id} value={employee.id}>
												{employee.name} ({employee.email})
											</option>
										))}
									</select>
								</div>
							))}
						</div>
						<div className="flex justify-between">
							<Button variant="outline" onClick={() => setStep("preview")}>
								<IconArrowLeft className="mr-2 size-4" />
								{t("common.back", "Back")}
							</Button>
							<Button onClick={() => setStep("selection")}>
								<IconArrowRight className="mr-2 size-4" />
								{t("common.continue", "Continue")}
							</Button>
						</div>
					</CardContent>
				</Card>
			)}

			{step === "selection" && (
				<Card>
					<CardHeader>
						<CardTitle>{t("settings.clockinImport.selection.title", "Import Scope")}</CardTitle>
						<CardDescription>
							{t(
								"settings.clockinImport.selection.description",
								"Choose which Clockin records to scan for review. Records must be reviewed before commit.",
							)}
						</CardDescription>
					</CardHeader>
					<CardContent className="space-y-4">
						<label className="flex items-center gap-3 text-sm">
							<input
								type="checkbox"
								checked={selections.workdays}
								onChange={(event) =>
									setSelections((current) => ({ ...current, workdays: event.target.checked }))
								}
							/>
							<span>Workdays / Work periods</span>
						</label>
						<label className="flex items-center gap-3 text-sm">
							<input
								type="checkbox"
								checked={selections.absences}
								onChange={(event) =>
									setSelections((current) => ({ ...current, absences: event.target.checked }))
								}
							/>
							<span>Absences</span>
						</label>
						<div className="grid gap-4 md:grid-cols-2">
							<div className="space-y-2">
								<Label htmlFor="clockin-start-date">Start date</Label>
								<DatePicker
									id="clockin-start-date"
									value={selections.dateRange.startDate}
									onChange={(value) =>
										setSelections((current) => ({
											...current,
											dateRange: { ...current.dateRange, startDate: value },
										}))
									}
								/>
							</div>
							<div className="space-y-2">
								<Label htmlFor="clockin-end-date">End date</Label>
								<DatePicker
									id="clockin-end-date"
									value={selections.dateRange.endDate}
									onChange={(value) =>
										setSelections((current) => ({
											...current,
											dateRange: { ...current.dateRange, endDate: value },
										}))
									}
								/>
							</div>
						</div>
						<div className="flex justify-between">
							<Button variant="outline" onClick={() => setStep("mapping")}>
								<IconArrowLeft className="mr-2 size-4" />
								{t("common.back", "Back")}
							</Button>
							<Button
								onClick={handleImport}
								disabled={
									busyAction === "import" ||
									(!selections.workdays && !selections.absences) ||
									!selections.dateRange.startDate ||
									!selections.dateRange.endDate
								}
							>
								<IconArrowRight className="mr-2 size-4" />
								Start Review Scan
							</Button>
						</div>
					</CardContent>
				</Card>
			)}

			{step === "importing" && (
				<Card>
					<CardContent className="flex items-center gap-3 py-8 text-sm text-muted-foreground">
						<IconLoader2 className="size-4 animate-spin" />
						Starting Clockin import review scan…
					</CardContent>
				</Card>
			)}

			{step === "review" && reviewBatchId && (
				<Card>
					<CardHeader>
						<CardTitle className="flex items-center gap-2">
							<IconCheck className="size-5 text-green-600" aria-hidden="true" />
							Import review scan started
						</CardTitle>
						<CardDescription>
							Review batch {reviewBatchId} is scanning. Review and approve records before commit.
						</CardDescription>
					</CardHeader>
					<CardContent className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
						<p className="text-sm text-muted-foreground">
							No production records have been imported yet.
						</p>
						<Button asChild>
							<Link href={`/settings/import/${reviewBatchId}`}>Open review</Link>
						</Button>
					</CardContent>
				</Card>
			)}
		</div>
	);
}

function PreviewStat({ label, value }: { label: string; value: number }) {
	return (
		<div className="rounded-lg border p-4">
			<p className="text-sm text-muted-foreground">{label}</p>
			<p className="font-semibold text-2xl">{value}</p>
		</div>
	);
}
