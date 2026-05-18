"use client";

import { IconLoader2 } from "@tabler/icons-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { DateTime } from "luxon";
import { useState } from "react";
import { toast } from "sonner";
import { updateApiKey } from "@/app/[locale]/(app)/settings/enterprise/api-keys/actions";
import {
	ActionPanel,
	ActionPanelBody,
	ActionPanelContent,
	ActionPanelDescription,
	ActionPanelFooter,
	ActionPanelHeader,
	ActionPanelTitle,
} from "@/components/ui/action-panel";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
	API_KEY_SCOPES,
	type ApiKeyResponse,
	type ApiKeyScope,
	SCOPE_LABELS,
} from "@/lib/validations/api-key";

interface ApiKeyEditDialogProps {
	organizationId: string;
	apiKey: ApiKeyResponse | null;
	open: boolean;
	onOpenChange: (open: boolean) => void;
}

export function ApiKeyEditDialog({
	organizationId,
	apiKey,
	open,
	onOpenChange,
}: ApiKeyEditDialogProps) {
	const { t } = useTranslate();
	const queryClient = useQueryClient();

	// Form state
	const [name, setName] = useState(() => apiKey?.name ?? "");
	const [enabled, setEnabled] = useState(() => apiKey?.enabled ?? true);
	const [selectedScopes, setSelectedScopes] = useState<ApiKeyScope[]>(() => apiKey?.scopes ?? []);
	const [rateLimitEnabled, setRateLimitEnabled] = useState(() => apiKey?.rateLimitEnabled ?? true);
	const [rateLimitMax, setRateLimitMax] = useState(() => String(apiKey?.rateLimitMax || 100));

	const handleOpenChange = (nextOpen: boolean) => {
		if (!nextOpen && apiKey) {
			setName(apiKey.name);
			setEnabled(apiKey.enabled);
			setSelectedScopes(apiKey.scopes);
			setRateLimitEnabled(apiKey.rateLimitEnabled ?? true);
			setRateLimitMax(String(apiKey.rateLimitMax || 100));
		}
		onOpenChange(nextOpen);
	};

	const handleScopeToggle = (scope: ApiKeyScope) => {
		setSelectedScopes((prev) =>
			prev.includes(scope) ? prev.filter((s) => s !== scope) : [...prev, scope],
		);
	};

	// Update mutation
	const updateMutation = useMutation({
		mutationFn: async () => {
			if (!apiKey) throw new Error("No API key selected");

			const result = await updateApiKey(organizationId, apiKey.id, {
				name,
				enabled,
				scopes: selectedScopes,
				rateLimitEnabled,
				rateLimitMax: parseInt(rateLimitMax, 10),
			});
			if (!result.success) throw new Error(result.error || "Failed to update API key");
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["apiKeys", organizationId] });
			toast.success(t("settings.apiKeys.updated", "API key updated"));
			onOpenChange(false);
		},
		onError: (error) => {
			toast.error(error.message);
		},
	});

	const isValid = name.length >= 3 && selectedScopes.length > 0;

	if (!apiKey) return null;

	return (
		<ActionPanel open={open} onOpenChange={handleOpenChange}>
			<ActionPanelContent>
				<ActionPanelHeader>
					<ActionPanelTitle>{t("settings.apiKeys.editTitle", "Edit API Key")}</ActionPanelTitle>
					<ActionPanelDescription>
						{t(
							"settings.apiKeys.editDescription",
							"Update the settings for this API key. Note: You cannot view or change the key itself.",
						)}
					</ActionPanelDescription>
				</ActionPanelHeader>

				<ActionPanelBody className="space-y-4">
					{/* Key Identifier */}
					<div className="flex items-center gap-3 p-3 bg-muted rounded-md">
						<code className="font-mono text-sm">{apiKey.prefix || "z8_org_***"}</code>
						<span className="text-muted-foreground text-sm">
							{t("settings.apiKeys.editCreated", "Created {date}", {
								date: DateTime.fromISO(apiKey.createdAt).toLocaleString(DateTime.DATE_SHORT),
							})}
						</span>
					</div>

					{/* Name */}
					<div className="space-y-2">
						<Label htmlFor="edit-name">{t("settings.apiKeys.form.name", "Name")} *</Label>
						<Input
							id="edit-name"
							name="apiKeyName"
							autoComplete="off"
							value={name}
							onChange={(e) => setName(e.target.value)}
							maxLength={100}
						/>
					</div>

					{/* Enabled Toggle */}
					<div className="flex items-center justify-between">
						<div className="space-y-0.5">
							<Label>{t("settings.apiKeys.form.enabled", "Key Enabled")}</Label>
							<p className="text-xs text-muted-foreground">
								{t(
									"settings.apiKeys.form.enabledHelp",
									"Disabled keys will reject all API requests",
								)}
							</p>
						</div>
						<Switch
							id="edit-enabled"
							checked={enabled}
							onCheckedChange={setEnabled}
							aria-label={t("settings.apiKeys.form.enabled", "Key Enabled")}
						/>
					</div>

					{/* Scopes */}
					<div className="space-y-2">
						<Label>{t("settings.apiKeys.form.scopes", "Permissions")} *</Label>
						<div className="grid grid-cols-2 gap-2 p-3 border rounded-md bg-muted/30">
							{API_KEY_SCOPES.map((scope) => (
								<div key={scope} className="flex items-center space-x-2">
									<Checkbox
										id={`edit-${scope}`}
										checked={selectedScopes.includes(scope)}
										onCheckedChange={() => handleScopeToggle(scope)}
									/>
									<Label htmlFor={`edit-${scope}`} className="text-sm font-normal cursor-pointer">
										{t(`settings.apiKeys.scope.${scope}`, SCOPE_LABELS[scope])}
									</Label>
								</div>
							))}
						</div>
						{selectedScopes.length === 0 && (
							<p className="text-xs text-destructive">
								{t("settings.apiKeys.form.scopesRequired", "Select at least one permission")}
							</p>
						)}
					</div>

					{/* Rate Limiting */}
					<div className="space-y-3">
						<div className="flex items-center space-x-2">
							<Checkbox
								id="edit-rateLimitEnabled"
								checked={rateLimitEnabled}
								onCheckedChange={(checked) => setRateLimitEnabled(checked === true)}
							/>
							<Label htmlFor="edit-rateLimitEnabled" className="font-normal cursor-pointer">
								{t("settings.apiKeys.form.rateLimit", "Enable rate limiting")}
							</Label>
						</div>
						{rateLimitEnabled && (
							<div className="ml-6 space-y-2">
								<Label htmlFor="edit-rateLimitMax">
									{t("settings.apiKeys.form.rateLimitMax", "Max requests per minute")}
								</Label>
								<Input
									id="edit-rateLimitMax"
									name="rateLimitMax"
									type="number"
									value={rateLimitMax}
									onChange={(e) => setRateLimitMax(e.target.value)}
									min={10}
									max={10000}
									className="w-32"
								/>
							</div>
						)}
					</div>
				</ActionPanelBody>

				<ActionPanelFooter>
					<Button variant="outline" onClick={() => onOpenChange(false)}>
						{t("common.cancel", "Cancel")}
					</Button>
					<Button
						onClick={() => updateMutation.mutate()}
						disabled={!isValid || updateMutation.isPending}
					>
						{updateMutation.isPending && <IconLoader2 className="mr-2 size-4 animate-spin" />}
						{t("common.save", "Save")}
					</Button>
				</ActionPanelFooter>
			</ActionPanelContent>
		</ActionPanel>
	);
}
