"use client";

import { IconLoader2, IconPlus, IconTrash } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useTranslate } from "@tolgee/react";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";

export type AssignmentRow = {
	id: string;
	label: string;
	detail?: string;
	/** Shown with an "Inactive" badge; the kiosk ignores the assignment while inactive. */
	inactive?: boolean;
};

export type AssignmentOption = { id: string; label: string; detail?: string };

/**
 * The list-with-add card shared by an employee's assigned locations and a
 * location's assigned employees (#858). Data and mutations stay with the caller.
 */
export function AssignmentListCard({
	title,
	description,
	emptyText,
	noOptionsText,
	selectLabel,
	selectPlaceholder,
	rows,
	options,
	isLoading,
	isMutating,
	onAdd,
	onRemove,
}: {
	title: ReactNode;
	description: string;
	emptyText: string;
	noOptionsText: string;
	selectLabel: string;
	selectPlaceholder: string;
	rows: AssignmentRow[];
	options: AssignmentOption[];
	isLoading: boolean;
	isMutating: boolean;
	onAdd: (id: string) => Promise<boolean>;
	onRemove: (row: AssignmentRow) => void;
}) {
	const { t } = useTranslate();
	const form = useForm({
		defaultValues: { selectedId: "" },
		onSubmit: async ({ value, formApi }) => {
			if (!value.selectedId) return;
			if (await onAdd(value.selectedId)) formApi.reset();
		},
	});

	return (
		<Card>
			<CardHeader>
				<CardTitle className="flex items-center gap-2">{title}</CardTitle>
				<CardDescription>{description}</CardDescription>
			</CardHeader>
			<CardContent className="space-y-4">
				{isLoading ? (
					<div className="space-y-2">
						<Skeleton className="h-12 w-full" />
						<Skeleton className="h-10 w-full" />
					</div>
				) : (
					<>
						{rows.length === 0 ? (
							<p className="py-2 text-center text-sm text-muted-foreground">{emptyText}</p>
						) : (
							<ul className="space-y-2">
								{rows.map((row) => (
									<li
										key={row.id}
										className="flex items-center justify-between gap-3 rounded-lg border p-3"
									>
										<div className="min-w-0">
											<div className="flex flex-wrap items-center gap-2">
												<p className="truncate text-sm font-medium">{row.label}</p>
												{row.inactive && (
													<Badge variant="secondary">{t("common.inactive", "Inactive")}</Badge>
												)}
											</div>
											{row.detail && (
												<p className="truncate text-xs text-muted-foreground">{row.detail}</p>
											)}
										</div>
										<Button
											type="button"
											variant="ghost"
											size="icon"
											disabled={isMutating}
											onClick={() => onRemove(row)}
											aria-label={`${t("common.remove", "Remove")}: ${row.label}`}
										>
											<IconTrash className="size-4" aria-hidden="true" />
										</Button>
									</li>
								))}
							</ul>
						)}

						{options.length === 0 ? (
							<p className="text-xs text-muted-foreground">{noOptionsText}</p>
						) : (
							<form
								className="flex flex-col gap-2 sm:flex-row"
								onSubmit={(event) => {
									event.preventDefault();
									form.handleSubmit();
								}}
							>
								<form.Field name="selectedId">
									{(field) => (
										<Select value={field.state.value} onValueChange={field.handleChange}>
											<SelectTrigger className="sm:flex-1" aria-label={selectLabel}>
												<SelectValue placeholder={selectPlaceholder} />
											</SelectTrigger>
											<SelectContent>
												{options.map((option) => (
													<SelectItem key={option.id} value={option.id}>
														<span className="flex flex-col">
															<span>{option.label}</span>
															{option.detail && (
																<span className="text-xs text-muted-foreground">
																	{option.detail}
																</span>
															)}
														</span>
													</SelectItem>
												))}
											</SelectContent>
										</Select>
									)}
								</form.Field>
								<form.Subscribe selector={(state) => state.values.selectedId}>
									{(selectedId) => (
										<Button type="submit" variant="outline" disabled={!selectedId || isMutating}>
											{isMutating ? (
												<IconLoader2 className="mr-2 size-4 animate-spin" aria-hidden="true" />
											) : (
												<IconPlus className="mr-2 size-4" aria-hidden="true" />
											)}
											{t("common.add", "Add")}
										</Button>
									)}
								</form.Subscribe>
							</form>
						)}
					</>
				)}
			</CardContent>
		</Card>
	);
}
