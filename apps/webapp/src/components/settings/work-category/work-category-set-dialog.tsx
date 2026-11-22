"use client";

import { IconChevronDown, IconChevronUp, IconLoader2, IconX } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useEffect, useRef } from "react";
import { toast } from "sonner";
import {
	createWorkCategorySet,
	getOrganizationCategories,
	getWorkCategorySetDetail,
	updateSetCategories,
	updateWorkCategorySet,
} from "@/app/[locale]/(app)/settings/work-categories/actions";
import {
	ActionPanel,
	ActionPanelBody,
	ActionPanelContent,
	ActionPanelDescription,
	ActionPanelFooter,
	ActionPanelHeader,
	ActionPanelTitle,
} from "@/components/ui/action-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ClientForm } from "@/components/ui/client-form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { TFormControl, TFormItem, TFormLabel, TFormMessage } from "@/components/ui/tanstack-form";
import { fieldHasError } from "@/components/ui/tanstack-form-utils";
import { Textarea } from "@/components/ui/textarea";
import {
	actionErrorMessage,
	type RefusalOverrides,
} from "@/lib/organization-action/action-error-message";
import { queryKeys } from "@/lib/query";
import { formatFactorAsMultiplier } from "@/lib/work-category/work-category.service";

/** A set refused because its name is taken. */
const SET_REFUSALS: RefusalOverrides = {
	ConflictError: [
		"settings.workCategories.setNameTaken",
		"A category set with this name already exists.",
	],
};

interface WorkCategorySetDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	organizationId: string;
	categorySet?: {
		id: string;
		name: string;
		description: string | null;
	} | null;
	onSuccess: () => void;
}

interface OrgCategory {
	id: string;
	organizationId: string;
	name: string;
	description: string | null;
	factor: string;
	color: string | null;
	isActive: boolean;
	createdAt: Date;
	usedInSetsCount: number;
}

interface SetCategory {
	id: string;
	name: string;
	description: string | null;
	factor: string;
	color: string | null;
	sortOrder: number;
}

interface WorkCategorySetFormValues {
	name: string;
	description: string;
	categoryIds: string[];
}

export function WorkCategorySetDialog(props: WorkCategorySetDialogProps) {
	const key = `${String(props.open)}:${props.categorySet?.id ?? "new"}`;
	return <WorkCategorySetDialogContent key={key} {...props} />;
}

