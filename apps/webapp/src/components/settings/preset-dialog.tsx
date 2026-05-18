"use client";

import { IconCalendar, IconLoader2, IconMapPin, IconTrash } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useEffect } from "react";
import { toast } from "sonner";
import {
	deleteHolidayFromPreset,
	getHolidayPreset,
	updateHolidayPreset,
} from "@/app/[locale]/(app)/settings/holidays/preset-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	ActionPanel,
	ActionPanelBody,
	ActionPanelContent,
	ActionPanelDescription,
	ActionPanelFooter,
	ActionPanelHeader,
	ActionPanelTitle,
} from "@/components/ui/action-panel";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { queryKeys } from "@/lib/query";

const holidayDateFormatter = new Intl.DateTimeFormat(undefined, {
	month: "long",
	day: "numeric",
	timeZone: "UTC",
});

interface PresetDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	organizationId: string;
	presetId: string | null;
	onSuccess: () => void;
}

interface PresetHoliday {
	id: string;
	name: string;
	description: string | null;
	month: number;
	day: number;
	durationDays: number;
	holidayType: string | null;
	isFloating: boolean;
	isActive: boolean;
	category: {
		id: string;
		name: string;
		color: string | null;
	} | null;
}

interface PresetDetails {
	preset: {
		name: string;
		description: string | null;
		countryCode: string | null;
		stateCode: string | null;
		regionCode: string | null;
		year: number | null;
		color: string | null;
		isActive: boolean;
	};
	holidays: PresetHoliday[];
}

