"use client";

import { IconCheck, IconEye, IconFileUpload, IconLoader2, IconRefresh } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { type ChangeEvent, useState } from "react";
import { toast } from "sonner";
import { listContractTemplatesAction } from "@/app/[locale]/(app)/settings/contracts/actions";
import {
	commitCsvImportBatchAction,
	getContractChangeBatchAction,
	listContractChangeBatchesAction,
	previewBulkContractActionAction,
	previewCsvContractImportAction,
	previewCsvLeavingDateImportAction,
	submitBulkContractActionAction,
} from "@/app/[locale]/(app)/settings/contracts/bulk-actions";
import { listTeams } from "@/app/[locale]/(app)/settings/teams/actions";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { BalanceMode } from "@/db/schema/contract-types";
import type { PreviewBulkContractActionResult } from "@/lib/contracts/bulk-operations";
import type {
	CsvImportRowStatus,
	CsvRowDiagnostic,
	PreviewCsvContractImportResult,
	PreviewCsvLeavingDateImportResult,
} from "@/lib/contracts/csv-import";
import type { WorkModel } from "@/lib/contracts/types";
import { todayIsoDateInTimezone, useContractLabels } from "./contract-formatters";

const ALL_VALUE = "__all__";

function createClientRequestId(): string {
	return globalThis.crypto.randomUUID();
}

function translateCsvStatus(
	status: CsvImportRowStatus,
	t: ReturnType<typeof useTranslate>["t"],
): string {
	switch (status) {
		case "valid":
			return t("settings.contracts.csv.statusValid", "Valid");
		case "warning":
			return t("settings.contracts.csv.statusWarning", "Warning");
		case "error":
			return t("settings.contracts.csv.statusError", "Error");
	}
}

