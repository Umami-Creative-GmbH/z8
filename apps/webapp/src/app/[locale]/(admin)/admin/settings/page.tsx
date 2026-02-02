"use client";

import { IconLoader2, IconScript, IconShield } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardFooter,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { getCookieConsentScriptAction, setCookieConsentScriptAction } from "./actions";

export default function PlatformSettingsPage() {
	const [script, setScript] = useState("");
	const [isLoading, setIsLoading] = useState(false);
	const [isFetching, setIsFetching] = useState(true);

	useEffect(() => {
		getCookieConsentScriptAction().then((result) => {
			if (result.success) {
				setScript(result.data ?? "");
			}
			setIsFetching(false);
		});
	}, []);

	const handleSave = async () => {
		setIsLoading(true);
		try {
			const result = await setCookieConsentScriptAction(script);
			if (result.success) {
				toast.success("Cookie consent script saved successfully");
			} else {
				toast.error(result.error ?? "Failed to save");
			}
		} finally {
			setIsLoading(false);
		}
	};

	return (
		<div className="space-y-10">
			{/* Page Header */}
			<div className="space-y-1">
				<h1 className="text-2xl font-semibold tracking-tight">Platform Settings</h1>
				<p className="text-muted-foreground">
					Global platform configuration for all organizations
				</p>
			</div>

			{/* Settings Grid */}
			<div className="grid gap-6 lg:grid-cols-2">
				{/* Cookie Consent Script */}
				<Card className="lg:col-span-2">
					<CardHeader>
						<div className="flex items-center gap-3">
							<div className="flex size-10 items-center justify-center rounded-lg bg-muted">
								<IconScript className="size-5 text-muted-foreground" aria-hidden="true" />
							</div>
							<div>
								<CardTitle>Cookie Consent Script</CardTitle>
								<CardDescription>
									Injected on authentication pages for GDPR compliance
								</CardDescription>
							</div>
						</div>
					</CardHeader>
					<CardContent className="space-y-4">
						{isFetching ? (
							<Skeleton className="h-48 w-full rounded-lg" />
						) : (
							<div className="space-y-3">
								<Label htmlFor="cookie-script">Script Content</Label>
								<Textarea
									id="cookie-script"
									value={script}
									onChange={(e) => setScript(e.target.value)}
									rows={10}
									className="font-mono text-sm"
									placeholder={`<!-- Example: CookieBot -->
<script id="Cookiebot" src="https://consent.cookiebot.com/uc.js" data-cbid="YOUR-ID" type="text/javascript" async></script>

<!-- Or custom script -->
<script>
  // Your cookie consent logic here
</script>`}
								/>
								<p className="text-xs text-muted-foreground">
									Leave empty to disable. Loaded with{" "}
									<code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">afterInteractive</code> strategy.
								</p>
							</div>
						)}
					</CardContent>
					<CardFooter className="border-t bg-muted/30 px-6 py-4">
						<Button onClick={handleSave} disabled={isLoading || isFetching}>
							{isLoading && <IconLoader2 className="mr-2 size-4 animate-spin" aria-hidden="true" />}
							Save Changes
						</Button>
					</CardFooter>
				</Card>

				{/* Cloudflare Turnstile Info */}
				<Card>
					<CardHeader>
						<div className="flex items-center gap-3">
							<div className="flex size-10 items-center justify-center rounded-lg bg-muted">
								<IconShield className="size-5 text-muted-foreground" aria-hidden="true" />
							</div>
							<div>
								<CardTitle>Cloudflare Turnstile</CardTitle>
								<CardDescription>
									Bot protection for authentication forms
								</CardDescription>
							</div>
						</div>
					</CardHeader>
					<CardContent>
						<div className="space-y-4">
							<div className="space-y-2">
								<div className="flex items-center justify-between rounded-lg border bg-muted/30 px-4 py-3">
									<span className="text-sm font-medium">Site Key</span>
									<code className="text-xs text-muted-foreground">TURNSTILE_SITE_KEY</code>
								</div>
								<div className="flex items-center justify-between rounded-lg border bg-muted/30 px-4 py-3">
									<span className="text-sm font-medium">Secret Key</span>
									<code className="text-xs text-muted-foreground">TURNSTILE_SECRET_KEY</code>
								</div>
							</div>
							<p className="text-sm text-muted-foreground">
								Configured via environment variables at deployment. Enterprise orgs can override in Domain Settings.
							</p>
						</div>
					</CardContent>
				</Card>
			</div>
		</div>
	);
}
