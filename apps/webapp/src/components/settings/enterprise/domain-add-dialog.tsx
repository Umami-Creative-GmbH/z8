"use client";

import { useForm } from "@tanstack/react-form";
import { useState } from "react";
import { toast } from "sonner";
import { addDomainAction } from "@/app/[locale]/(app)/settings/enterprise/actions";
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
			try {
				const result = await addDomainAction(value.domain);
				onDomainAdded({
					id: result.id,
					domain: value.domain.toLowerCase(),
					domainVerified: false,
					isPrimary: false,
					verificationToken: result.verificationToken,
					verificationTokenExpiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
					authConfig: {
						emailPasswordEnabled: true,
						socialProvidersEnabled: [],
						ssoEnabled: false,
						passkeyEnabled: true,
					},
					createdAt: new Date(),
				});
				form.reset();
				toast.success("Domain added successfully");
			} catch (error) {
				if (error instanceof Error) {
					toast.error(error.message);
				} else {
					toast.error("Failed to add domain");
				}
			} finally {
				setIsSubmitting(false);
			}
		},
	});

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Add Custom Domain</DialogTitle>
					<DialogDescription>
						Add a custom domain to enable organization-specific login pages. You will need to verify
						ownership via DNS records.
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
						name="domain"
						validators={{
							onChange: ({ value }) => {
								if (!value) return "Domain is required";
								if (!DOMAIN_REGEX.test(value)) {
									return "Please enter a valid domain (e.g., login.example.com)";
								}
								return undefined;
							},
						}}
					>
						{(field) => (
							<div className="space-y-2">
								<Label htmlFor="domain">Domain</Label>
								<Input
									id="domain"
									placeholder="login.example.com"
									value={field.state.value}
									onChange={(e) => field.handleChange(e.target.value)}
									onBlur={field.handleBlur}
								/>
								<p className="text-sm text-muted-foreground">
									Enter the domain where users will access the login page.
								</p>
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
							{isSubmitting ? "Adding..." : "Add Domain"}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