function translateCsvDiagnostic(
	diag: CsvRowDiagnostic,
	t: ReturnType<typeof useTranslate>["t"],
): string {
	const p = diag.params ?? {};
	switch (diag.code) {
		case "missing_employee_identifier":
			return t(
				"settings.contracts.csv.diag.missingEmployeeIdentifier",
				"Missing employee identifier (employee_id, employee_number, or email).",
			);
		case "invalid_employee_uuid":
			return t(
				"settings.contracts.csv.diag.invalidEmployeeUuid",
				'Invalid {column} UUID "{value}".',
				p,
			);
		case "employee_not_found":
			return t(
				"settings.contracts.csv.diag.employeeNotFound",
				'Employee not found in organization for {column} "{value}".',
				p,
			);
		case "ambiguous_employee_email":
			return t(
				"settings.contracts.csv.diag.ambiguousEmployeeEmail",
				'Multiple employees match {column} "{value}".',
				p,
			);
		case "conflicting_employee_identifiers":
			return t(
				"settings.contracts.csv.diag.conflictingEmployeeIdentifiers",
				"Conflicting employee identifiers point to different employees.",
			);
		case "invalid_enum_value":
			return t(
				"settings.contracts.csv.diag.invalidEnumValue",
				'Invalid {field} "{value}". Allowed: {allowed}.',
				p,
			);
		case "employee_not_on_roster":
			return t(
				"settings.contracts.csv.diag.employeeNotOnRoster",
				"Employee is no longer on the current roster (rehire before updating terms).",
			);
		case "duplicate_employee_row":
			return t(
				"settings.contracts.csv.diag.duplicateEmployeeRow",
				"Duplicate employee row in CSV import.",
			);
		case "missing_effective_from_date":
			return t(
				"settings.contracts.csv.diag.missingEffectiveFromDate",
				"Missing effective_from_date (and no default effective date provided).",
			);
		case "invalid_field_value":
			return t(
				"settings.contracts.csv.diag.invalidFieldValue",
				"Invalid value for {field}: {detail}",
				p,
			);
		case "work_policy_not_found":
			return t(
				"settings.contracts.csv.diag.workPolicyNotFound",
				'Work policy not found in organization: "{value}".',
				p,
			);
		case "work_policy_inactive":
			return t(
				"settings.contracts.csv.diag.workPolicyInactive",
				'Work policy "{name}" is inactive.',
				p,
			);
		case "custom_days_required":
			return t(
				"settings.contracts.csv.diag.customDaysRequired",
				"custom_days is required when schedule_mode is custom_days.",
			);
		case "negative_hourly_rate":
			return t(
				"settings.contracts.csv.diag.negativeHourlyRate",
				"hourly_rate must be non-negative.",
			);
		case "invalid_currency":
			return t("settings.contracts.csv.diag.invalidCurrency", 'Invalid currency "{value}".', p);
		case "no_contract_fields":
			return t(
				"settings.contracts.csv.diag.noContractFields",
				"Row does not specify any contract fields to update.",
			);
		case "no_active_employment_period":
			return t(
				"settings.contracts.csv.diag.noActiveEmploymentPeriod",
				"Employee has no active employment period on the effective date.",
			);
		case "hourly_rate_required":
			return t(
				"settings.contracts.csv.diag.hourlyRateRequired",
				"Hourly contract requires an hourly_rate value.",
			);
		case "personal_divergence_preserved":
			return t(
				"settings.contracts.csv.diag.personalDivergencePreserved",
				"Personal divergence on {field} will be preserved.",
				p,
			);
		case "cannot_depart_self":
			return t(
				"settings.contracts.csv.diag.cannotDepartSelf",
				"You cannot record a departure for your own employee record.",
			);
		case "missing_last_working_day":
			return t(
				"settings.contracts.csv.diag.missingLastWorkingDay",
				"Missing last_working_day (leaving date).",
			);
		case "invalid_departure_mode":
			return t(
				"settings.contracts.csv.diag.invalidDepartureMode",
				'Invalid departure_mode "{value}". Allowed: scheduled, immediate, retrospective.',
				p,
			);
		case "replacement_is_self":
			return t(
				"settings.contracts.csv.diag.replacementIsSelf",
				"Replacement employee cannot be the departing employee.",
			);
		case "replacement_not_on_roster":
			return t(
				"settings.contracts.csv.diag.replacementNotOnRoster",
				"Replacement employee must be on the current roster.",
			);
		case "replacement_not_manager_or_admin":
			return t(
				"settings.contracts.csv.diag.replacementNotManagerOrAdmin",
				"Replacement employee must be an admin or manager.",
			);
		case "departure_immediate_requires_today":
			return t(
				"settings.contracts.csv.diag.departureImmediateRequiresToday",
				"Immediate departure mode requires today's leaving date and cannot be combined with a past or future date.",
			);
		case "departure_retrospective_requires_past":
			return t(
				"settings.contracts.csv.diag.departureRetrospectiveRequiresPast",
				"Retrospective departure mode requires a strictly past leaving date.",
			);
		case "departure_scheduled_forbids_past":
			return t(
				"settings.contracts.csv.diag.departureScheduledForbidsPast",
				"Scheduled departure mode cannot use a past leaving date.",
			);
		case "departure_former_forbids_active_mode":
			return t(
				"settings.contracts.csv.diag.departureFormerForbidsActiveMode",
				"Scheduled and immediate departure modes cannot be used for an already-former employee.",
			);
		case "departure_before_start_date":
			return t(
				"settings.contracts.csv.diag.departureBeforeStartDate",
				"Leaving date cannot be earlier than the employee's start date.",
			);
		case "departure_reopen_forbidden":
			return t(
				"settings.contracts.csv.diag.departureReopenForbidden",
				"Cannot set today or a future leaving date for an already-former employee (use rehire instead).",
			);
		case "departure_supersedes_pending":
			return t(
				"settings.contracts.csv.diag.departureSupersedesPending",
				"Will supersede existing pending scheduled departure.",
			);
		case "departure_reschedules_pending":
			return t(
				"settings.contracts.csv.diag.departureReschedulesPending",
				"Will reschedule existing pending departure.",
			);
		case "departure_payroll_reconciliation":
			return t(
				"settings.contracts.csv.diag.departurePayrollReconciliation",
				"Touches closed month(s) or settled payroll days; payroll will stay untouched and a payroll reconciliation review will be opened.",
			);
		case "departure_unchanged_skip":
			return t(
				"settings.contracts.csv.diag.departureUnchangedSkip",
				"Effective departure already has this exact leaving date; row will be skipped.",
			);
		case "departure_past_date_correction":
			return t(
				"settings.contracts.csv.diag.departurePastDateCorrection",
				"Will apply date-only correction to effective departure ({from} → {to}).",
				p,
			);
		case "departure_historical_backfill":
			return t(
				"settings.contracts.csv.diag.departureHistoricalBackfill",
				"Will backfill historical leaving date for legacy former employee.",
			);
		default:
			return diag.message;
	}
}

export interface ContractsBulkCsvTabProps {
	organizationId: string;
	organizationTimezone: string;
}

