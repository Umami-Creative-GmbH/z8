"use client";

import { DatePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { ProjectColorPicker } from "./project-color-picker";
import type { ProjectDialogController } from "./project-dialog";

/**
 * Sections of the project dialog's form (#880, #884, #900, #938), each bound to
 * the dialog's controller.
 */

const NO_CUSTOMER_VALUE = "__none__";
const BLANK_PROJECT_VALUE = "__blank__";

/** The template a new project starts from, or a blank project (#880). */
export function ProjectTemplateChoiceField({
	controller,
}: {
	controller: ProjectDialogController;
}) {
	const { form, t, templateChoices } = controller;
	return (
		<form.Field name="templateId">
			{(field) => (
				<div className="grid gap-2">
					<Label htmlFor="templateId">
						{t("settings.projects.fromTemplate.startFrom", "Start from")}
					</Label>
					<Select
						value={field.state.value || BLANK_PROJECT_VALUE}
						onValueChange={(value) =>
							field.handleChange(value === BLANK_PROJECT_VALUE ? "" : value)
						}
					>
						<SelectTrigger id="templateId">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value={BLANK_PROJECT_VALUE}>
								{t("settings.projects.fromTemplate.blank", "Blank project")}
							</SelectItem>
							{templateChoices.map((template) => (
								<SelectItem key={template.id} value={template.id}>
									{template.name}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>
			)}
		</form.Field>
	);
}

/** The customer; a deleted customer is named but never a choice (#938). */
export function ProjectCustomerField({ controller }: { controller: ProjectDialogController }) {
	const { customers, deletedCustomerName, form, t } = controller;
	return (
		<form.Field name="customerId">
			{(field) => (
				<div className="grid gap-2">
					<Label htmlFor={customers.length > 0 ? "customerId" : undefined}>
						{t("settings.projects.field.customer", "Customer")}
					</Label>
					{customers.length > 0 && (
						<Select
							value={field.state.value || NO_CUSTOMER_VALUE}
							onValueChange={(value) =>
								field.handleChange(value === NO_CUSTOMER_VALUE ? "" : value)
							}
						>
							<SelectTrigger
								id="customerId"
								aria-describedby={
									deletedCustomerName && !field.state.value ? "customerDeletedHint" : undefined
								}
							>
								<SelectValue
									placeholder={t(
										"settings.projects.field.customerPlaceholder",
										"Select a customer",
									)}
								/>
							</SelectTrigger>
							<SelectContent>
								<SelectItem value={NO_CUSTOMER_VALUE}>
									{t("settings.projects.field.noCustomer", "No customer")}
								</SelectItem>
								{customers.map((c) => (
									<SelectItem key={c.id} value={c.id}>
										{c.name}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					)}
					{deletedCustomerName && !field.state.value && (
						<p id="customerDeletedHint" className="text-sm text-muted-foreground">
							{t(
								"settings.projects.field.customerDeleted",
								"{name} was deleted. Pick another customer or keep the project without one.",
								{ name: deletedCustomerName },
							)}
						</p>
					)}
				</div>
			)}
		</form.Field>
	);
}

/** Billable default (#900): only for a project with a customer. */
export function ProjectBillableDefaultField({
	controller,
}: {
	controller: ProjectDialogController;
}) {
	const { form, t } = controller;
	return (
		<form.Subscribe selector={(state) => state.values.customerId}>
			{(customerId) => (
				<form.Field name="billableDefault">
					{(field) => (
						<div className="flex items-center justify-between gap-3 rounded-lg border p-3">
							<div className="space-y-0.5">
								<Label htmlFor="billableDefault">
									{t("settings.projects.field.billableDefault", "Billable by default")}
								</Label>
								<p className="text-sm text-muted-foreground">
									{customerId
										? t(
												"settings.projects.field.billableDefaultHelp",
												"New work on this project starts as billable. Existing work keeps its billability.",
											)
										: t(
												"settings.projects.field.billableDefaultNeedsCustomer",
												"Choose a customer to make new work billable by default.",
											)}
								</p>
							</div>
							<Switch
								id="billableDefault"
								checked={Boolean(customerId) && field.state.value}
								onCheckedChange={(checked) => field.handleChange(checked)}
								disabled={!customerId}
							/>
						</div>
					)}
				</form.Field>
			)}
		</form.Subscribe>
	);
}

/** Task requirement (#884); a project from a template takes the template's. */
export function ProjectRequiresTaskField({ controller }: { controller: ProjectDialogController }) {
	const { form, t } = controller;
	return (
		<form.Field name="requiresTask">
			{(field) => (
				<div className="flex items-center justify-between gap-3 rounded-lg border p-3">
					<div className="space-y-0.5">
						<Label htmlFor="requiresTask">
							{t("settings.projects.field.requiresTask", "Require a task")}
						</Label>
						<p id="requiresTaskHelp" className="text-sm text-muted-foreground">
							{t(
								"settings.projects.field.requiresTaskHelp",
								"Time booked to this project must name one of its tasks. It applies only while the project has an open task.",
							)}
						</p>
					</div>
					<Switch
						id="requiresTask"
						aria-describedby="requiresTaskHelp"
						checked={field.state.value}
						onCheckedChange={(checked) => field.handleChange(checked)}
					/>
				</div>
			)}
		</form.Field>
	);
}

/** Colour, budget and deadline; they come from the template when there is one. */
export function ProjectPlanningFields({ controller }: { controller: ProjectDialogController }) {
	const { form, t } = controller;
	return (
		<>
			{/* Color */}
			<form.Field name="color">
				{(field) => (
					<div className="grid gap-2">
						<Label>{t("settings.projects.field.color", "Color")}</Label>
						<ProjectColorPicker value={field.state.value} onChange={field.handleChange} />
					</div>
				)}
			</form.Field>

			{/* Budget Hours */}
			<form.Field name="budgetHours">
				{(field) => (
					<div className="grid gap-2">
						<Label htmlFor="budgetHours">
							{t("settings.projects.field.budget", "Budget (hours)")}
						</Label>
						<Input
							id="budgetHours"
							type="number"
							step="0.5"
							min="0"
							value={field.state.value}
							onChange={(e) => field.handleChange(e.target.value)}
							onBlur={field.handleBlur}
							placeholder={t("settings.projects.field.budgetPlaceholder", "e.g., 100")}
						/>
						<p className="text-xs text-muted-foreground">
							{t("settings.projects.field.budgetHelp", "Leave empty for unlimited budget")}
						</p>
					</div>
				)}
			</form.Field>

			{/* Deadline */}
			<form.Field name="deadline">
				{(field) => (
					<div className="grid gap-2">
						<Label htmlFor="deadline">{t("settings.projects.field.deadline", "Deadline")}</Label>
						<DatePicker
							id="deadline"
							value={field.state.value}
							onChange={field.handleChange}
							onBlur={field.handleBlur}
						/>
					</div>
				)}
			</form.Field>
		</>
	);
}
