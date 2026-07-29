import { IconInfoCircle } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import {
	TFormControl,
	TFormDescription,
	TFormItem,
	TFormLabel,
	TFormMessage,
} from "@/components/ui/tanstack-form";
import { fieldHasError } from "@/components/ui/tanstack-form-utils";
import { Textarea } from "@/components/ui/textarea";
import { EVENT_CATEGORIES } from "./webhook-event-categories";
import type { WebhookFormController } from "./webhook-form-controller";

export function WebhookBasicFields({
	controller,
}: {
	controller: WebhookFormController;
}) {
	const { form, nameRequiredMessage, t, urlRequiredMessage } = controller;
	return (
		<div className="space-y-4">
			<form.Field
				name="name"
				validators={{
					onChange: ({ value }) =>
						value.trim() ? undefined : nameRequiredMessage,
				}}
			>
				{(field) => (
					<TFormItem>
						<TFormLabel hasError={fieldHasError(field)}>
							{t("webhooks:webhooks.form.name", "Name")}
						</TFormLabel>
						<TFormControl hasError={fieldHasError(field)}>
							<Input
								name="name"
								value={field.state.value}
								onChange={(event) => field.handleChange(event.target.value)}
								onBlur={field.handleBlur}
								placeholder={t(
									"webhooks:webhooks.form.name-placeholder",
									"My Webhook",
								)}
								required
							/>
						</TFormControl>
						<TFormMessage field={field} />
					</TFormItem>
				)}
			</form.Field>
			<form.Field
				name="url"
				validators={{
					onChange: ({ value }) =>
						value.trim() ? undefined : urlRequiredMessage,
				}}
			>
				{(field) => (
					<TFormItem>
						<TFormLabel hasError={fieldHasError(field)}>
							{t("webhooks:webhooks.form.url", "Endpoint URL")}
						</TFormLabel>
						<TFormControl hasError={fieldHasError(field)}>
							<Input
								name="url"
								type="url"
								value={field.state.value}
								onChange={(event) => field.handleChange(event.target.value)}
								onBlur={field.handleBlur}
								placeholder="https://example.com/webhook"
								required
							/>
						</TFormControl>
						<TFormDescription className="text-xs">
							{t(
								"webhooks:webhooks.form.url-hint",
								"HTTPS is required in production. Events will be sent as POST requests.",
							)}
						</TFormDescription>
						<TFormMessage field={field} />
					</TFormItem>
				)}
			</form.Field>
			<form.Field name="description">
				{(field) => (
					<TFormItem>
						<TFormLabel hasError={fieldHasError(field)}>
							{t("webhooks:webhooks.form.description", "Description")} (
							{t("common.optional", "optional")})
						</TFormLabel>
						<TFormControl hasError={fieldHasError(field)}>
							<Textarea
								name="description"
								value={field.state.value}
								onChange={(event) => field.handleChange(event.target.value)}
								onBlur={field.handleBlur}
								placeholder={t(
									"webhooks:webhooks.form.description-placeholder",
									"What is this webhook used for?",
								)}
								rows={2}
							/>
						</TFormControl>
						<TFormMessage field={field} />
					</TFormItem>
				)}
			</form.Field>
		</div>
	);
}

export function WebhookEventFields({
	controller,
}: {
	controller: WebhookFormController;
}) {
	const {
		allEvents,
		eventsRequiredMessage,
		expandedCategories,
		form,
		setExpandedCategories,
		t,
	} = controller;
	return (
		<form.Field
			name="selectedEvents"
			validators={{
				onChange: ({ value }) =>
					value.length ? undefined : eventsRequiredMessage,
			}}
		>
			{(field) => {
				const selectedEvents = new Set(field.state.value);
				const handleEventToggle = (event: string) => {
					const next = new Set(selectedEvents);
					if (next.has(event)) next.delete(event);
					else next.add(event);
					field.handleChange([...next]);
				};
				const handleCategoryToggle = (categoryKey: string) => {
					const category =
						EVENT_CATEGORIES[categoryKey as keyof typeof EVENT_CATEGORIES];
					const next = new Set(selectedEvents);
					const allSelected = category.events.every((event) => next.has(event));
					for (const event of category.events) {
						if (allSelected) next.delete(event);
						else next.add(event);
					}
					field.handleChange([...next]);
				};
				const handleSelectAll = () =>
					field.handleChange(
						allEvents.every((event) => selectedEvents.has(event))
							? []
							: allEvents,
					);
				return (
					<TFormItem>
						<div className="flex items-center justify-between">
							<span id="webhook-events-label" className="text-sm font-medium">
								{t("webhooks:webhooks.form.events", "Events to receive")}
							</span>
							<Button
								type="button"
								variant="ghost"
								size="sm"
								onClick={handleSelectAll}
							>
								{selectedEvents.size === allEvents.length
									? t("webhooks:webhooks.form.deselect-all", "Deselect All")
									: t("webhooks:webhooks.form.select-all", "Select All")}
							</Button>
						</div>
						<TFormControl hasError={fieldHasError(field)}>
							<fieldset
								aria-labelledby="webhook-events-label"
								className="border rounded-lg divide-y"
							>
								{Object.entries(EVENT_CATEGORIES).map(([key, category]) => {
									const categoryEvents = category.events as readonly string[];
									const selectedCount = categoryEvents.filter((event) =>
										selectedEvents.has(event),
									).length;
									const allSelected = selectedCount === categoryEvents.length;
									return (
										<Collapsible
											key={key}
											open={expandedCategories.has(key)}
											onOpenChange={(open) =>
												setExpandedCategories((previous) => {
													const next = new Set(previous);
													if (open) next.add(key);
													else next.delete(key);
													return next;
												})
											}
										>
											<div className="flex items-center gap-3 p-3 hover:bg-muted/50">
												<Checkbox
													aria-label={t(
														`webhooks:webhooks.categories.${key}`,
														category.label,
													)}
													checked={allSelected}
													indeterminate={selectedCount > 0 && !allSelected}
													onCheckedChange={() => handleCategoryToggle(key)}
												/>
												<CollapsibleTrigger className="flex-1 text-left text-sm font-medium">
													{t(
														`webhooks:webhooks.categories.${key}`,
														category.label,
													)}
												</CollapsibleTrigger>
												<span className="text-xs text-muted-foreground">
													{selectedCount}/{categoryEvents.length}
												</span>
											</div>
											<CollapsibleContent>
												<div className="px-6 pb-3 space-y-2">
													{categoryEvents.map((event) => (
														<label
															key={event}
															htmlFor={`webhook-event-${event}`}
															className="flex items-center gap-2 cursor-pointer"
														>
															<Checkbox
																id={`webhook-event-${event}`}
																checked={selectedEvents.has(event)}
																onCheckedChange={() => handleEventToggle(event)}
															/>
															<span className="text-sm font-mono">{event}</span>
														</label>
													))}
												</div>
											</CollapsibleContent>
										</Collapsible>
									);
								})}
							</fieldset>
						</TFormControl>
						<TFormDescription className="text-xs flex items-center gap-1">
							<IconInfoCircle className="size-3" aria-hidden="true" />
							{t(
								"webhooks:webhooks.form.events-hint",
								"Selected events: {{count}}",
								{ count: selectedEvents.size },
							)}
						</TFormDescription>
						<TFormMessage field={field} />
					</TFormItem>
				);
			}}
		</form.Field>
	);
}
