"use client";

import { IconPlus, IconTrash } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import {
	fieldHasError,
	TFormControl,
	TFormDescription,
	TFormItem,
	TFormLabel,
	TFormMessage,
} from "@/components/ui/tanstack-form";

// Local type definitions (previously from time-regulations/validation)
export interface BreakOptionFormValues {
	splitCount: number | null;
	minimumSplitMinutes: number | null;
	minimumLongestSplitMinutes: number | null;
}

interface BreakRuleEditorProps {
	ruleIndex: number;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	form: any;
	onRemove: () => void;
}

const defaultBreakOption: BreakOptionFormValues = {
	splitCount: 1,
	minimumSplitMinutes: null,
	minimumLongestSplitMinutes: null,
};

export function BreakRuleEditor({ ruleIndex, form, onRemove }: BreakRuleEditorProps) {
	const { t } = useTranslate();

	return (
		<Card>
			<CardHeader className="pb-3">
				<div className="flex items-center justify-between">
					<CardTitle className="text-sm font-medium">
						{t("settings.timeRegulations.breakRule", "Break Rule")} {ruleIndex + 1}
					</CardTitle>
					<Button
						type="button"
						variant="ghost"
						size="icon"
						className="h-8 w-8 text-destructive hover:text-destructive"
						onClick={onRemove}
					>
						<IconTrash className="h-4 w-4" />
					</Button>
				</div>
			</CardHeader>
			<CardContent className="space-y-4">
				{/* Threshold and Required Break */}
				<div className="grid gap-4 sm:grid-cols-2">
					<form.Field name={`breakRules[${ruleIndex}].workingMinutesThreshold`}>
						{(field: any) => (
							<TFormItem>
								<TFormLabel hasError={fieldHasError(field)}>
									{t("settings.timeRegulations.afterWorking", "After working")}
								</TFormLabel>
								<TFormControl hasError={fieldHasError(field)}>
									<div className="flex items-center gap-2">
										<Input
											type="number"
											min="1"
											max="24"
											step="0.5"
											value={field.state.value ? field.state.value / 60 : ""}
											onChange={(e) => {
												const hours = parseFloat(e.target.value);
												field.handleChange(isNaN(hours) ? 60 : Math.round(hours * 60));
											}}
											onBlur={field.handleBlur}
											className="w-20"
										/>
										<span className="text-sm text-muted-foreground">
											{t("settings.timeRegulations.hours", "hours")}
										</span>
									</div>
								</TFormControl>
								<TFormDescription>
									{t(
										"settings.timeRegulations.thresholdDescription",
										"Trigger when working more than this",
									)}
								</TFormDescription>
								<TFormMessage field={field} />
							</TFormItem>
						)}
					</form.Field>

					<form.Field name={`breakRules[${ruleIndex}].requiredBreakMinutes`}>
						{(field: any) => (
							<TFormItem>
								<TFormLabel hasError={fieldHasError(field)}>
									{t("settings.timeRegulations.breakRequired", "Break required")}
								</TFormLabel>
								<TFormControl hasError={fieldHasError(field)}>
									<div className="flex items-center gap-2">
										<Input
											type="number"
											min="5"
											max="120"
											value={field.state.value || ""}
											onChange={(e) => {
												const mins = parseInt(e.target.value);
												field.handleChange(isNaN(mins) ? 5 : mins);
											}}
											onBlur={field.handleBlur}
											className="w-20"
										/>
										<span className="text-sm text-muted-foreground">
											{t("settings.timeRegulations.minutes", "minutes")}
										</span>
									</div>
								</TFormControl>
								<TFormDescription>
									{t("settings.timeRegulations.requiredDescription", "Total break time needed")}
								</TFormDescription>
								<TFormMessage field={field} />
							</TFormItem>
						)}
					</form.Field>
				</div>

				{/* Break Options */}
				<div className="space-y-3">
					<div className="flex items-center justify-between">
						<Label className="text-sm">
							{t("settings.timeRegulations.breakOptions", "Break Options")}
						</Label>
						<form.Field name={`breakRules[${ruleIndex}].options`}>
							{(field: any) => (
								<Button
									type="button"
									variant="ghost"
									size="sm"
									onClick={() => {
										field.pushValue({ ...defaultBreakOption });
									}}
								>
									<IconPlus className="mr-1 h-3 w-3" />
									{t("settings.timeRegulations.addOption", "Add Option")}
								</Button>
							)}
						</form.Field>
					</div>

					<form.Field name={`breakRules[${ruleIndex}].options`} mode="array">
						{(optionsField: any) => (
							<div className="space-y-2">
								{optionsField.state.value.length === 0 ? (
									<p className="text-sm text-muted-foreground text-center py-4 border rounded-lg border-dashed">
										{t(
											"settings.timeRegulations.atLeastOneOption",
											"At least one break option is required",
										)}
									</p>
								) : (
									optionsField.state.value.map((option: any, optionIndex: number) => (
										<div
											key={optionIndex}
											className="flex items-center gap-3 p-3 rounded-lg border bg-muted/30"
										>
											<form.Field
												name={`breakRules[${ruleIndex}].options[${optionIndex}].splitCount`}
											>
												{(field: any) => (
													<div className="flex-1">
														<Select
															value={field.state.value?.toString() ?? "null"}
															onValueChange={(val) => {
																field.handleChange(val === "null" ? null : parseInt(val));
															}}
														>
															<SelectTrigger className="w-full">
																<SelectValue />
															</SelectTrigger>
															<SelectContent>
																<SelectItem value="1">
																	{t("settings.timeRegulations.noSplit", "Take at once")}
																</SelectItem>
																<SelectItem value="2">
																	{t("settings.timeRegulations.splitTwo", "Split into 2 parts")}
																</SelectItem>
																<SelectItem value="3">
																	{t("settings.timeRegulations.splitThree", "Split into 3 parts")}
																</SelectItem>
																<SelectItem value="null">
																	{t("settings.timeRegulations.splitAny", "Any number of splits")}
																</SelectItem>
															</SelectContent>
														</Select>
													</div>
												)}
											</form.Field>

											{/* Minimum per split - only show when splitCount > 1 */}
											{option.splitCount !== null && option.splitCount > 1 && (
												<form.Field
													name={`breakRules[${ruleIndex}].options[${optionIndex}].minimumSplitMinutes`}
												>
													{(field: any) => (
														<div className="flex items-center gap-2">
															<span className="text-xs text-muted-foreground whitespace-nowrap">
																{t("settings.timeRegulations.minPerSplit", "min each")}:
															</span>
															<Input
																type="number"
																min="1"
																max="60"
																value={field.state.value || ""}
																onChange={(e) => {
																	const mins = parseInt(e.target.value);
																	field.handleChange(isNaN(mins) ? null : mins);
																}}
																className="w-16"
															/>
															<span className="text-xs text-muted-foreground">
																{t("settings.timeRegulations.minUnit", "min")}
															</span>
														</div>
													)}
												</form.Field>
											)}

											{/* Minimum longest split - only show when splitCount is null (any) */}
											{option.splitCount === null && (
												<form.Field
													name={`breakRules[${ruleIndex}].options[${optionIndex}].minimumLongestSplitMinutes`}
												>
													{(field: any) => (
														<div className="flex items-center gap-2">
															<span className="text-xs text-muted-foreground whitespace-nowrap">
																{t("settings.timeRegulations.longestMin", "longest min")}:
															</span>
															<Input
																type="number"
																min="1"
																max="60"
																value={field.state.value || ""}
																onChange={(e) => {
																	const mins = parseInt(e.target.value);
																	field.handleChange(isNaN(mins) ? null : mins);
																}}
																className="w-16"
															/>
															<span className="text-xs text-muted-foreground">
																{t("settings.timeRegulations.minUnit", "min")}
															</span>
														</div>
													)}
												</form.Field>
											)}

											<Button
												type="button"
												variant="ghost"
												size="icon"
												className="h-8 w-8 text-destructive hover:text-destructive shrink-0"
												onClick={() => optionsField.removeValue(optionIndex)}
												disabled={optionsField.state.value.length <= 1}
											>
												<IconTrash className="h-4 w-4" />
											</Button>
										</div>
									))
								)}
							</div>
						)}
					</form.Field>

					<p className="text-xs text-muted-foreground">
						{t(
							"settings.timeRegulations.optionsDescription",
							"Define how employees can split their break time",
						)}
					</p>
				</div>
			</CardContent>
		</Card>
	);
}
