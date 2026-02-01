"use client";

import { IconLoader2, IconPlus, IconTrash } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import {
	deleteMappingAction,
	getAbsenceCategoriesAction,
	getMappingsAction,
	getWorkCategoriesAction,
	saveMappingAction,
	type DatevConfigResult,
} from "@/app/[locale]/(app)/settings/payroll-export/actions";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
	AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import type { WageTypeMapping } from "@/lib/payroll-export/types";

interface WageTypeMappingsProps {
	organizationId: string;
	config: DatevConfigResult | null;
}

type SourceType = "work_category" | "absence_category" | "special";

interface WorkCategory {
	id: string;
	name: string;
	factor: string | null;
}

interface AbsenceCategory {
	id: string;
	name: string;
	type: string | null;
}

export function WageTypeMappings({ organizationId, config }: WageTypeMappingsProps) {
	const { t } = useTranslate();
	const [isPending, startTransition] = useTransition();
	const [mappings, setMappings] = useState<WageTypeMapping[]>([]);
	const [workCategories, setWorkCategories] = useState<WorkCategory[]>([]);
	const [absenceCategories, setAbsenceCategories] = useState<AbsenceCategory[]>([]);
	const [isDialogOpen, setIsDialogOpen] = useState(false);

	// New mapping form state
	const [sourceType, setSourceType] = useState<SourceType>("work_category");
	const [selectedWorkCategory, setSelectedWorkCategory] = useState<string>("");
	const [selectedAbsenceCategory, setSelectedAbsenceCategory] = useState<string>("");
	const [selectedSpecialCategory, setSelectedSpecialCategory] = useState<string>("");
	// Format-specific wage type codes
	const [datevWageTypeCode, setDatevWageTypeCode] = useState<string>("");
	const [datevWageTypeName, setDatevWageTypeName] = useState<string>("");
	const [lexwareWageTypeCode, setLexwareWageTypeCode] = useState<string>("");
	const [lexwareWageTypeName, setLexwareWageTypeName] = useState<string>("");
	const [sageWageTypeCode, setSageWageTypeCode] = useState<string>("");
	const [sageWageTypeName, setSageWageTypeName] = useState<string>("");

	// Memoize loader to avoid dependency warning (async-parallel already applied)
	const loadData = useCallback(async () => {
		startTransition(async () => {
			const [mappingsResult, workCategoriesResult, absenceCategoriesResult] = await Promise.all([
				getMappingsAction(organizationId),
				getWorkCategoriesAction(organizationId),
				getAbsenceCategoriesAction(organizationId),
			]);

			if (mappingsResult.success) {
				setMappings(mappingsResult.data);
			}
			if (workCategoriesResult.success) {
				setWorkCategories(workCategoriesResult.data);
			}
			if (absenceCategoriesResult.success) {
				setAbsenceCategories(absenceCategoriesResult.data);
			}
		});
	}, [organizationId]);

	// Load data on mount
	useEffect(() => {
		if (config) {
			loadData();
		}
	}, [config, loadData]);

	const handleSaveMapping = async () => {
		if (!config) return;

		startTransition(async () => {
			const result = await saveMappingAction({
				organizationId,
				configId: config.id,
				workCategoryId: sourceType === "work_category" ? selectedWorkCategory : null,
				absenceCategoryId: sourceType === "absence_category" ? selectedAbsenceCategory : null,
				specialCategory: sourceType === "special" ? selectedSpecialCategory : null,
				// Format-specific codes
				datevWageTypeCode: datevWageTypeCode || null,
				datevWageTypeName: datevWageTypeName || null,
				lexwareWageTypeCode: lexwareWageTypeCode || null,
				lexwareWageTypeName: lexwareWageTypeName || null,
				sageWageTypeCode: sageWageTypeCode || null,
				sageWageTypeName: sageWageTypeName || null,
			});

			if (result.success) {
				toast.success(t("settings.payrollExport.mappings.saveSuccess", "Mapping saved"));
				setIsDialogOpen(false);
				resetForm();
				loadData();
			} else {
				toast.error(t("settings.payrollExport.mappings.saveError", "Failed to save mapping"), {
					description: result.error,
				});
			}
		});
	};

	const handleDeleteMapping = async (mappingId: string) => {
		startTransition(async () => {
			const result = await deleteMappingAction({
				organizationId,
				mappingId,
			});

			if (result.success) {
				toast.success(t("settings.payrollExport.mappings.deleteSuccess", "Mapping deleted"));
				loadData();
			} else {
				toast.error(
					t("settings.payrollExport.mappings.deleteError", "Failed to delete mapping"),
					{
						description: result.error,
					},
				);
			}
		});
	};

	const resetForm = () => {
		setSourceType("work_category");
		setSelectedWorkCategory("");
		setSelectedAbsenceCategory("");
		setSelectedSpecialCategory("");
		// Reset format-specific codes
		setDatevWageTypeCode("");
		setDatevWageTypeName("");
		setLexwareWageTypeCode("");
		setLexwareWageTypeName("");
		setSageWageTypeCode("");
		setSageWageTypeName("");
	};

	const getDisplayName = (mapping: WageTypeMapping): string => {
		if (mapping.workCategoryName) return mapping.workCategoryName;
		if (mapping.absenceCategoryName) return mapping.absenceCategoryName;
		if (mapping.specialCategory) {
			// Format special category for display
			return mapping.specialCategory
				.split("_")
				.map((w) => w.charAt(0).toUpperCase() + w.slice(1))
				.join(" ");
		}
		return "-";
	};

	const getSourceTypeLabel = (mapping: WageTypeMapping): string => {
		if (mapping.workCategoryId) return t("settings.payrollExport.mappings.type.workCategory", "Work Category");
		if (mapping.absenceCategoryId) return t("settings.payrollExport.mappings.type.absenceCategory", "Absence");
		if (mapping.specialCategory) return t("settings.payrollExport.mappings.type.special", "Special");
		return "-";
	};

	// Memoize to prevent array recreation (rerender-hoist-jsx)
	// Note: Can't fully hoist due to `t()` dependency
	const specialCategories = useMemo(
		() => [
			{ id: "overtime", name: t("settings.payrollExport.specialCategory.overtime", "Overtime") },
			{
				id: "holiday_compensation",
				name: t("settings.payrollExport.specialCategory.holidayCompensation", "Holiday Compensation"),
			},
			{
				id: "overtime_reduction",
				name: t("settings.payrollExport.specialCategory.overtimeReduction", "Overtime Reduction"),
			},
		],
		[t],
	);

	if (!config) {
		return (
			<Card>
				<CardHeader>
					<CardTitle>{t("settings.payrollExport.mappings.title", "Wage Type Mappings")}</CardTitle>
					<CardDescription>
						{t(
							"settings.payrollExport.mappings.configureFirst",
							"Please configure at least one payroll export format (DATEV, Lexware, or Sage) before setting up mappings.",
						)}
					</CardDescription>
				</CardHeader>
			</Card>
		);
	}

	return (
		<Card>
			<CardHeader className="flex flex-row items-center justify-between">
				<div>
					<CardTitle>{t("settings.payrollExport.mappings.title", "Wage Type Mappings")}</CardTitle>
					<CardDescription>
						{t(
							"settings.payrollExport.mappings.description",
							"Map your work categories and absence types to payroll wage type codes",
						)}
					</CardDescription>
				</div>
				<Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
					<DialogTrigger asChild>
						<Button onClick={resetForm} aria-label={t("settings.payrollExport.mappings.addMapping", "Add Mapping")}>
							<IconPlus className="mr-2 h-4 w-4" aria-hidden="true" />
							{t("settings.payrollExport.mappings.addMapping", "Add Mapping")}
						</Button>
					</DialogTrigger>
					<DialogContent>
						<DialogHeader>
							<DialogTitle>
								{t("settings.payrollExport.mappings.addMappingTitle", "Add Wage Type Mapping")}
							</DialogTitle>
							<DialogDescription>
								{t(
									"settings.payrollExport.mappings.addMappingDescription",
									"Map a category to payroll wage type codes for each format",
								)}
							</DialogDescription>
						</DialogHeader>
						<div className="space-y-4 py-4">
							<div className="space-y-2">
								<Label>{t("settings.payrollExport.mappings.sourceType", "Source Type")}</Label>
								<Select
									value={sourceType}
									onValueChange={(v) => setSourceType(v as SourceType)}
								>
									<SelectTrigger>
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value="work_category">
											{t("settings.payrollExport.mappings.type.workCategory", "Work Category")}
										</SelectItem>
										<SelectItem value="absence_category">
											{t("settings.payrollExport.mappings.type.absenceCategory", "Absence Category")}
										</SelectItem>
										<SelectItem value="special">
											{t("settings.payrollExport.mappings.type.special", "Special Category")}
										</SelectItem>
									</SelectContent>
								</Select>
							</div>

							{sourceType === "work_category" && (
								<div className="space-y-2">
									<Label>
										{t("settings.payrollExport.mappings.workCategory", "Work Category")}
									</Label>
									<Select
										value={selectedWorkCategory}
										onValueChange={setSelectedWorkCategory}
									>
										<SelectTrigger>
											<SelectValue
												placeholder={t(
													"settings.payrollExport.mappings.selectWorkCategory",
													"Select work category",
												)}
											/>
										</SelectTrigger>
										<SelectContent>
											{workCategories.map((cat) => (
												<SelectItem key={cat.id} value={cat.id}>
													{cat.name}
												</SelectItem>
											))}
										</SelectContent>
									</Select>
								</div>
							)}

							{sourceType === "absence_category" && (
								<div className="space-y-2">
									<Label>
										{t("settings.payrollExport.mappings.absenceCategory", "Absence Category")}
									</Label>
									<Select
										value={selectedAbsenceCategory}
										onValueChange={setSelectedAbsenceCategory}
									>
										<SelectTrigger>
											<SelectValue
												placeholder={t(
													"settings.payrollExport.mappings.selectAbsenceCategory",
													"Select absence category",
												)}
											/>
										</SelectTrigger>
										<SelectContent>
											{absenceCategories.map((cat) => (
												<SelectItem key={cat.id} value={cat.id}>
													{cat.name}
												</SelectItem>
											))}
										</SelectContent>
									</Select>
								</div>
							)}

							{sourceType === "special" && (
								<div className="space-y-2">
									<Label>
										{t("settings.payrollExport.mappings.specialCategory", "Special Category")}
									</Label>
									<Select
										value={selectedSpecialCategory}
										onValueChange={setSelectedSpecialCategory}
									>
										<SelectTrigger>
											<SelectValue
												placeholder={t(
													"settings.payrollExport.mappings.selectSpecialCategory",
													"Select special category",
												)}
											/>
										</SelectTrigger>
										<SelectContent>
											{specialCategories.map((cat) => (
												<SelectItem key={cat.id} value={cat.id}>
													{cat.name}
												</SelectItem>
											))}
										</SelectContent>
									</Select>
								</div>
							)}

							<Separator />

							<p className="text-sm text-muted-foreground">
								{t(
									"settings.payrollExport.mappings.formatSpecificHint",
									"Configure wage type codes for each payroll format. At least one is required.",
								)}
							</p>

							{/* DATEV Wage Type */}
							<div className="space-y-2 rounded-lg border p-3">
								<div className="flex items-center gap-2">
									<Badge variant="outline" className="font-mono text-xs">DATEV</Badge>
								</div>
								<div className="grid grid-cols-2 gap-2">
									<div className="space-y-1">
										<Label className="text-xs">
											{t("settings.payrollExport.mappings.code", "Code")}
										</Label>
										<Input
											placeholder="1000"
											value={datevWageTypeCode}
											onChange={(e) => setDatevWageTypeCode(e.target.value)}
											autoComplete="off"
										/>
									</div>
									<div className="space-y-1">
										<Label className="text-xs">
											{t("settings.payrollExport.mappings.description", "Description")}
										</Label>
										<Input
											placeholder="Arbeitszeit"
											value={datevWageTypeName}
											onChange={(e) => setDatevWageTypeName(e.target.value)}
											autoComplete="off"
										/>
									</div>
								</div>
							</div>

							{/* Lexware Wage Type */}
							<div className="space-y-2 rounded-lg border p-3">
								<div className="flex items-center gap-2">
									<Badge variant="outline" className="font-mono text-xs">Lexware</Badge>
								</div>
								<div className="grid grid-cols-2 gap-2">
									<div className="space-y-1">
										<Label className="text-xs">
											{t("settings.payrollExport.mappings.code", "Code")}
										</Label>
										<Input
											placeholder="100"
											value={lexwareWageTypeCode}
											onChange={(e) => setLexwareWageTypeCode(e.target.value)}
											autoComplete="off"
										/>
									</div>
									<div className="space-y-1">
										<Label className="text-xs">
											{t("settings.payrollExport.mappings.description", "Description")}
										</Label>
										<Input
											placeholder="Lohn"
											value={lexwareWageTypeName}
											onChange={(e) => setLexwareWageTypeName(e.target.value)}
											autoComplete="off"
										/>
									</div>
								</div>
							</div>

							{/* Sage Wage Type */}
							<div className="space-y-2 rounded-lg border p-3">
								<div className="flex items-center gap-2">
									<Badge variant="outline" className="font-mono text-xs">Sage</Badge>
								</div>
								<div className="grid grid-cols-2 gap-2">
									<div className="space-y-1">
										<Label className="text-xs">
											{t("settings.payrollExport.mappings.code", "Code")}
										</Label>
										<Input
											placeholder="1000"
											value={sageWageTypeCode}
											onChange={(e) => setSageWageTypeCode(e.target.value)}
											autoComplete="off"
										/>
									</div>
									<div className="space-y-1">
										<Label className="text-xs">
											{t("settings.payrollExport.mappings.description", "Description")}
										</Label>
										<Input
											placeholder="Arbeitszeit"
											value={sageWageTypeName}
											onChange={(e) => setSageWageTypeName(e.target.value)}
											autoComplete="off"
										/>
									</div>
								</div>
							</div>
						</div>
						<DialogFooter>
							<Button variant="outline" onClick={() => setIsDialogOpen(false)}>
								{t("common.cancel", "Cancel")}
							</Button>
							<Button
								onClick={handleSaveMapping}
								disabled={
									isPending ||
									// Must have at least one format code
									(!datevWageTypeCode && !lexwareWageTypeCode && !sageWageTypeCode) ||
									(sourceType === "work_category" && !selectedWorkCategory) ||
									(sourceType === "absence_category" && !selectedAbsenceCategory) ||
									(sourceType === "special" && !selectedSpecialCategory)
								}
							>
								{isPending ? (
									<>
										<IconLoader2 className="mr-2 h-4 w-4 animate-spin" />
										{t("common.saving", "Saving…")}
									</>
								) : (
									t("common.save", "Save")
								)}
							</Button>
						</DialogFooter>
					</DialogContent>
				</Dialog>
			</CardHeader>
			<CardContent>
				{isPending && mappings.length === 0 ? (
					<div className="flex items-center justify-center py-8">
						<IconLoader2 className="h-6 w-6 animate-spin text-muted-foreground" />
					</div>
				) : mappings.length === 0 ? (
					<div className="py-8 text-center text-muted-foreground">
						{t("settings.payrollExport.mappings.noMappings", "No mappings configured yet")}
					</div>
				) : (
					<TooltipProvider>
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>
										{t("settings.payrollExport.mappings.table.type", "Type")}
									</TableHead>
									<TableHead>
										{t("settings.payrollExport.mappings.table.category", "Category")}
									</TableHead>
									<TableHead>
										{t("settings.payrollExport.mappings.table.datev", "DATEV")}
									</TableHead>
									<TableHead>
										{t("settings.payrollExport.mappings.table.lexware", "Lexware")}
									</TableHead>
									<TableHead>
										{t("settings.payrollExport.mappings.table.sage", "Sage")}
									</TableHead>
									<TableHead className="w-[100px]" />
								</TableRow>
							</TableHeader>
							<TableBody>
								{mappings.map((mapping) => (
									<TableRow key={mapping.id}>
										<TableCell className="text-muted-foreground">
											{getSourceTypeLabel(mapping)}
										</TableCell>
										<TableCell className="font-medium">{getDisplayName(mapping)}</TableCell>
										<TableCell>
											{mapping.datevWageTypeCode ? (
												<Tooltip>
													<TooltipTrigger asChild>
														<span className="font-mono cursor-help">{mapping.datevWageTypeCode}</span>
													</TooltipTrigger>
													<TooltipContent>
														{mapping.datevWageTypeName || mapping.datevWageTypeCode}
													</TooltipContent>
												</Tooltip>
											) : (
												<span className="text-muted-foreground">-</span>
											)}
										</TableCell>
										<TableCell>
											{mapping.lexwareWageTypeCode ? (
												<Tooltip>
													<TooltipTrigger asChild>
														<span className="font-mono cursor-help">{mapping.lexwareWageTypeCode}</span>
													</TooltipTrigger>
													<TooltipContent>
														{mapping.lexwareWageTypeName || mapping.lexwareWageTypeCode}
													</TooltipContent>
												</Tooltip>
											) : (
												<span className="text-muted-foreground">-</span>
											)}
										</TableCell>
										<TableCell>
											{mapping.sageWageTypeCode ? (
												<Tooltip>
													<TooltipTrigger asChild>
														<span className="font-mono cursor-help">{mapping.sageWageTypeCode}</span>
													</TooltipTrigger>
													<TooltipContent>
														{mapping.sageWageTypeName || mapping.sageWageTypeCode}
													</TooltipContent>
												</Tooltip>
											) : (
												<span className="text-muted-foreground">-</span>
											)}
										</TableCell>
										<TableCell>
										<AlertDialog>
											<AlertDialogTrigger asChild>
												<Button
													variant="ghost"
													size="icon"
													className="text-destructive"
													aria-label={t("settings.payrollExport.mappings.deleteMapping", "Delete mapping")}
												>
													<IconTrash className="h-4 w-4" />
												</Button>
											</AlertDialogTrigger>
											<AlertDialogContent>
												<AlertDialogHeader>
													<AlertDialogTitle>
														{t(
															"settings.payrollExport.mappings.deleteTitle",
															"Delete Mapping",
														)}
													</AlertDialogTitle>
													<AlertDialogDescription>
														{t(
															"settings.payrollExport.mappings.deleteDescription",
															"Are you sure you want to delete this wage type mapping?",
														)}
													</AlertDialogDescription>
												</AlertDialogHeader>
												<AlertDialogFooter>
													<AlertDialogCancel>{t("common.cancel", "Cancel")}</AlertDialogCancel>
													<AlertDialogAction
														onClick={() => handleDeleteMapping(mapping.id)}
														className="bg-destructive text-destructive-foreground"
													>
														{t("common.delete", "Delete")}
													</AlertDialogAction>
												</AlertDialogFooter>
											</AlertDialogContent>
										</AlertDialog>
										</TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>
					</TooltipProvider>
				)}
			</CardContent>
		</Card>
	);
}
