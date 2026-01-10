"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
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
import {
	Form,
	FormControl,
	FormDescription,
	FormField,
	FormItem,
	FormLabel,
	FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";

const providerSchema = z.object({
	providerId: z
		.string()
		.min(1, "Provider ID is required")
		.regex(/^[a-z0-9-]+$/, "Provider ID must contain only lowercase letters, numbers, and hyphens"),
	issuer: z.string().url("Please enter a valid URL").min(1, "Issuer URL is required"),
	domain: z
		.string()
		.min(1, "Domain is required")
		.regex(
			/^([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/,
			"Please enter a valid domain (e.g., example.com)",
		),
	clientId: z.string().min(1, "Client ID is required"),
	clientSecret: z.string().min(1, "Client Secret is required"),
});

type ProviderFormData = z.infer<typeof providerSchema>;

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

export function SSOProviderDialog({ open, onOpenChange, onProviderAdded }: SSOProviderDialogProps) {
	const [isSubmitting, setIsSubmitting] = useState(false);

	const form = useForm<ProviderFormData>({
		resolver: zodResolver(providerSchema),
		defaultValues: {
			providerId: "",
			issuer: "",
			domain: "",
			clientId: "",
			clientSecret: "",
		},
	});

	const onSubmit = async (data: ProviderFormData) => {
		setIsSubmitting(true);
		try {
			await registerSSOProviderAction(data as OIDCProviderInput);
			onProviderAdded({
				id: crypto.randomUUID(),
				issuer: data.issuer,
				domain: data.domain.toLowerCase(),
				providerId: data.providerId,
				domainVerified: false,
				createdAt: new Date(),
			});
			form.reset();
		} catch (error) {
			if (error instanceof Error) {
				toast.error(error.message);
			} else {
				toast.error("Failed to add SSO provider");
			}
		} finally {
			setIsSubmitting(false);
		}
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-w-lg">
				<DialogHeader>
					<DialogTitle>Add SSO Provider</DialogTitle>
					<DialogDescription>
						Configure an OIDC identity provider for enterprise single sign-on.
					</DialogDescription>
				</DialogHeader>
				<Form {...form}>
					<form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
						<FormField
							control={form.control}
							name="providerId"
							render={({ field }) => (
								<FormItem>
									<FormLabel>Provider ID</FormLabel>
									<FormControl>
										<Input placeholder="acme-okta" {...field} />
									</FormControl>
									<FormDescription>
										A unique identifier for this provider (lowercase, no spaces)
									</FormDescription>
									<FormMessage />
								</FormItem>
							)}
						/>

						<FormField
							control={form.control}
							name="issuer"
							render={({ field }) => (
								<FormItem>
									<FormLabel>Issuer URL</FormLabel>
									<FormControl>
										<Input placeholder="https://example.okta.com" type="url" {...field} />
									</FormControl>
									<FormDescription>The OIDC issuer URL from your identity provider</FormDescription>
									<FormMessage />
								</FormItem>
							)}
						/>

						<FormField
							control={form.control}
							name="domain"
							render={({ field }) => (
								<FormItem>
									<FormLabel>Email Domain</FormLabel>
									<FormControl>
										<Input placeholder="example.com" {...field} />
									</FormControl>
									<FormDescription>
										Users with this email domain will be able to use SSO
									</FormDescription>
									<FormMessage />
								</FormItem>
							)}
						/>

						<FormField
							control={form.control}
							name="clientId"
							render={({ field }) => (
								<FormItem>
									<FormLabel>Client ID</FormLabel>
									<FormControl>
										<Input placeholder="Your OIDC client ID" {...field} />
									</FormControl>
									<FormMessage />
								</FormItem>
							)}
						/>

						<FormField
							control={form.control}
							name="clientSecret"
							render={({ field }) => (
								<FormItem>
									<FormLabel>Client Secret</FormLabel>
									<FormControl>
										<Input type="password" placeholder="Your OIDC client secret" {...field} />
									</FormControl>
									<FormMessage />
								</FormItem>
							)}
						/>

						<DialogFooter>
							<Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
								Cancel
							</Button>
							<Button type="submit" disabled={isSubmitting}>
								{isSubmitting ? "Adding..." : "Add Provider"}
							</Button>
						</DialogFooter>
					</form>
				</Form>
			</DialogContent>
		</Dialog>
	);
}