export function ContractsBulkCsvTab({
	organizationId,
	organizationTimezone,
}: ContractsBulkCsvTabProps) {
	const { t } = useTranslate();
	const labels = useContractLabels();
	const queryClient = useQueryClient();

	// Bulk action state
	const [bulkKind, setBulkKind] = useState<
		"adopt_default" | "apply_template_version" | "bulk_operational_update"
	>("adopt_default");
	const [bulkDate, setBulkDate] = useState(() => todayIsoDateInTimezone(organizationTimezone));
	const [bulkTeamId, setBulkTeamId] = useState(ALL_VALUE);
	const [bulkTemplateVersionId, setBulkTemplateVersionId] = useState("");
	const [bulkWorkModel, setBulkWorkModel] = useState<WorkModel | "">("");
	const [bulkBalanceMode, setBulkBalanceMode] = useState<BalanceMode | "">("");
	const [bulkOnlyLegacy, setBulkOnlyLegacy] = useState(true);
	const [bulkOverwrite, setBulkOverwrite] = useState(false);
	const [bulkPreview, setBulkPreview] = useState<PreviewBulkContractActionResult | null>(null);
	const [bulkRequestId, setBulkRequestId] = useState<string | null>(null);

	// CSV wizard state
	const [csvKind, setCsvKind] = useState<"csv_contract_import" | "csv_departure_import">(
		"csv_contract_import",
	);
	const [csvText, setCsvText] = useState("");
	const [csvDefaultDate, setCsvDefaultDate] = useState(() =>
		todayIsoDateInTimezone(organizationTimezone),
	);
	const [csvOverwrite, setCsvOverwrite] = useState(false);
	const [csvAckDuties, setCsvAckDuties] = useState(false);
	const [csvContractPreview, setCsvContractPreview] =
		useState<PreviewCsvContractImportResult | null>(null);
	const [csvDeparturePreview, setCsvDeparturePreview] =
		useState<PreviewCsvLeavingDateImportResult | null>(null);
	const [csvRequestId, setCsvRequestId] = useState<string | null>(null);

	const clearBulkPreview = () => {
		setBulkPreview(null);
		setBulkRequestId(null);
	};

	const clearCsvPreview = () => {
		setCsvContractPreview(null);
		setCsvDeparturePreview(null);
		setCsvRequestId(null);
	};

	// Batch inspector state
	const [selectedBatchId, setSelectedBatchId] = useState<string | null>(null);

	const templatesQuery = useQuery({
		queryKey: ["contracts", "templates", organizationId],
		queryFn: async () => {
			const result = await listContractTemplatesAction({ includeInactive: false });
			return result.success ? result.data : [];
		},
		staleTime: 60 * 1000,
	});

	const teamsQuery = useQuery({
		queryKey: ["contracts", "teams", organizationId],
		queryFn: async () => {
			const result = await listTeams();
			return result.success ? result.data : [];
		},
		staleTime: 60 * 1000,
	});

	const batchesQuery = useQuery({
		queryKey: ["contracts", "batches", organizationId],
		queryFn: async () => {
			const result = await listContractChangeBatchesAction({ limit: 25, offset: 0 });
			if (!result.success) throw new Error(result.error || "Failed to load batches");
			return result.data;
		},
		staleTime: 10 * 1000,
	});

	const batchDetailQuery = useQuery({
		queryKey: ["contracts", "batch-detail", organizationId, selectedBatchId],
		queryFn: async () => {
			if (!selectedBatchId) return null;
			const result = await getContractChangeBatchAction({
				batchId: selectedBatchId,
				limit: 50,
				offset: 0,
			});
			if (!result.success) throw new Error(result.error || "Failed to load batch details");
			return result.data;
		},
		enabled: Boolean(selectedBatchId),
		staleTime: 5 * 1000,
	});

	function buildBulkSpec() {
		const target = {
			...(bulkTeamId !== ALL_VALUE ? { teamId: bulkTeamId } : {}),
			...(bulkKind === "adopt_default" ? { onlyLegacyTerms: bulkOnlyLegacy } : {}),
		};
		if (bulkKind === "apply_template_version") {
			return {
				actionKind: "apply_template_version" as const,
				templateVersionId: bulkTemplateVersionId,
				effectiveFromDate: bulkDate,
				overwritePersonalDivergences: bulkOverwrite,
				target,
			};
		}
		if (bulkKind === "bulk_operational_update") {
			return {
				actionKind: "bulk_operational_update" as const,
				effectiveFromDate: bulkDate,
				overwritePersonalDivergences: bulkOverwrite,
				changes: {
					...(bulkWorkModel ? { workModel: bulkWorkModel } : {}),
					...(bulkBalanceMode ? { balanceMode: bulkBalanceMode } : {}),
				},
				target,
			};
		}
		return {
			actionKind: "adopt_default" as const,
			effectiveFromDate: bulkDate,
			target,
		};
	}

	const bulkPreviewMutation = useMutation({
		mutationFn: async () => {
			const result = await previewBulkContractActionAction(buildBulkSpec());
			if (!result.success) throw new Error(result.error || "Bulk dry-run failed");
			return result.data;
		},
		onSuccess: (data) => {
			setBulkPreview(data);
			setBulkRequestId(createClientRequestId());
		},
		onError: (err) => {
			toast.error(
				err instanceof Error
					? err.message
					: t("settings.contracts.bulk.previewFailed", "Bulk dry-run preview failed."),
			);
		},
	});

	const bulkSubmitMutation = useMutation({
		mutationFn: async () => {
			if (!bulkPreview || !bulkPreview.canSubmit) {
				throw new Error(t("settings.contracts.bulk.previewFailed", "Bulk dry-run preview failed."));
			}
			const requestId = bulkRequestId ?? createClientRequestId();
			if (!bulkRequestId) setBulkRequestId(requestId);
			const result = await submitBulkContractActionAction({
				...buildBulkSpec(),
				requestId,
				confirmationFingerprint: bulkPreview.confirmationFingerprint,
			});
			if (!result.success) throw new Error(result.error || "Bulk submission failed");
			return result.data;
		},
		onSuccess: (receipt) => {
			toast.success(
				t("settings.contracts.bulk.submitted", "Batch started ({count} employees · {mode})", {
					count: receipt.batch.totalItems,
					mode: receipt.executionMode,
				}),
			);
			clearBulkPreview();
			setSelectedBatchId(receipt.batch.id);
			void queryClient.invalidateQueries({ queryKey: ["contracts", "batches", organizationId] });
		},
		onError: (err) => {
			toast.error(
				err instanceof Error
					? err.message
					: t("settings.contracts.bulk.submitFailed", "Could not start batch."),
			);
		},
	});

	const csvPreviewMutation = useMutation({
		mutationFn: async () => {
			if (!csvText.trim()) {
				throw new Error(
					t("settings.contracts.csv.emptyInput", "Upload or paste CSV content first."),
				);
			}
			if (csvKind === "csv_contract_import") {
				const result = await previewCsvContractImportAction({
					csvText,
					defaultEffectiveFromDate: csvDefaultDate || null,
					overwritePersonalDivergences: csvOverwrite,
					maxPreviewRows: 50,
				});
				if (!result.success) throw new Error(result.error || "CSV contract validation failed");
				return { kind: "contract" as const, data: result.data };
			}
			const result = await previewCsvLeavingDateImportAction({
				csvText,
				defaultAcknowledgeUnassignedDuties: csvAckDuties,
				maxPreviewRows: 50,
			});
			if (!result.success) throw new Error(result.error || "CSV leaving-date validation failed");
			return { kind: "departure" as const, data: result.data };
		},
		onSuccess: (res) => {
			if (res.kind === "contract") {
				setCsvContractPreview(res.data);
				setCsvDeparturePreview(null);
			} else {
				setCsvDeparturePreview(res.data);
				setCsvContractPreview(null);
			}
			setCsvRequestId(createClientRequestId());
		},
		onError: (err) => {
			toast.error(
				err instanceof Error
					? err.message
					: t("settings.contracts.csv.previewFailed", "Could not validate CSV."),
			);
		},
	});

	const csvCommitMutation = useMutation({
		mutationFn: async () => {
			const activePreview =
				csvKind === "csv_contract_import" ? csvContractPreview : csvDeparturePreview;
			if (!activePreview || !activePreview.canCommit) {
				throw new Error(
					t("settings.contracts.csv.fixBeforeCommit", "Resolve CSV validation errors first."),
				);
			}
			const requestId = csvRequestId ?? createClientRequestId();
			if (!csvRequestId) setCsvRequestId(requestId);
			const result = await commitCsvImportBatchAction({
				requestId,
				operationKind: csvKind,
				csvText,
				confirmationFingerprint: activePreview.confirmationFingerprint,
				defaultEffectiveFromDate: csvKind === "csv_contract_import" ? csvDefaultDate || null : null,
				overwritePersonalDivergences: csvKind === "csv_contract_import" ? csvOverwrite : undefined,
				defaultAcknowledgeUnassignedDuties:
					csvKind === "csv_departure_import" ? csvAckDuties : undefined,
			});
			if (!result.success) throw new Error(result.error || "CSV commit failed");
			return result.data;
		},
		onSuccess: (receipt) => {
			toast.success(
				t("settings.contracts.csv.committed", "CSV import batch created ({count} rows · {mode})", {
					count: receipt.batch.totalItems,
					mode: receipt.executionMode,
				}),
			);
			clearCsvPreview();
			setCsvText("");
			setSelectedBatchId(receipt.batch.id);
			void queryClient.invalidateQueries({ queryKey: ["contracts", "batches", organizationId] });
		},
		onError: (err) => {
			toast.error(
				err instanceof Error
					? err.message
					: t("settings.contracts.csv.commitFailed", "Could not commit CSV import."),
			);
		},
	});

	const handleCsvFileUpload = async (event: ChangeEvent<HTMLInputElement>) => {
		const file = event.target.files?.[0];
		if (!file) return;
		const content = await file.text();
		setCsvText(content);
		clearCsvPreview();
	};

	const activeCsvPreview =
		csvKind === "csv_contract_import" ? csvContractPreview : csvDeparturePreview;
	const displayedCsvRows = (() => {
		if (!activeCsvPreview) return [];
		const seen = new Set<number>();
		const ordered: (typeof activeCsvPreview.rows)[number][] = [];
		// A1-29: Always surface all validation errors (even rows 51+) ahead of the sample.
		for (const row of activeCsvPreview.errorRowDetails) {
			if (!seen.has(row.rowNumber)) {
				seen.add(row.rowNumber);
				ordered.push(row);
			}
		}
		for (const row of activeCsvPreview.rows) {
			if (!seen.has(row.rowNumber)) {
				seen.add(row.rowNumber);
				ordered.push(row);
			}
		}
		return ordered;
	})();

	return (
		<div className="space-y-6">
			{/* Section 1: Bulk Contract Operations */}
			<Card>
				<CardHeader>
					<CardTitle>{t("settings.contracts.bulk.title", "Bulk Contract Updates")}</CardTitle>
					<CardDescription>
						{t(
							"settings.contracts.bulk.description",
							"Preview and execute crash-safe bulk contract changes. Batches up to 200 employees run inline; larger batches run asynchronously with automatic recovery.",
						)}
					</CardDescription>
				</CardHeader>
				<CardContent className="space-y-4">
					<div className="grid gap-4 sm:grid-cols-3">
						<div className="space-y-1.5">
							<Label htmlFor="bulk-action-kind">
								{t("settings.contracts.bulk.actionKind", "Action")}
							</Label>
							<Select
								value={bulkKind}
								onValueChange={(v) => {
									setBulkKind(v as typeof bulkKind);
									clearBulkPreview();
								}}
							>
								<SelectTrigger id="bulk-action-kind">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="adopt_default">
										{t(
											"settings.contracts.bulk.kindAdoptDefault",
											"Adopt Org/Team Default (migrated legacy terms)",
										)}
									</SelectItem>
									<SelectItem value="apply_template_version">
										{t("settings.contracts.bulk.kindApplyTemplate", "Apply Contract Template")}
									</SelectItem>
									<SelectItem value="bulk_operational_update">
										{t(
											"settings.contracts.bulk.kindOperationalUpdate",
											"Bulk Operational Rule Update",
										)}
									</SelectItem>
								</SelectContent>
							</Select>
						</div>

						<div className="space-y-1.5">
							<Label htmlFor="bulk-effective-date">
								{t("settings.contracts.defaults.effectiveFrom", "Effective from")}
							</Label>
							<Input
								id="bulk-effective-date"
								type="date"
								value={bulkDate}
								onChange={(e) => {
									setBulkDate(e.target.value);
									clearBulkPreview();
								}}
							/>
						</div>

						<div className="space-y-1.5">
							<Label htmlFor="bulk-target-team">
								{t("settings.contracts.bulk.teamFilter", "Team filter")}
							</Label>
							<Select
								value={bulkTeamId}
								onValueChange={(v) => {
									setBulkTeamId(v);
									clearBulkPreview();
								}}
							>
								<SelectTrigger id="bulk-target-team">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value={ALL_VALUE}>
										{t("settings.contracts.bulk.allCurrentRoster", "All current-roster employees")}
									</SelectItem>
									{(teamsQuery.data ?? []).map((tm) => (
										<SelectItem key={tm.id} value={tm.id}>
											{tm.name}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
					</div>

					{bulkKind === "apply_template_version" && (
						<div className="space-y-1.5">
							<Label htmlFor="bulk-template-select">
								{t("settings.contracts.bulk.selectTemplate", "Contract template")}
							</Label>
							<Select
								value={bulkTemplateVersionId}
								onValueChange={(v) => {
									setBulkTemplateVersionId(v);
									clearBulkPreview();
								}}
							>
								<SelectTrigger id="bulk-template-select">
									<SelectValue
										placeholder={t(
											"settings.contracts.bulk.chooseTemplate",
											"Choose a contract template",
										)}
									/>
								</SelectTrigger>
								<SelectContent>
									{(templatesQuery.data ?? [])
										.filter((tpl) => tpl.latestVersion)
										.map((tpl) => (
											<SelectItem key={tpl.id} value={tpl.latestVersion!.id}>
												{tpl.name} (v{tpl.latestVersion!.versionNumber})
											</SelectItem>
										))}
								</SelectContent>
							</Select>
						</div>
					)}

					{bulkKind === "bulk_operational_update" && (
						<div className="grid gap-4 sm:grid-cols-2">
							<div className="space-y-1.5">
								<Label htmlFor="bulk-work-model">
									{t("settings.contracts.fields.workModel", "Work model")}
								</Label>
								<Select
									value={bulkWorkModel || ALL_VALUE}
									onValueChange={(v) => {
										setBulkWorkModel(v === ALL_VALUE ? "" : (v as WorkModel));
										clearBulkPreview();
									}}
								>
									<SelectTrigger id="bulk-work-model">
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value={ALL_VALUE}>
											{t("settings.contracts.bulk.noChange", "No change")}
										</SelectItem>
										<SelectItem value="onsite">{labels.workModel("onsite")}</SelectItem>
										<SelectItem value="hybrid">{labels.workModel("hybrid")}</SelectItem>
										<SelectItem value="remote">{labels.workModel("remote")}</SelectItem>
										<SelectItem value="flexible">{labels.workModel("flexible")}</SelectItem>
									</SelectContent>
								</Select>
							</div>
							<div className="space-y-1.5">
								<Label htmlFor="bulk-balance-mode">
									{t("settings.contracts.fields.balanceMode", "Balance mode")}
								</Label>
								<Select
									value={bulkBalanceMode || ALL_VALUE}
									onValueChange={(v) => {
										setBulkBalanceMode(v === ALL_VALUE ? "" : (v as BalanceMode));
										clearBulkPreview();
									}}
								>
									<SelectTrigger id="bulk-balance-mode">
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value={ALL_VALUE}>
											{t("settings.contracts.bulk.noChange", "No change")}
										</SelectItem>
										<SelectItem value="tracked">{labels.balanceMode("tracked")}</SelectItem>
										<SelectItem value="trust_based">{labels.balanceMode("trust_based")}</SelectItem>
									</SelectContent>
								</Select>
							</div>
						</div>
					)}

					{bulkKind === "adopt_default" ? (
						<div className="flex items-center gap-2">
							<Checkbox
								id="bulk-only-legacy"
								checked={bulkOnlyLegacy}
								onCheckedChange={(c) => {
									setBulkOnlyLegacy(c === true);
									clearBulkPreview();
								}}
							/>
							<Label htmlFor="bulk-only-legacy">
								{t(
									"settings.contracts.bulk.onlyLegacyTerms",
									"Target only employees with migrated legacy terms",
								)}
							</Label>
						</div>
					) : (
						<div className="flex items-center gap-2">
							<Checkbox
								id="bulk-overwrite-divergences"
								checked={bulkOverwrite}
								onCheckedChange={(c) => {
									setBulkOverwrite(c === true);
									clearBulkPreview();
								}}
							/>
							<Label htmlFor="bulk-overwrite-divergences">
								{t(
									"settings.contracts.bulk.overwritePersonal",
									"Overwrite existing personal divergences",
								)}
							</Label>
						</div>
					)}

					{bulkPreview && (
						<Alert role="status">
							<AlertDescription className="space-y-2">
								<div className="flex flex-wrap gap-2 text-xs">
									<Badge variant="outline">
										{t("settings.contracts.bulk.totalMatched", "{count} matched", {
											count: bulkPreview.totalMatched,
										})}
									</Badge>
									<Badge variant="default">
										{t("settings.contracts.bulk.willUpdate", "{count} will update", {
											count: bulkPreview.affectedCount,
										})}
									</Badge>
									<Badge variant="secondary">
										{t(
											"settings.contracts.bulk.skippedDivergence",
											"{count} preserved divergences",
											{ count: bulkPreview.skippedDivergenceCount },
										)}
									</Badge>
									<Badge variant="outline">
										{t("settings.contracts.bulk.executionMode", "Mode: {mode}", {
											mode: bulkPreview.executionMode,
										})}
									</Badge>
									{bulkPreview.validationErrorCount > 0 && (
										<Badge variant="destructive">
											{t("settings.contracts.bulk.validationErrors", "{count} errors", {
												count: bulkPreview.validationErrorCount,
											})}
										</Badge>
									)}
								</div>
								{bulkPreview.validationIssues.length > 0 && (
									<ul className="list-disc pl-5 text-destructive text-xs">
										{bulkPreview.validationIssues.slice(0, 5).map((issue) => (
											<li key={issue.employeeId}>
												{issue.employeeNumber ?? issue.employeeId}: {issue.errors.join("; ")}
											</li>
										))}
									</ul>
								)}
							</AlertDescription>
						</Alert>
					)}

					<div className="flex flex-wrap justify-end gap-2">
						<Button
							type="button"
							variant="outline"
							disabled={bulkPreviewMutation.isPending}
							onClick={() => bulkPreviewMutation.mutate()}
						>
							{bulkPreviewMutation.isPending ? (
								<IconLoader2 className="mr-1.5 size-4 animate-spin" aria-hidden="true" />
							) : (
								<IconEye className="mr-1.5 size-4" aria-hidden="true" />
							)}
							{t("settings.contracts.bulk.runPreview", "Run dry-run preview")}
						</Button>
						<Button
							type="button"
							disabled={!bulkPreview?.canSubmit || bulkSubmitMutation.isPending}
							onClick={() => bulkSubmitMutation.mutate()}
						>
							{bulkSubmitMutation.isPending ? (
								<IconLoader2 className="mr-1.5 size-4 animate-spin" aria-hidden="true" />
							) : (
								<IconCheck className="mr-1.5 size-4" aria-hidden="true" />
							)}
							{t("settings.contracts.bulk.submitBatch", "Execute bulk update")}
						</Button>
					</div>
				</CardContent>
			</Card>

			{/* Section 2: CSV Upload & Validation Wizard */}
			<Card>
				<CardHeader>
					<CardTitle>
						{t("settings.contracts.csv.title", "CSV Import Wizard (Contracts & Leaving Dates)")}
					</CardTitle>
					<CardDescription>
						{t(
							"settings.contracts.csv.description",
							"Upload or paste a CSV file to validate every row before committing. Supports both contract updates and leaving-date imports (future, past, or date-only corrections).",
						)}
					</CardDescription>
				</CardHeader>
				<CardContent className="space-y-4">
					<div className="grid gap-4 sm:grid-cols-3">
						<div className="space-y-1.5">
							<Label htmlFor="csv-import-kind">
								{t("settings.contracts.csv.importType", "Import type")}
							</Label>
							<Select
								value={csvKind}
								onValueChange={(v) => {
									setCsvKind(v as typeof csvKind);
									clearCsvPreview();
								}}
							>
								<SelectTrigger id="csv-import-kind">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="csv_contract_import">
										{t("settings.contracts.csv.typeContracts", "Contract updates CSV")}
									</SelectItem>
									<SelectItem value="csv_departure_import">
										{t("settings.contracts.csv.typeLeavingDates", "Leaving dates CSV")}
									</SelectItem>
								</SelectContent>
							</Select>
						</div>

						{csvKind === "csv_contract_import" && (
							<div className="space-y-1.5">
								<Label htmlFor="csv-default-date">
									{t("settings.contracts.csv.defaultDate", "Default effective date")}
								</Label>
								<Input
									id="csv-default-date"
									type="date"
									value={csvDefaultDate}
									onChange={(e) => {
										setCsvDefaultDate(e.target.value);
										clearCsvPreview();
									}}
								/>
							</div>
						)}

						<div className="space-y-1.5">
							<Label htmlFor="csv-file-input">
								{t("settings.contracts.csv.uploadFile", "Upload CSV file")}
							</Label>
							<div className="flex items-center gap-2">
								<Input
									id="csv-file-input"
									type="file"
									accept=".csv,text/csv"
									onChange={(e) => void handleCsvFileUpload(e)}
								/>
							</div>
						</div>
					</div>

					<div className="space-y-1.5">
						<Label htmlFor="csv-paste-area">
							{t("settings.contracts.csv.pasteLabel", "Or paste CSV content")}
						</Label>
						<Textarea
							id="csv-paste-area"
							rows={5}
							className="font-mono text-xs"
							value={csvText}
							onChange={(e) => {
								setCsvText(e.target.value);
								clearCsvPreview();
							}}
							placeholder={
								csvKind === "csv_contract_import"
									? "employee_number,effective_from_date,weekly_hours,work_model,balance_mode\nEMP-001,2026-07-01,38.5,hybrid,tracked"
									: "employee_number,last_working_day,action\nEMP-001,2026-09-30,schedule"
							}
						/>
					</div>

					{csvKind === "csv_contract_import" ? (
						<div className="flex items-center gap-2">
							<Checkbox
								id="csv-overwrite-divergences"
								checked={csvOverwrite}
								onCheckedChange={(c) => {
									setCsvOverwrite(c === true);
									clearCsvPreview();
								}}
							/>
							<Label htmlFor="csv-overwrite-divergences">
								{t(
									"settings.contracts.csv.overwriteDivergences",
									"Overwrite existing personal divergences",
								)}
							</Label>
						</div>
					) : (
						<div className="flex items-center gap-2">
							<Checkbox
								id="csv-ack-duties"
								checked={csvAckDuties}
								onCheckedChange={(c) => {
									setCsvAckDuties(c === true);
									clearCsvPreview();
								}}
							/>
							<Label htmlFor="csv-ack-duties">
								{t(
									"settings.contracts.csv.ackUnassignedDuties",
									"Acknowledge unassigned approval duties by default",
								)}
							</Label>
						</div>
					)}

					{activeCsvPreview && (
						<div className="space-y-3 rounded-lg border bg-muted/20 p-4">
							<div className="flex flex-wrap gap-2 text-xs">
								<Badge variant="outline">
									{t("settings.contracts.csv.totalRows", "{count} rows", {
										count: activeCsvPreview.totalRows,
									})}
								</Badge>
								<Badge variant="default">
									{t("settings.contracts.csv.validRows", "{count} valid", {
										count: activeCsvPreview.validRows,
									})}
								</Badge>
								{activeCsvPreview.warningRows > 0 && (
									<Badge variant="secondary">
										{t("settings.contracts.csv.warningRows", "{count} warnings", {
											count: activeCsvPreview.warningRows,
										})}
									</Badge>
								)}
								{activeCsvPreview.errorRows > 0 && (
									<Badge variant="destructive">
										{t("settings.contracts.csv.errorRows", "{count} errors", {
											count: activeCsvPreview.errorRows,
										})}
									</Badge>
								)}
								<Badge variant="outline">
									{t("settings.contracts.bulk.executionMode", "Mode: {mode}", {
										mode: activeCsvPreview.executionMode,
									})}
								</Badge>
							</div>

							<div className="max-h-56 overflow-y-auto rounded border bg-background">
								<table className="w-full text-left text-xs">
									<thead className="border-b bg-muted/40">
										<tr>
											<th className="px-2.5 py-1.5">{t("settings.contracts.csv.colRow", "Row")}</th>
											<th className="px-2.5 py-1.5">
												{t("settings.contracts.csv.colEmployee", "Employee")}
											</th>
											<th className="px-2.5 py-1.5">
												{t("settings.contracts.csv.colStatus", "Status")}
											</th>
											<th className="px-2.5 py-1.5">
												{t("settings.contracts.csv.colDetails", "Details")}
											</th>
										</tr>
									</thead>
									<tbody className="divide-y">
										{displayedCsvRows.map((row) => (
											<tr key={row.rowNumber}>
												<td className="px-2.5 py-1.5 tabular-nums">{row.rowNumber}</td>
												<td className="px-2.5 py-1.5">
													{row.employeeName ?? row.employeeIdentifier}
												</td>
												<td className="px-2.5 py-1.5">
													<Badge
														variant={
															row.status === "error"
																? "destructive"
																: row.status === "warning"
																	? "secondary"
																	: "outline"
														}
													>
														{translateCsvStatus(row.status, t)}
													</Badge>
												</td>
												<td className="px-2.5 py-1.5 text-muted-foreground">
													{row.errorDetails.length > 0
														? row.errorDetails
																.map((diag) => translateCsvDiagnostic(diag, t))
																.join("; ")
														: row.warningDetails.length > 0
															? row.warningDetails
																	.map((diag) => translateCsvDiagnostic(diag, t))
																	.join("; ")
															: t("settings.contracts.csv.rowReady", "Ready to commit")}
												</td>
											</tr>
										))}
									</tbody>
								</table>
							</div>
							{(activeCsvPreview.rowsTruncated || activeCsvPreview.errorRowsTruncated) && (
								<p className="text-muted-foreground text-xs">
									{activeCsvPreview.errorRowsTruncated
										? t(
												"settings.contracts.csv.errorRowsTruncatedNote",
												"Showing the first {shown} of {total} validation errors.",
												{
													shown: activeCsvPreview.errorRowDetails.length,
													total: activeCsvPreview.errorRows,
												},
											)
										: t(
												"settings.contracts.csv.rowsTruncatedNote",
												"Showing all {errorCount} error rows plus the first {sampleCount} of {totalCount} rows.",
												{
													errorCount: activeCsvPreview.errorRows,
													sampleCount: activeCsvPreview.rows.length,
													totalCount: activeCsvPreview.totalRows,
												},
											)}
								</p>
							)}
						</div>
					)}

					<div className="flex flex-wrap justify-end gap-2">
						<Button
							type="button"
							variant="outline"
							disabled={csvPreviewMutation.isPending || !csvText.trim()}
							onClick={() => csvPreviewMutation.mutate()}
						>
							{csvPreviewMutation.isPending ? (
								<IconLoader2 className="mr-1.5 size-4 animate-spin" aria-hidden="true" />
							) : (
								<IconFileUpload className="mr-1.5 size-4" aria-hidden="true" />
							)}
							{t("settings.contracts.csv.validateButton", "Validate CSV")}
						</Button>
						<Button
							type="button"
							disabled={!activeCsvPreview?.canCommit || csvCommitMutation.isPending}
							onClick={() => csvCommitMutation.mutate()}
						>
							{csvCommitMutation.isPending ? (
								<IconLoader2 className="mr-1.5 size-4 animate-spin" aria-hidden="true" />
							) : (
								<IconCheck className="mr-1.5 size-4" aria-hidden="true" />
							)}
							{t("settings.contracts.csv.commitButton", "Commit CSV import")}
						</Button>
					</div>
				</CardContent>
			</Card>

			{/* Section 3: Batch Progress & Status Monitor */}
			<Card>
				<CardHeader>
					<div className="flex flex-wrap items-center justify-between gap-2">
						<div>
							<CardTitle>
								{t("settings.contracts.batches.title", "Batch Progress & Status Monitor")}
							</CardTitle>
							<CardDescription>
								{t(
									"settings.contracts.batches.description",
									"Track inline and background bulk/CSV batches, including per-employee outcomes.",
								)}
							</CardDescription>
						</div>
						<Button
							type="button"
							variant="outline"
							size="sm"
							disabled={batchesQuery.isFetching}
							onClick={() => void batchesQuery.refetch()}
						>
							<IconRefresh className="mr-1.5 size-4" aria-hidden="true" />
							{t("common.refresh", "Refresh")}
						</Button>
					</div>
				</CardHeader>
				<CardContent className="space-y-3">
					{batchesQuery.isLoading ? (
						<p className="text-muted-foreground text-sm">{t("common.loading", "Loading…")}</p>
					) : (batchesQuery.data ?? []).length === 0 ? (
						<p className="text-muted-foreground text-sm">
							{t("settings.contracts.batches.empty", "No bulk or CSV batches have been run yet.")}
						</p>
					) : (
						<ul className="space-y-2">
							{(batchesQuery.data ?? []).map((batch) => {
								const isSelected = selectedBatchId === batch.id;
								const processedItems =
									batch.completedItems + batch.skippedItems + batch.failedItems;
								return (
									<li key={batch.id} className="rounded-lg border p-3 text-sm">
										<div className="flex flex-wrap items-center justify-between gap-2">
											<div className="flex flex-wrap items-center gap-2">
												<Badge
													variant={
														batch.status === "failed" || batch.status === "completed_with_errors"
															? "destructive"
															: batch.status === "completed"
																? "default"
																: "secondary"
													}
												>
													{batch.status}
												</Badge>
												<span className="font-medium">{batch.operationKind}</span>
												<Badge variant="outline">{batch.executionMode}</Badge>
											</div>
											<Button
												type="button"
												variant="ghost"
												size="sm"
												onClick={() => setSelectedBatchId(isSelected ? null : batch.id)}
											>
												{isSelected
													? t("settings.contracts.batches.hideDetails", "Hide items")
													: t("settings.contracts.batches.viewDetails", "Inspect items")}
											</Button>
										</div>
										<p className="mt-1.5 text-muted-foreground text-xs tabular-nums">
											{t(
												"settings.contracts.batches.progressSummary",
												"{processed}/{total} processed · {succeeded} succeeded · {skipped} skipped · {failed} failed",
												{
													processed: processedItems,
													total: batch.totalItems,
													succeeded: batch.completedItems,
													skipped: batch.skippedItems,
													failed: batch.failedItems,
												},
											)}
										</p>
										{isSelected && batchDetailQuery.data && (
											<div className="mt-3 max-h-48 overflow-y-auto rounded border bg-muted/20 p-2 text-xs">
												<ul className="space-y-1">
													{batchDetailQuery.data.items.map((item) => (
														<li
															key={item.id}
															className="flex flex-wrap items-center justify-between gap-2 border-b pb-1 last:border-b-0"
														>
															<span className="font-mono">{item.employeeId}</span>
															<div className="flex items-center gap-2">
																<Badge
																	variant={item.status === "failed" ? "destructive" : "outline"}
																>
																	{item.status}
																</Badge>
																{item.errorMessage && (
																	<span className="text-destructive">{item.errorMessage}</span>
																)}
															</div>
														</li>
													))}
												</ul>
											</div>
										)}
									</li>
								);
							})}
						</ul>
					)}
				</CardContent>
			</Card>
		</div>
	);
}
