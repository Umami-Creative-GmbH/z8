"use client";

import { useTranslate } from "@tolgee/react";
import { useState } from "react";
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
import type {
	ClockinImportSelections,
	ClockinImportUserMapping,
} from "@/lib/clockin/import-types";

export type ClockinWizardStep =
	| "connect"
	| "preview"
	| "mapping"
	| "selection"
	| "importing"
	| "review";

export interface ClockinMappingRow {
	clockinEmployeeId: number;
	clockinEmployeeName: string;
	clockinEmployeeEmail: string | null;
	employeeId: string | null;
	userId: string | null;
	employeeName: string | null;
	mappingType: ClockinImportUserMapping["mappingType"];
}

export function useClockinImportController(organizationId: string) {
	const { t } = useTranslate();
	const [step, setStep] = useState<ClockinWizardStep>("connect");
	const [token, setToken] = useState("");
	const [preview, setPreview] = useState<ClockinPreview | null>(null);
	const [z8Employees, setZ8Employees] = useState<Z8EmployeeInfo[]>([]);
	const [mappings, setMappings] = useState<ClockinMappingRow[]>([]);
	const [busyAction, setBusyAction] = useState<
		"connect" | "mapping" | "import" | null
	>(null);
	const [reviewBatchId, setReviewBatchId] = useState<string | null>(null);
	const [selections, setSelections] = useState<ClockinImportSelections>({
		workdays: true,
		absences: true,
		schedules: false,
		dateRange: {
			startDate: new Date(new Date().getFullYear(), 0, 1)
				.toISOString()
				.slice(0, 10),
			endDate: new Date().toISOString().slice(0, 10),
		},
	});

	const handleConnect = async () => {
		setBusyAction("connect");
		try {
			const result = await validateClockinCredentials(token, organizationId);
			if (!result.success) {
				toast.error(result.error);
				setBusyAction(null);
				return;
			}
			setPreview(result.data);
			setStep("preview");
		} catch (error) {
			setBusyAction(null);
			throw error;
		}
		setBusyAction(null);
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
				setBusyAction(null);
				return;
			}
			if (!z8Result.success) {
				toast.error(z8Result.error);
				setBusyAction(null);
				return;
			}
			setZ8Employees(z8Result.data);
			const employeesByEmail = new Map(
				z8Result.data.map((employee) => [
					employee.email.toLowerCase(),
					employee,
				]),
			);
			setMappings(
				clockinResult.data.map((entry: ClockinEmployeeInfo) => {
					const match = entry.email
						? employeesByEmail.get(entry.email.toLowerCase())
						: null;
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
		} catch (error) {
			setBusyAction(null);
			throw error;
		}
		setBusyAction(null);
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
			const result = await startImportReviewScan({
				organizationId,
				provider: "clockin",
				credential: token,
				selectedScope: selections,
				dateRange: selections.dateRange,
				employeeIds: employeeMappings.map((entry) => entry.providerEmployeeId),
				employeeMappings,
				entityTypes,
			});
			if (!result.success) {
				toast.error(result.error);
				setStep("selection");
				setBusyAction(null);
				return;
			}
			setReviewBatchId(result.data.batchId);
			toast.success(
				t(
					"settings.clockinImport.review.startSuccess",
					"Import review scan started. Review is required before records are committed.",
				),
			);
			setStep("review");
		} catch (error) {
			setBusyAction(null);
			throw error;
		}
		setBusyAction(null);
	};

	const updateMapping = (clockinEmployeeId: number, employeeId: string) => {
		const employee =
			z8Employees.find((entry) => entry.id === employeeId) ?? null;
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

	return {
		busyAction,
		handleConnect,
		handleImport,
		handleLoadMappings,
		mappedCount: mappings.filter((entry) => entry.employeeId != null).length,
		mappings,
		preview,
		reviewBatchId,
		selections,
		setSelections,
		setStep,
		setToken,
		step,
		token,
		updateMapping,
		z8Employees,
	};
}

export type ClockinImportController = ReturnType<
	typeof useClockinImportController
>;
