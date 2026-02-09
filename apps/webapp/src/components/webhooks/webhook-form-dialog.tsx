"use client";

import { IconCopy, IconInfoCircle, IconLoader2 } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import {
	createWebhook,
	getAvailableEventTypes,
	updateWebhook,
} from "@/app/[locale]/(app)/settings/webhooks/actions";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { NotificationType } from "@/lib/notifications/types";
import type { WebhookEndpoint } from "@/lib/webhooks/types";
import { useRouter } from "@/navigation";
import { WebhookSecretDialog } from "./webhook-secret-dialog";

interface WebhookFormDialogProps {
	organizationId: string;
	webhook?: WebhookEndpoint;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onSuccess: (webhook: WebhookEndpoint) => void;
}

// Group events by category for better UX
const EVENT_CATEGORIES = {
	absences: {
		label: "Absences",
		events: ["absence_request_submitted", "absence_request_approved", "absence_request_rejected"],
	},
	approvals: {
		label: "Approvals",
		events: [
			"approval_request_submitted",
			"approval_request_approved",
			"approval_request_rejected",
		],
	},
	timeTracking: {
		label: "Time Tracking",
		events: ["time_correction_submitted", "time_correction_approved", "time_correction_rejected"],
	},
	shifts: {
		label: "Shifts",
		events: [
			"schedule_published",
			"shift_assigned",
			"shift_swap_requested",
			"shift_swap_approved",
			"shift_swap_rejected",
			"shift_pickup_available",
			"shift_pickup_approved",
		],
	},
	projects: {
		label: "Projects",
		events: [
			"project_budget_warning_70",
			"project_budget_warning_90",
			"project_budget_warning_100",
			"project_deadline_warning_14d",
			"project_deadline_warning_7d",
			"project_deadline_warning_1d",
			"project_deadline_warning_0d",
			"project_deadline_overdue",
		],
	},
	teams: {
		label: "Teams",
		events: ["team_member_added", "team_member_removed"],
	},
	security: {
		label: "Security",
		events: ["password_changed", "two_factor_enabled", "two_factor_disabled"],
	},
	reminders: {
		label: "Reminders",
		events: ["birthday_reminder", "vacation_balance_alert", "water_reminder"],
	},
} as const;

