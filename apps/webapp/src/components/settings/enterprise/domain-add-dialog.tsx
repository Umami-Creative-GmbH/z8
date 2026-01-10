"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
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

const domainSchema = z.object({
	domain: z
		.string()
		.min(1, "Domain is required")
		.regex(
			/^([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/,
			"Please enter a valid domain (e.g., login.example.com)",
		),
});

type DomainFormData = z.infer<typeof domainSchema>;

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

export function DomainAddDialog({ open, onOpenChange, onDomainAdded }: DomainAddDialogProps) {
	const [isSubmitting, setIsSubmitting] = useState(false);

	const form = useForm<DomainFormData>({
		resolver: zodResolver(domainSchema),
		defaultValues: {
			domain: "",
		},
	});

	const onSubmit = async (data: DomainFormData) => {
		setIsSubmitting(true);
		try {
			const result = await addDomainAction(data.domain);
			onDomainAdded({
				id: result.id,
				domain: data.domain.toLowerCase(),
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
	};

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
				<Form {...form}>
					<form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
						<FormField
							control={form.control}
							name="domain"
							render={({ field }) => (
								<FormItem>
									<FormLabel>Domain</FormLabel>
									<FormControl>
										<Input placeholder="login.example.com" {...field} />
									</FormControl>
									<FormDescription>
										Enter the domain where users will access the login page.
									</FormDescription>
									<FormMessage />
								</FormItem>
							)}
						/>
						<DialogFooter>
							<Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
								Cancel
							</Button>
							<Button type="submit" disabled={isSubmitting}>
								{isSubmitting ? "Adding..." : "Add Domain"}
							</Button>
						</DialogFooter>
					</form>
				</Form>
			</DialogContent>
		</Dialog>
	);
}
