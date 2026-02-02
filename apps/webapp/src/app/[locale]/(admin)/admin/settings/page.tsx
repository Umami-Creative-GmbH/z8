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
		<div className="space-y-6">
			<div>
				<h1 className="text-3xl font-bold">Platform Settings</h1>
				<p className="text-muted-foreground mt-1">
					Global platform configuration for all organizations
				</p>
			</div>

			{/* Cookie Consent Script */}
			<Card>
				<CardHeader>
					<div className="flex items-center gap-2">
						<IconScript className="size-5" aria-hidden="true" />
						<CardTitle>Cookie Consent Script</CardTitle>
					</div>
					<CardDescription>
						Raw JavaScript/HTML that will be injected on authentication pages (sign-in, sign-up,
						forgot-password). Use this for cookie consent banners like CookieBot, OneTrust, or
						custom scripts.
					</CardDescription>
				</CardHeader>
				<CardContent className="space-y-4">
					{isFetching ? (
						<Skeleton className="h-32 w-full" />
					) : (
						<div className="space-y-2">
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
								Leave empty to disable cookie consent on auth pages. The script will be loaded with{" "}
								<code className="bg-muted px-1 rounded">afterInteractive</code> strategy.
							</p>
						</div>
					)}
				</CardContent>
				<CardFooter>
					<Button onClick={handleSave} disabled={isLoading || isFetching}>
						{isLoading && <IconLoader2 className="mr-2 size-4 animate-spin" aria-hidden="true" />}
						Save Script
					</Button>
				</CardFooter>
			</Card>

			{/* Cloudflare Turnstile Info */}
			<Card>
				<CardHeader>
					<div className="flex items-center gap-2">
						<IconShield className="size-5" aria-hidden="true" />
						<CardTitle>Cloudflare Turnstile (Global)</CardTitle>
					</div>
					<CardDescription>
						Bot protection for authentication forms. Global credentials are configured via
						environment variables.
					</CardDescription>
				</CardHeader>
				<CardContent>
					<div className="space-y-4 text-sm">
						<div className="grid gap-2">
							<div className="flex items-center justify-between p-3 bg-muted rounded-md">
								<span className="font-medium">Site Key</span>
								<code className="text-muted-foreground">TURNSTILE_SITE_KEY</code>
							</div>
							<div className="flex items-center justify-between p-3 bg-muted rounded-md">
								<span className="font-medium">Secret Key</span>
								<code className="text-muted-foreground">TURNSTILE_SECRET_KEY</code>
							</div>
						</div>
						<p className="text-muted-foreground">
							These environment variables must be set at deployment time. Enterprise organizations
							can override with their own Turnstile keys in their Domain Settings.
						</p>
					</div>
				</CardContent>
			</Card>
		</div>
	);
}