export function WebhookFormDialog({
	organizationId,
	webhook,
	open,
	onOpenChange,
	onSuccess,
}: WebhookFormDialogProps) {
	const { t } = useTranslate();
	const router = useRouter();
	const [isPending, startTransition] = useTransition();

	const isEditing = !!webhook;

	// Form state
	const [name, setName] = useState(webhook?.name ?? "");
	const [url, setUrl] = useState(webhook?.url ?? "");
	const [description, setDescription] = useState(webhook?.description ?? "");
	const [selectedEvents, setSelectedEvents] = useState<Set<string>>(
		new Set((webhook?.subscribedEvents as string[]) ?? []),
	);
	const [expandedCategories, setExpandedCategories] = useState<Set<string>>(
		new Set(Object.keys(EVENT_CATEGORIES)),
	);

	// Secret dialog state (for new webhooks)
	const [newSecret, setNewSecret] = useState<string | null>(null);
	const [isSecretDialogOpen, setIsSecretDialogOpen] = useState(false);

	const handleEventToggle = (event: string) => {
		setSelectedEvents((prev) => {
			const next = new Set(prev);
			if (next.has(event)) {
				next.delete(event);
			} else {
				next.add(event);
			}
			return next;
		});
	};

	const handleCategoryToggle = (categoryKey: string) => {
		const category = EVENT_CATEGORIES[categoryKey as keyof typeof EVENT_CATEGORIES];
		const allSelected = category.events.every((e) => selectedEvents.has(e));

		setSelectedEvents((prev) => {
			const next = new Set(prev);
			for (const event of category.events) {
				if (allSelected) {
					next.delete(event);
				} else {
					next.add(event);
				}
			}
			return next;
		});
	};

	const handleSelectAll = () => {
		const allEvents = Object.values(EVENT_CATEGORIES).flatMap((c) => c.events);
		const allSelected = allEvents.every((e) => selectedEvents.has(e));

		if (allSelected) {
			setSelectedEvents(new Set());
		} else {
			setSelectedEvents(new Set(allEvents));
		}
	};

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();

		if (!name.trim()) {
			toast.error(t("webhooks.form.name-required", "Name is required"));
			return;
		}

		if (!url.trim()) {
			toast.error(t("webhooks.form.url-required", "URL is required"));
			return;
		}

		if (selectedEvents.size === 0) {
			toast.error(t("webhooks.form.events-required", "At least one event must be selected"));
			return;
		}

		if (isEditing) {
			const result = await updateWebhook(webhook.id, {
				name: name.trim(),
				url: url.trim(),
				description: description.trim() || undefined,
				subscribedEvents: [...selectedEvents],
			});

			if (result.success) {
				onSuccess(result.data.endpoint);
				toast.success(t("webhooks.updated", "Webhook updated"));
				onOpenChange(false);
				startTransition(() => router.refresh());
			} else {
				toast.error(result.error ?? t("webhooks.update-failed", "Failed to update webhook"));
			}
		} else {
			const result = await createWebhook({
				organizationId,
				name: name.trim(),
				url: url.trim(),
				description: description.trim() || undefined,
				subscribedEvents: [...selectedEvents],
			});

			if (result.success) {
				onSuccess(result.data.endpoint);
				setNewSecret(result.data.secret);
				setIsSecretDialogOpen(true);
				onOpenChange(false);
				startTransition(() => router.refresh());
				// Reset form
				setName("");
				setUrl("");
				setDescription("");
				setSelectedEvents(new Set());
			} else {
				toast.error(result.error ?? t("webhooks.create-failed", "Failed to create webhook"));
			}
		}
	};

	const allEventsCount = Object.values(EVENT_CATEGORIES).flatMap((c) => c.events).length;

	return (
		<>
			<Dialog open={open} onOpenChange={onOpenChange}>
				<DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
					<DialogHeader>
						<DialogTitle>
							{isEditing
								? t("webhooks.form.edit-title", "Edit Webhook")
								: t("webhooks.form.create-title", "Create Webhook")}
						</DialogTitle>
						<DialogDescription>
							{isEditing
								? t("webhooks.form.edit-description", "Update the webhook endpoint configuration.")
								: t(
										"webhooks.form.create-description",
										"Configure a new webhook endpoint to receive event notifications.",
									)}
						</DialogDescription>
					</DialogHeader>

					<form onSubmit={handleSubmit} className="space-y-6">
						{/* Basic Info */}
						<div className="space-y-4">
							<div className="space-y-2">
								<Label htmlFor="webhook-name">{t("webhooks.form.name", "Name")}</Label>
								<Input
									id="webhook-name"
									value={name}
									onChange={(e) => setName(e.target.value)}
									placeholder={t("webhooks.form.name-placeholder", "My Webhook")}
									required
								/>
							</div>

							<div className="space-y-2">
								<Label htmlFor="webhook-url">{t("webhooks.form.url", "Endpoint URL")}</Label>
								<Input
									id="webhook-url"
									type="url"
									value={url}
									onChange={(e) => setUrl(e.target.value)}
									placeholder="https://example.com/webhook"
									required
								/>
								<p className="text-xs text-muted-foreground">
									{t(
										"webhooks.form.url-hint",
										"HTTPS is required in production. Events will be sent as POST requests.",
									)}
								</p>
							</div>

							<div className="space-y-2">
								<Label htmlFor="webhook-description">
									{t("webhooks.form.description", "Description")} (
									{t("common.optional", "optional")})
								</Label>
								<Textarea
									id="webhook-description"
									value={description}
									onChange={(e) => setDescription(e.target.value)}
									placeholder={t(
										"webhooks.form.description-placeholder",
										"What is this webhook used for?",
									)}
									rows={2}
								/>
							</div>
						</div>

						{/* Event Selection */}
						<div className="space-y-3">
							<div className="flex items-center justify-between">
								<Label>{t("webhooks.form.events", "Events to receive")}</Label>
								<Button type="button" variant="ghost" size="sm" onClick={handleSelectAll}>
									{selectedEvents.size === allEventsCount
										? t("webhooks.form.deselect-all", "Deselect All")
										: t("webhooks.form.select-all", "Select All")}
								</Button>
							</div>

							<div className="border rounded-lg divide-y">
								{Object.entries(EVENT_CATEGORIES).map(([key, category]) => {
									const categoryEvents = category.events as readonly string[];
									const selectedCount = categoryEvents.filter((e) => selectedEvents.has(e)).length;
									const allSelected = selectedCount === categoryEvents.length;
									const someSelected = selectedCount > 0 && !allSelected;

									return (
										<Collapsible
											key={key}
											open={expandedCategories.has(key)}
											onOpenChange={(open) => {
												setExpandedCategories((prev) => {
													const next = new Set(prev);
													if (open) {
														next.add(key);
													} else {
														next.delete(key);
													}
													return next;
												});
											}}
										>
											<div className="flex items-center gap-3 p-3 hover:bg-muted/50">
												<Checkbox
													checked={allSelected}
													ref={(el) => {
														if (el) {
															(el as HTMLButtonElement & { indeterminate: boolean }).indeterminate =
																someSelected;
														}
													}}
													onCheckedChange={() => handleCategoryToggle(key)}
												/>
												<CollapsibleTrigger className="flex-1 text-left text-sm font-medium">
													{t(`webhooks.categories.${key}`, category.label)}
												</CollapsibleTrigger>
												<span className="text-xs text-muted-foreground">
													{selectedCount}/{categoryEvents.length}
												</span>
											</div>
											<CollapsibleContent>
												<div className="px-6 pb-3 space-y-2">
													{categoryEvents.map((event) => (
														<label key={event} className="flex items-center gap-2 cursor-pointer">
															<Checkbox
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
							</div>

							<p className="text-xs text-muted-foreground flex items-center gap-1">
								<IconInfoCircle className="h-3 w-3" aria-hidden="true" />
								{t("webhooks.form.events-hint", "Selected events: {{count}}", {
									count: selectedEvents.size,
								})}
							</p>
						</div>

						<DialogFooter>
							<Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
								{t("common.cancel", "Cancel")}
							</Button>
							<Button type="submit" disabled={isPending}>
								{isPending && (
									<IconLoader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
								)}
								{isEditing ? t("common.save", "Save") : t("webhooks.form.create", "Create Webhook")}
							</Button>
						</DialogFooter>
					</form>
				</DialogContent>
			</Dialog>

			<WebhookSecretDialog
				secret={newSecret}
				open={isSecretDialogOpen}
				onOpenChange={(open) => {
					setIsSecretDialogOpen(open);
					if (!open) setNewSecret(null);
				}}
			/>
		</>
	);
}
