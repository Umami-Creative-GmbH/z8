"use client";

import { useForm } from "@tanstack/react-form";
import { useTranslate } from "@tolgee/react";
import { DateTime } from "luxon";
import { useState } from "react";
import { toast } from "sonner";
import { addDomainAction } from "@/app/[locale]/(app)/settings/enterprise/actions";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface DomainAddDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onDomainAdded: (domain: {
		id: string;
		domain: string;
		domainVerified: boolean;
		isPrimary: boolean;
		verificationToken: string | null;
		verificationTokenExpiresAt: Date | null;
		authConfig: {
			emailPasswordEnabled: boolean;
			socialProvidersEnabled: string[];
			ssoEnabled: boolean;
			passkeyEnabled: boolean;
		};
		createdAt: Date;
	}) => void;
}

const DOMAIN_REGEX = /^([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/;

export function DomainAddDialog({ open, onOpenChange, onDomainAdded }: DomainAddDialogProps) {
	const { t } = useTranslate();
	const [isSubmitting, setIsSubmitting] = useState(false);

	const form = useForm({
		defaultValues: {
			domain: "",
		},
		onSubmit: async ({ value }) => {
			// Validate
			if (!value.domain) {
				return;
			}
			if (!DOMAIN_REGEX.test(value.domain)) {
				return;
			}

			setIsSubmitting(true);
			const result = await addDomainAction(value.domain).catch((error: unknown) => {
				if (error instanceof Error) {
					toast.error(error.message);
				} else {
					toast.error(t("settings.enterprise.domains.addFailed", "Failed to add domain"));
				}
				return null;
			});

			if (!result) {
				setIsSubmitting(false);
				return;
			}

			const now = DateTime.now();

			onDomainAdded({
				id: result.id,
				domain: value.domain.toLowerCase(),
				domainVerified: false,
				isPrimary: false,
				verificationToken: result.verificationToken,
				verificationTokenExpiresAt: now.plus({ days: 7 }).toJSDate(),
				authConfig: {
					emailPasswordEnabled: true,
					socialProvidersEnabled: [],
					ssoEnabled: false,
					passkeyEnabled: true,
				},
				createdAt: now.toJSDate(),
			});
			form.reset();
			toast.success(t("settings.enterprise.domains.added", "Domain added successfully"));
			setIsSubmitting(false);
		},
	});

	return (
		<ActionPanel open={open} onOpenChange={onOpenChange}>
			<ActionPanelContent>
				<ActionPanelHeader>
					<ActionPanelTitle>
						{t("settings.enterprise.domains.add", "Add Custom Domain")}
					</ActionPanelTitle>
					<ActionPanelDescription>
						{t(
							"settings.enterprise.domains.addDescription",
							"Add a custom domain to enable organization-specific login pages. You will need to verify ownership via DNS records.",
						)}
					</ActionPanelDescription>
				</ActionPanelHeader>
				<form
					onSubmit={(e) => {
						e.preventDefault();
						form.handleSubmit();
					}}
					className="flex min-h-0 flex-1 flex-col"
				>
					<ActionPanelBody className="space-y-4">
						<form.Field
							name="domain"
							validators={{
								onChange: ({ value }) => {
									if (!value)
										return t("settings.enterprise.domains.domainRequired", "Domain is required");
									if (!DOMAIN_REGEX.test(value)) {
										return t(
											"settings.enterprise.domains.domainInvalid",
											"Please enter a valid domain (e.g., login.example.com)",
										);
									}
									return undefined;
								},
							}}
						>
							{(field) => (
								<div className="space-y-2">
									<Label htmlFor="domain">
										{t("settings.enterprise.domains.domain", "Domain")}
									</Label>
									<Input
										id="domain"
										placeholder="login.example.com"
										value={field.state.value}
										onChange={(e) => field.handleChange(e.target.value)}
										onBlur={field.handleBlur}
									/>
									<p className="text-sm text-muted-foreground">
										{t(
											"settings.enterprise.domains.domainHelp",
											"Enter the domain where users will access the login page.",
										)}
									</p>
									{field.state.meta.errors.length > 0 && (
										<p className="text-sm text-destructive">{field.state.meta.errors[0]}</p>
									)}
								</div>
							)}
						</form.Field>
					</ActionPanelBody>
					<ActionPanelFooter>
						<Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
							{t("common.cancel", "Cancel")}
						</Button>
						<Button type="submit" disabled={isSubmitting}>
							{isSubmitting
								? t("settings.enterprise.domains.adding", "Adding…")
								: t("settings.enterprise.domains.addDomain", "Add Domain")}
						</Button>
					</ActionPanelFooter>
				</form>
			</ActionPanelContent>
		</ActionPanel>
	);
}
