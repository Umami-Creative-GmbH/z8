"use client";

import { useForm } from "@tanstack/react-form";
import { useState } from "react";
import { toast } from "sonner";
import {
	type OIDCProviderInput,
	registerSSOProviderAction,
} from "@/app/[locale]/(app)/settings/enterprise/actions";
import { Button } from "@/components/ui/button";
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

interface SSOProviderDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onProviderAdded: (provider: {
		id: string;
		issuer: string;
		domain: string;
		providerId: string;
		domainVerified: boolean | null;
		createdAt: Date | null;
	}) => void;
}

const DOMAIN_REGEX = /^([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/;
const PROVIDER_ID_REGEX = /^[a-z0-9-]+$/;

export function SSOProviderDialog({ open, onOpenChange, onProviderAdded }: SSOProviderDialogProps) {
	const [isSubmitting, setIsSubmitting] = useState(false);

	const form = useForm({
		defaultValues: {
			providerId: "",
			issuer: "",
			domain: "",
			clientId: "",
			clientSecret: "",
		},
		onSubmit: async ({ value }) => {
			setIsSubmitting(true);
			const result = await registerSSOProviderAction(value as OIDCProviderInput).then(
				(response) => ({ ok: true as const, response }),
				(error) => ({ ok: false as const, error }),
			);

			if (!result.ok) {
				if (result.error instanceof Error) {
					toast.error(result.error.message);
				} else {
					toast.error("Failed to add SSO provider");
				}
				setIsSubmitting(false);
				return;
			}

			onProviderAdded({
				id: crypto.randomUUID(),
				issuer: value.issuer,
				domain: value.domain.toLowerCase(),
				providerId: value.providerId,
				domainVerified: false,
				createdAt: new Date(),
			});
			form.reset();
			setIsSubmitting(false);
		},
	});

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-w-lg">
				<DialogHeader>
					<DialogTitle>Add SSO Provider</DialogTitle>
					<DialogDescription>
						Configure an OIDC identity provider for enterprise single sign-on.
					</DialogDescription>
				</DialogHeader>
				<form
					onSubmit={(e) => {
						e.preventDefault();
						form.handleSubmit();
					}}
					className="space-y-4"
				>
					<form.Field
						name="providerId"
						validators={{
							onChange: ({ value }) => {
								if (!value) return "Provider ID is required";
								if (!PROVIDER_ID_REGEX.test(value)) {
									return "Provider ID must contain only lowercase letters, numbers, and hyphens";
								}
								return undefined;
							},
						}}
					>
						{(field) => (
							<div className="space-y-2">
								<Label htmlFor="providerId">Provider ID</Label>
								<Input
									id="providerId"
									placeholder="acme-okta"
									value={field.state.value}
									onChange={(e) => field.handleChange(e.target.value)}
									onBlur={field.handleBlur}
								/>
								<p className="text-sm text-muted-foreground">
									A unique identifier for this provider (lowercase, no spaces)
								</p>
								{field.state.meta.errors.length > 0 && (
									<p className="text-sm text-destructive">{field.state.meta.errors[0]}</p>
								)}
							</div>
						)}
					</form.Field>

					<form.Field
						name="issuer"
						validators={{
							onChange: ({ value }) => {
								if (!value) return "Issuer URL is required";
								try {
									new URL(value);
								} catch {
									return "Please enter a valid URL";
								}
								return undefined;
							},
						}}
					>
						{(field) => (
							<div className="space-y-2">
								<Label htmlFor="issuer">Issuer URL</Label>
								<Input
									id="issuer"
									type="url"
									placeholder="https://example.okta.com"
									value={field.state.value}
									onChange={(e) => field.handleChange(e.target.value)}
									onBlur={field.handleBlur}
								/>
								<p className="text-sm text-muted-foreground">
									The OIDC issuer URL from your identity provider
								</p>
								{field.state.meta.errors.length > 0 && (
									<p className="text-sm text-destructive">{field.state.meta.errors[0]}</p>
								)}
							</div>
						)}
					</form.Field>

					<form.Field
						name="domain"
						validators={{
							onChange: ({ value }) => {
								if (!value) return "Domain is required";
								if (!DOMAIN_REGEX.test(value)) {
									return "Please enter a valid domain (e.g., example.com)";
								}
								return undefined;
							},
						}}
					>
						{(field) => (
							<div className="space-y-2">
								<Label htmlFor="domain">Email Domain</Label>
								<Input
									id="domain"
									placeholder="example.com"
									value={field.state.value}
									onChange={(e) => field.handleChange(e.target.value)}
									onBlur={field.handleBlur}
								/>
								<p className="text-sm text-muted-foreground">
									Users with this email domain will be able to use SSO
								</p>
								{field.state.meta.errors.length > 0 && (
									<p className="text-sm text-destructive">{field.state.meta.errors[0]}</p>
								)}
							</div>
						)}
					</form.Field>

					<form.Field
						name="clientId"
						validators={{
							onChange: ({ value }) => {
								if (!value) return "Client ID is required";
								return undefined;
							},
						}}
					>
						{(field) => (
							<div className="space-y-2">
								<Label htmlFor="clientId">Client ID</Label>
								<Input
									id="clientId"
									placeholder="Your OIDC client ID"
									value={field.state.value}
									onChange={(e) => field.handleChange(e.target.value)}
									onBlur={field.handleBlur}
								/>
								{field.state.meta.errors.length > 0 && (
									<p className="text-sm text-destructive">{field.state.meta.errors[0]}</p>
								)}
							</div>
						)}
					</form.Field>

					<form.Field
						name="clientSecret"
						validators={{
							onChange: ({ value }) => {
								if (!value) return "Client Secret is required";
								return undefined;
							},
						}}
					>
						{(field) => (
							<div className="space-y-2">
								<Label htmlFor="clientSecret">Client Secret</Label>
								<Input
									id="clientSecret"
									type="password"
									placeholder="Your OIDC client secret"
									value={field.state.value}
									onChange={(e) => field.handleChange(e.target.value)}
									onBlur={field.handleBlur}
								/>
								{field.state.meta.errors.length > 0 && (
									<p className="text-sm text-destructive">{field.state.meta.errors[0]}</p>
								)}
							</div>
						)}
					</form.Field>

					<DialogFooter>
						<Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
							Cancel
						</Button>
						<Button type="submit" disabled={isSubmitting}>
							{isSubmitting ? "Adding..." : "Add Provider"}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
