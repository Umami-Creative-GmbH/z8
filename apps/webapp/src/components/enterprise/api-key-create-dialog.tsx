"use client";

import { IconLoader2 } from "@tabler/icons-react";
import { useMutation } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { createApiKey } from "@/app/[locale]/(app)/settings/enterprise/api-keys/actions";
import {
	API_KEY_SCOPES,
	EXPIRATION_OPTIONS,
	SCOPE_LABELS,
	type ApiKeyScope,
	type CreateApiKeyResponse,
} from "@/lib/validations/api-key";

interface ApiKeyCreateDialogProps {
	organizationId: string;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onKeyCreated: (key: CreateApiKeyResponse) => void;
}

export function ApiKeyCreateDialog({
	organizationId,
	open,
	onOpenChange,
	onKeyCreated,
}: ApiKeyCreateDialogProps) {
	const { t } = useTranslate();

	// Form state
	const [name, setName] = useState("");
	const [expiresIn, setExpiresIn] = useState("30");
	const [selectedScopes, setSelectedScopes] = useState<ApiKeyScope[]>(["time-entries:read"]);
	const [rateLimitEnabled, setRateLimitEnabled] = useState(true);
	const [rateLimitMax, setRateLimitMax] = useState("100");

	// Reset form when dialog opens
	const handleOpenChange = (isOpen: boolean) => {
		if (isOpen) {
			setName("");
			setExpiresIn("30");
			setSelectedScopes(["time-entries:read"]);
			setRateLimitEnabled(true);
			setRateLimitMax("100");
		}
		onOpenChange(isOpen);
	};

	const handleScopeToggle = (scope: ApiKeyScope) => {
		setSelectedScopes((prev) =>
			prev.includes(scope) ? prev.filter((s) => s !== scope) : [...prev, scope],
		);
	};

	// Create mutation
	const createMutation = useMutation({
		mutationFn: async () => {
			const result = await createApiKey(organizationId, {
				name,
				expiresInDays: expiresIn === "never" ? null : parseInt(expiresIn, 10),
				scopes: selectedScopes,
				rateLimitEnabled,
				rateLimitMax: parseInt(rateLimitMax, 10),
				rateLimitTimeWindow: 60000, // 1 minute
			});
			if (!result.success) throw new Error(result.error || "Failed to create API key");
			return result.data;
		},
		onSuccess: (data) => {
			toast.success(t("settings.apiKeys.created", "API key created successfully"));
			onKeyCreated(data);
		},
		onError: (error) => {
			toast.error(error.message);
		},
	});

	const isValid = name.length >= 3 && selectedScopes.length > 0;

	return (
		<Dialog open={open} onOpenChange={handleOpenChange}>
			<DialogContent className="sm:max-w-[500px]">
				<DialogHeader>
					<DialogTitle>{t("settings.apiKeys.createTitle", "Create API Key")}</DialogTitle>
					<DialogDescription>
						{t(
							"settings.apiKeys.createDescription",
							"Create a new API key for programmatic access. The key will only be shown once.",
						)}
					</DialogDescription>
				</DialogHeader>

				<div className="space-y-4 py-4">
					{/* Name */}
					<div className="space-y-2">
						<Label htmlFor="name">{t("settings.apiKeys.form.name", "Name")} *</Label>
						<Input
							id="name"
							name="apiKeyName"
							autoComplete="off"
							value={name}
							onChange={(e) => setName(e.target.value)}
							placeholder={t("settings.apiKeys.form.namePlaceholder", "e.g., Production API")}
							maxLength={100}
						/>
						<p className="text-xs text-muted-foreground">
							{t("settings.apiKeys.form.nameHelp", "A descriptive name to identify this key")}
						</p>
					</div>

					{/* Expiration */}
					<div className="space-y-2">
						<Label htmlFor="expiration">
							{t("settings.apiKeys.form.expiration", "Expiration")}
						</Label>
						<Select value={expiresIn} onValueChange={setExpiresIn}>
							<SelectTrigger id="expiration">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								{EXPIRATION_OPTIONS.map((option) => (
									<SelectItem key={option.value} value={option.value}>
										{t(`settings.apiKeys.expiration.${option.value}`, option.label)}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>

					{/* Scopes */}
					<div className="space-y-2">
						<Label>{t("settings.apiKeys.form.scopes", "Permissions")} *</Label>
						<div className="grid grid-cols-2 gap-2 p-3 border rounded-md bg-muted/30">
							{API_KEY_SCOPES.map((scope) => (
								<div key={scope} className="flex items-center space-x-2">
									<Checkbox
										id={scope}
										checked={selectedScopes.includes(scope)}
										onCheckedChange={() => handleScopeToggle(scope)}
									/>
									<Label htmlFor={scope} className="text-sm font-normal cursor-pointer">
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
								id="rateLimitEnabled"
								checked={rateLimitEnabled}
								onCheckedChange={(checked) => setRateLimitEnabled(checked === true)}
							/>
							<Label htmlFor="rateLimitEnabled" className="font-normal cursor-pointer">
								{t("settings.apiKeys.form.rateLimit", "Enable rate limiting")}
							</Label>
						</div>
						{rateLimitEnabled && (
							<div className="ml-6 space-y-2">
								<Label htmlFor="rateLimitMax">
									{t("settings.apiKeys.form.rateLimitMax", "Max requests per minute")}
								</Label>
								<Input
									id="rateLimitMax"
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
				</div>

				<DialogFooter>
					<Button variant="outline" onClick={() => onOpenChange(false)}>
						{t("common.cancel", "Cancel")}
					</Button>
					<Button
						onClick={() => createMutation.mutate()}
						disabled={!isValid || createMutation.isPending}
					>
						{createMutation.isPending && <IconLoader2 className="mr-2 h-4 w-4 animate-spin" />}
						{t("settings.apiKeys.form.create", "Create Key")}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