function WorkCategorySetDialogContent({
	open,
	onOpenChange,
	organizationId,
	categorySet,
	onSuccess,
}: WorkCategorySetDialogProps) {
	const { t } = useTranslate();
	const queryClient = useQueryClient();
	const isEditing = !!categorySet;
	const submittingRef = useRef(false);
	const hydratedDetailRef = useRef(false);

	// Fetch all org-level categories
	const { data: orgCategoriesResult, isLoading: isLoadingOrgCategories } = useQuery({
		queryKey: queryKeys.workCategories.orgList(organizationId),
		queryFn: async () => {
			const result = await getOrganizationCategories();
			if (!result.success) {
				throw new Error(result.error || "Failed to fetch categories");
			}
			return result.data;
		},
		enabled: open,
	});

	// Fetch category set details when editing
	const { data: setDetail, isLoading: isLoadingDetail } = useQuery({
		queryKey: queryKeys.workCategorySets.detail(categorySet?.id || ""),
		queryFn: async () => {
			if (!categorySet?.id) return null;
			const result = await getWorkCategorySetDetail(categorySet.id);
			if (!result.success) {
				throw new Error(result.error || "Failed to fetch category set");
			}
			return result.data as {
				set: typeof categorySet;
				categories: SetCategory[];
			};
		},
		enabled: isEditing && open,
	});

	const createSetMutation = useMutation({
		mutationFn: (data: { name: string; description: string | null; categoryIds: string[] }) =>
			createWorkCategorySet(data),
	});

	const updateSetMutation = useMutation({
		mutationFn: (data: { setId: string; name: string; description: string | null }) =>
			updateWorkCategorySet(data),
	});

	const validateName = (value: string) =>
		value.trim()
			? undefined
			: t("settings.workCategories.setNameRequired", "Category set name is required");

	const form = useForm({
		defaultValues: {
			name: categorySet?.name || "",
			description: categorySet?.description || "",
			categoryIds: [] as string[],
		} satisfies WorkCategorySetFormValues,
		onSubmit: async ({ value }) => {
			if (submittingRef.current) return;
			submittingRef.current = true;

			const run = async () => {
				try {
					if (isEditing && categorySet) {
						const result = await updateSetMutation.mutateAsync({
							setId: categorySet.id,
							name: value.name.trim(),
							description: value.description.trim() || null,
						});
						if (!result.success) {
							toast.error(
								actionErrorMessage(t, result, SET_REFUSALS, [
									"settings.workCategories.setUpdateFailed",
									"Failed to update category set",
								]),
							);
							return;
						}

						const updateResult = await updateSetCategories({
							setId: categorySet.id,
							categoryIds: value.categoryIds,
						});
						if (!updateResult.success) {
							toast.error(
								actionErrorMessage(t, updateResult, {}, [
									"settings.workCategories.setUpdateFailed",
									"Failed to update categories",
								]),
							);
							return;
						}

						toast.success(t("settings.workCategories.setUpdated", "Category set updated"));
						void queryClient.invalidateQueries({
							queryKey: queryKeys.workCategorySets.detail(categorySet.id),
						});
						void queryClient.invalidateQueries({
							queryKey: queryKeys.workCategorySets.list(organizationId),
						});
						onSuccess();
						return;
					}

					const result = await createSetMutation.mutateAsync({
						name: value.name.trim(),
						description: value.description.trim() || null,
						categoryIds: value.categoryIds,
					});
					if (!result.success) {
						toast.error(
							actionErrorMessage(t, result, SET_REFUSALS, [
								"settings.workCategories.setCreateFailed",
								"Failed to create category set",
							]),
						);
						return;
					}

					void queryClient.invalidateQueries({
						queryKey: queryKeys.workCategorySets.list(organizationId),
					});
					toast.success(t("settings.workCategories.setCreated", "Category set created"));
					onSuccess();
				} catch {
					toast.error(
						isEditing
							? t("settings.workCategories.setUpdateFailed", "Failed to update category set")
							: t("settings.workCategories.setCreateFailed", "Failed to create category set"),
					);
				}
			};

			// Promise#finally rather than try/finally: the React Compiler cannot
			// compile try statements without a catch clause.
			await run().finally(() => {
				submittingRef.current = false;
			});
		},
	});

	useEffect(() => {
		if (isEditing && setDetail && !hydratedDetailRef.current) {
			hydratedDetailRef.current = true;
			form.setFieldValue(
				"categoryIds",
				setDetail.categories.map((c) => c.id),
			);
		}
	}, [form, isEditing, setDetail]);

	const orgCategories = orgCategoriesResult || [];
	const isLoading = isLoadingOrgCategories || (isEditing && isLoadingDetail);

	const handleOpenChange = (nextOpen: boolean) => {
		if (!nextOpen && submittingRef.current) return;
		onOpenChange(nextOpen);
	};

	return (
		<ActionPanel open={open} onOpenChange={handleOpenChange}>
			<ActionPanelContent
				size="wide"
				onEscapeKeyDown={(event) => {
					if (submittingRef.current) event.preventDefault();
				}}
				onInteractOutside={(event) => {
					if (submittingRef.current) event.preventDefault();
				}}
			>
				<ActionPanelHeader>
					<ActionPanelTitle>
						{isEditing
							? t("settings.workCategories.editSet", "Edit Category Set")
							: t("settings.workCategories.createSet", "Create Category Set")}
					</ActionPanelTitle>
					<ActionPanelDescription>
						{isEditing
							? t(
									"settings.workCategories.editSetDescription",
									"Update the category set details and manage its categories",
								)
							: t(
									"settings.workCategories.createSetDescription",
									"Create a new category set and select which categories to include",
								)}
					</ActionPanelDescription>
				</ActionPanelHeader>

				<ClientForm
					noValidate
					onSubmit={() => {
						if (submittingRef.current || isLoading) return;
						void form.handleSubmit();
					}}
					className="flex min-h-0 flex-1 flex-col"
				>
					<ActionPanelBody className="space-y-4">
						{/* Set Name */}
						<form.Field
							name="name"
							validators={{
								onSubmit: ({ value }) => validateName(value),
								onChange: ({ value, fieldApi }) =>
									fieldApi.state.meta.errors.length > 0 ? validateName(value) : undefined,
							}}
						>
							{(field) => (
								<TFormItem className="px-1">
									<TFormLabel hasError={fieldHasError(field)} required>
										{t("settings.workCategories.setName", "Name")}
									</TFormLabel>
									<TFormControl hasError={fieldHasError(field)}>
										<Input
											name="name"
											value={field.state.value}
											onChange={(e) => field.handleChange(e.target.value)}
											onBlur={field.handleBlur}
											placeholder={t(
												"settings.workCategories.setNamePlaceholder",
												"e.g., Travel Categories",
											)}
										/>
									</TFormControl>
									<TFormMessage field={field} />
								</TFormItem>
							)}
						</form.Field>

						{/* Set Description */}
						<form.Field name="description">
							{(field) => (
								<TFormItem className="px-1">
									<TFormLabel>
										{t("settings.workCategories.setDescription", "Description")}
									</TFormLabel>
									<TFormControl>
										<Textarea
											name="description"
											value={field.state.value}
											onChange={(e) => field.handleChange(e.target.value)}
											onBlur={field.handleBlur}
											placeholder={t(
												"settings.workCategories.setDescriptionPlaceholder",
												"Optional description for this category set",
											)}
											rows={2}
										/>
									</TFormControl>
								</TFormItem>
							)}
						</form.Field>

						<Separator />

						{/* Categories Section */}
						<form.Field name="categoryIds">
							{(field) => {
								const selectedCategoryIds = field.state.value;
								const selectedCategoryIdSet = new Set(selectedCategoryIds);
								const selectedCategories = selectedCategoryIds
									.map((id) => orgCategories.find((c) => c.id === id))
									.filter((c): c is OrgCategory => c !== undefined);
								const unselectedCategories = orgCategories.filter(
									(c) => !selectedCategoryIdSet.has(c.id),
								);

								const handleToggleCategory = (categoryId: string) => {
									const nextIds = selectedCategoryIds.includes(categoryId)
										? selectedCategoryIds.filter((id) => id !== categoryId)
										: [...selectedCategoryIds, categoryId];
									field.handleChange(nextIds);
								};

								const moveUp = (index: number) => {
									if (index === 0) return;
									const newIds = [...selectedCategoryIds];
									[newIds[index - 1], newIds[index]] = [newIds[index], newIds[index - 1]];
									field.handleChange(newIds);
								};

								const moveDown = (index: number) => {
									if (index === selectedCategoryIds.length - 1) return;
									const newIds = [...selectedCategoryIds];
									[newIds[index], newIds[index + 1]] = [newIds[index + 1], newIds[index]];
									field.handleChange(newIds);
								};

								const removeCategory = (categoryId: string) => {
									field.handleChange(selectedCategoryIds.filter((id) => id !== categoryId));
								};

								return (
									<div className="space-y-4 px-1">
										<div className="flex items-center justify-between">
											<Label>
												{t("settings.workCategories.selectCategories", "Select Categories")}
											</Label>
											<Badge variant="secondary">
												{selectedCategoryIds.length} {t("common.selected", "selected")}
											</Badge>
										</div>

										{isLoading ? (
											<div className="space-y-2">
												{[1, 2, 3].map((i) => (
													<Skeleton key={i} className="h-12 w-full" />
												))}
											</div>
										) : orgCategories.length === 0 ? (
											<div className="py-8 text-center text-muted-foreground">
												<p>
													{t(
														"settings.workCategories.noCategoriesAvailable",
														"No categories available",
													)}
												</p>
												<p className="text-sm">
													{t(
														"settings.workCategories.createCategoriesFirst",
														"Create categories in the Categories tab first",
													)}
												</p>
											</div>
										) : (
											<div className="space-y-4">
												{selectedCategories.length > 0 && (
													<div className="space-y-2">
														<p
															id="work-category-set-order-hint"
															className="text-sm text-muted-foreground"
														>
															{t(
																"settings.workCategories.selectedCategoriesOrder",
																"Selected categories (use the arrows to reorder)",
															)}
														</p>
														<ol
															aria-describedby="work-category-set-order-hint"
															className="space-y-1 rounded-lg border p-2"
														>
															{selectedCategories.map((category, index) => (
																<li
																	key={category.id}
																	className="flex items-center gap-2 rounded-md bg-muted/50 p-1"
																>
																	<div className="flex items-center">
																		<Button
																			type="button"
																			variant="ghost"
																			size="icon"
																			className="size-8"
																			onClick={() => moveUp(index)}
																			disabled={index === 0}
																			aria-label={t(
																				"settings.workCategories.moveCategoryUp",
																				"Move {name} up",
																				{ name: category.name },
																			)}
																		>
																			<IconChevronUp className="size-4" aria-hidden="true" />
																		</Button>
																		<Button
																			type="button"
																			variant="ghost"
																			size="icon"
																			className="size-8"
																			onClick={() => moveDown(index)}
																			disabled={index === selectedCategories.length - 1}
																			aria-label={t(
																				"settings.workCategories.moveCategoryDown",
																				"Move {name} down",
																				{ name: category.name },
																			)}
																		>
																			<IconChevronDown className="size-4" aria-hidden="true" />
																		</Button>
																	</div>
																	{category.color && (
																		<div
																			className="size-4 shrink-0 rounded-full"
																			style={{ backgroundColor: category.color }}
																			aria-hidden="true"
																		/>
																	)}
																	<span className="min-w-0 flex-1 truncate font-medium text-sm">
																		{category.name}
																	</span>
																	<Badge variant="outline" className="text-xs tabular-nums">
																		{formatFactorAsMultiplier(parseFloat(category.factor))}
																	</Badge>
																	<Button
																		type="button"
																		variant="ghost"
																		size="icon"
																		className="size-8"
																		onClick={() => removeCategory(category.id)}
																		aria-label={t(
																			"settings.workCategories.removeCategoryFromSet",
																			"Remove {name} from set",
																			{ name: category.name },
																		)}
																	>
																		<IconX className="size-4" aria-hidden="true" />
																	</Button>
																</li>
															))}
														</ol>
													</div>
												)}

												{unselectedCategories.length > 0 && (
													<div className="space-y-2">
														<p className="text-sm text-muted-foreground">
															{t(
																"settings.workCategories.availableCategories",
																"Available categories",
															)}
														</p>
														<ScrollArea className="h-[200px] rounded-lg border p-2">
															<div className="space-y-1">
																{unselectedCategories.map((category) => (
																	<button
																		key={category.id}
																		type="button"
																		className="flex cursor-pointer items-center gap-2 rounded-md p-2 hover:bg-muted/50 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
																		onClick={() => handleToggleCategory(category.id)}
																	>
																		<Checkbox
																			checked={selectedCategoryIdSet.has(category.id)}
																			onCheckedChange={() => handleToggleCategory(category.id)}
																			tabIndex={-1}
																		/>
																		{category.color && (
																			<div
																				className="size-4 shrink-0 rounded-full"
																				style={{ backgroundColor: category.color }}
																				aria-hidden="true"
																			/>
																		)}
																		<span className="flex-1 text-sm">{category.name}</span>
																		<Badge variant="outline" className="text-xs">
																			{formatFactorAsMultiplier(parseFloat(category.factor))}
																		</Badge>
																	</button>
																))}
															</div>
														</ScrollArea>
													</div>
												)}
											</div>
										)}
									</div>
								);
							}}
						</form.Field>
					</ActionPanelBody>

					<ActionPanelFooter className="border-t pt-4">
						<form.Subscribe selector={(state) => state.isSubmitting}>
							{(isSubmitting) => (
								<>
									<Button
										type="button"
										variant="outline"
										disabled={isSubmitting}
										onClick={() => handleOpenChange(false)}
									>
										{t("common.cancel", "Cancel")}
									</Button>
									<Button type="submit" disabled={isSubmitting || isLoading}>
										{isSubmitting ? (
											<>
												<IconLoader2 className="mr-2 size-4 animate-spin" aria-hidden="true" />
												{t("common.saving", "Saving...")}
											</>
										) : isEditing ? (
											t("common.save", "Save")
										) : (
											t("common.create", "Create")
										)}
									</Button>
								</>
							)}
						</form.Subscribe>
					</ActionPanelFooter>
				</ClientForm>
			</ActionPanelContent>
		</ActionPanel>
	);
}