export function PresetDialog({
	open,
	onOpenChange,
	organizationId,
	presetId,
	onSuccess,
}: PresetDialogProps) {
	const { t } = useTranslate();
	const queryClient = useQueryClient();

	const form = useForm({
		defaultValues: {
			name: "",
			description: "",
			countryCode: "",
			stateCode: "",
			regionCode: "",
			year: null as number | null,
			color: "",
			isActive: true,
		},
		onSubmit: async ({ value }) => {
			updateMutation.mutate(value);
		},
	});

	// Fetch preset details
	const { data, isLoading } = useQuery({
		queryKey: queryKeys.holidayPresets.detail(presetId || ""),
		queryFn: async () => {
			if (!presetId) return null;
			const result = await getHolidayPreset(presetId);
			if (!result.success) {
				throw new Error(result.error || "Failed to fetch preset");
			}
			return result.data as PresetDetails;
		},
		enabled: !!presetId && open,
	});

	// Update form when data loads
	useEffect(() => {
		if (data?.preset) {
			form.setFieldValue("name", data.preset.name);
			form.setFieldValue("description", data.preset.description || "");
			form.setFieldValue("countryCode", data.preset.countryCode || "");
			form.setFieldValue("stateCode", data.preset.stateCode || "");
			form.setFieldValue("regionCode", data.preset.regionCode || "");
			form.setFieldValue("year", data.preset.year);
			form.setFieldValue("color", data.preset.color || "");
			form.setFieldValue("isActive", data.preset.isActive);
		}
	}, [data, form]);

	// Update mutation
	const updateMutation = useMutation({
		mutationFn: (values: {
			name: string;
			description: string;
			countryCode: string;
			stateCode: string;
			regionCode: string;
			year: number | null;
			color: string;
			isActive: boolean;
		}) => updateHolidayPreset(presetId!, values),
		onSuccess: (result) => {
			if (result.success) {
				toast.success(t("settings.holidays.presets.updated", "Preset updated successfully"));
				queryClient.invalidateQueries({ queryKey: queryKeys.holidayPresets.list(organizationId) });
				queryClient.invalidateQueries({ queryKey: queryKeys.holidayPresets.detail(presetId!) });
				onSuccess();
				onOpenChange(false);
			} else {
				toast.error(
					result.error || t("settings.holidays.presets.updateFailed", "Failed to update preset"),
				);
			}
		},
		onError: () => {
			toast.error(t("settings.holidays.presets.updateFailed", "Failed to update preset"));
		},
	});

	// Delete holiday mutation
	const deleteHolidayMutation = useMutation({
		mutationFn: (holidayId: string) => deleteHolidayFromPreset(holidayId),
		onSuccess: (result) => {
			if (result.success) {
				toast.success(t("settings.holidays.presets.holidayDeleted", "Holiday removed"));
				queryClient.invalidateQueries({ queryKey: queryKeys.holidayPresets.detail(presetId!) });
			} else {
				toast.error(
					result.error ||
						t("settings.holidays.presets.holidayDeleteFailed", "Failed to remove holiday"),
				);
			}
		},
	});

	const formatDate = (month: number, day: number) => {
		return holidayDateFormatter.format(new Date(Date.UTC(2000, month - 1, day)));
	};

	const formatLocation = () => {
		if (!data?.preset) return null;
		const parts = [data.preset.countryCode, data.preset.stateCode, data.preset.regionCode].filter(
			Boolean,
		);
		return parts.length > 0 ? parts.join(" - ") : null;
	};

	return (
		<ActionPanel open={open} onOpenChange={onOpenChange}>
			<ActionPanelContent size="wide">
				<ActionPanelHeader>
					<ActionPanelTitle>{t("settings.holidays.presets.editTitle", "Edit Preset")}</ActionPanelTitle>
					<ActionPanelDescription>
						{t(
							"settings.holidays.presets.editDescription",
							"Update preset details and manage holidays",
						)}
					</ActionPanelDescription>
				</ActionPanelHeader>

				{isLoading ? (
					<ActionPanelBody className="space-y-4">
						<Skeleton className="h-10 w-full" />
						<Skeleton className="h-20 w-full" />
						<Skeleton className="h-40 w-full" />
					</ActionPanelBody>
				) : (
					<>
						<ActionPanelBody className="space-y-4">
						<form
							onSubmit={(e) => {
								e.preventDefault();
								form.handleSubmit();
							}}
							className="space-y-4"
						>
							{/* Preset Info */}
							<div className="grid grid-cols-2 gap-4">
								<form.Field
									name="name"
									validators={{
										onChange: ({ value }) => {
											if (!value) return "Name is required";
											if (value.length > 255) return "Name is too long";
											return undefined;
										},
									}}
								>
									{(field) => (
										<div className="space-y-2">
											<Label>{t("settings.holidays.presets.name", "Name")}</Label>
											<Input
												value={field.state.value}
												onChange={(e) => field.handleChange(e.target.value)}
												onBlur={field.handleBlur}
												placeholder="e.g., Germany - Bavaria"
											/>
											{field.state.meta.errors.length > 0 && (
												<p className="text-sm text-destructive">{field.state.meta.errors[0]}</p>
											)}
										</div>
									)}
								</form.Field>
								<form.Field name="color">
									{(field) => (
										<div className="space-y-2">
											<Label>{t("settings.holidays.presets.color", "Color")}</Label>
											<div className="flex gap-2">
												<Input
													type="color"
													value={field.state.value || "#3B82F6"}
													onChange={(e) => field.handleChange(e.target.value)}
													className="w-12 h-10 p-1 cursor-pointer"
												/>
												<Input
													value={field.state.value}
													onChange={(e) => field.handleChange(e.target.value)}
													placeholder="#EF4444"
													className="flex-1"
												/>
											</div>
										</div>
									)}
								</form.Field>
							</div>

							<form.Field name="description">
								{(field) => (
									<div className="space-y-2">
										<Label>
											{t("settings.holidays.presets.description", "Description")} (
											{t("common.optional", "optional")})
										</Label>
										<Textarea
											value={field.state.value}
											onChange={(e) => field.handleChange(e.target.value)}
											onBlur={field.handleBlur}
											rows={2}
										/>
									</div>
								)}
							</form.Field>

							{/* Location Info (read-only) */}
							{formatLocation() && (
								<div className="flex items-center gap-2 text-sm text-muted-foreground bg-muted/50 rounded-md px-3 py-2">
									<IconMapPin className="size-4" />
									<span>{formatLocation()}</span>
								</div>
							)}

							{data?.preset?.year && (
								<div className="flex items-center gap-2 text-sm text-muted-foreground bg-muted/50 rounded-md px-3 py-2">
									<IconCalendar className="size-4" />
									<span>
										{t("settings.holidays.presets.year", "Year")}: {data.preset.year}
									</span>
								</div>
							)}

							<form.Field name="isActive">
								{(field) => (
									<div className="flex items-center justify-between rounded-lg border p-3">
										<div className="space-y-0.5">
											<Label>{t("settings.holidays.presets.active", "Active")}</Label>
											<p className="text-sm text-muted-foreground">
												{t(
													"settings.holidays.presets.activeDescription",
													"Inactive presets won't apply to employees",
												)}
											</p>
										</div>
										<Switch checked={field.state.value} onCheckedChange={field.handleChange} />
									</div>
								)}
							</form.Field>
						</form>

						{/* Holidays List */}
						<div className="border-t pt-4">
							<div className="flex items-center justify-between mb-3">
								<h4 className="text-sm font-medium flex items-center gap-2">
									<IconCalendar className="size-4" />
									{t("settings.holidays.presets.holidaysList", "Holidays")}
									<Badge variant="secondary">{data?.holidays?.length || 0}</Badge>
								</h4>
							</div>

							<ScrollArea className="h-[200px] rounded-md border">
								{data?.holidays && data.holidays.length > 0 ? (
									<Table>
										<TableHeader>
											<TableRow>
												<TableHead>{t("common.name", "Name")}</TableHead>
												<TableHead>{t("settings.holidays.presets.date", "Date")}</TableHead>
												<TableHead>{t("settings.holidays.presets.type", "Type")}</TableHead>
												<TableHead className="w-[50px]" />
											</TableRow>
										</TableHeader>
										<TableBody>
											{data.holidays.map((holiday) => (
												<TableRow key={holiday.id}>
													<TableCell className="font-medium">{holiday.name}</TableCell>
													<TableCell>
														{formatDate(holiday.month, holiday.day)}
														{holiday.durationDays > 1 && (
															<span className="text-muted-foreground ml-1">
																(+{holiday.durationDays - 1}d)
															</span>
														)}
													</TableCell>
													<TableCell>
														{holiday.category ? (
															<Badge
																variant="outline"
																style={{
																	borderColor: holiday.category.color || undefined,
																	color: holiday.category.color || undefined,
																}}
															>
																{holiday.category.name}
															</Badge>
														) : (
															<span className="text-muted-foreground">
																{holiday.holidayType || "-"}
															</span>
														)}
													</TableCell>
													<TableCell>
														<Button
															variant="ghost"
															size="icon"
															className="size-8 text-muted-foreground hover:text-destructive"
															onClick={() => deleteHolidayMutation.mutate(holiday.id)}
															disabled={deleteHolidayMutation.isPending}
															aria-label={t(
																"settings.holidays.presets.removeHoliday",
																'Remove holiday "{holiday}" from preset',
																{ holiday: holiday.name },
															)}
														>
															<IconTrash className="size-4" />
														</Button>
													</TableCell>
												</TableRow>
											))}
										</TableBody>
									</Table>
								) : (
									<div className="flex items-center justify-center h-full text-muted-foreground">
										{t("settings.holidays.presets.noHolidays", "No holidays in this preset")}
									</div>
								)}
							</ScrollArea>
						</div>
						</ActionPanelBody>

						<ActionPanelFooter>
							<Button
								type="button"
								variant="outline"
								onClick={() => onOpenChange(false)}
								disabled={updateMutation.isPending}
							>
								{t("common.cancel", "Cancel")}
							</Button>
							<Button
								type="submit"
								onClick={() => form.handleSubmit()}
								disabled={updateMutation.isPending}
							>
								{updateMutation.isPending && <IconLoader2 className="mr-2 size-4 animate-spin" />}
								{t("common.save", "Save")}
							</Button>
						</ActionPanelFooter>
					</>
				)}
			</ActionPanelContent>
		</ActionPanel>
	);
}
