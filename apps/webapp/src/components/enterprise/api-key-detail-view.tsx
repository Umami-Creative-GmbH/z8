"use client";

import { IconArrowLeft, IconKey } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { Temporal } from "temporal-polyfill";
import type { ApiKeyDetail } from "@/app/[locale]/(app)/settings/enterprise/api-keys/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { useDisplayContext } from "@/hooks/use-display-context";
import { formatInstant } from "@/lib/datetime/temporal-format";
import { Link } from "@/navigation";
import { useApiKeyScopeLabels, useRateLimitWindowLabels } from "./api-key-labels";

function statusVariant(status: number) {
	if (status < 300) return "secondary" as const;
	if (status === 429) return "outline" as const;
	return "destructive" as const;
}

/** One API key and its recent requests from the key request log (#763). */
export function ApiKeyDetailView({ detail }: { detail: ApiKeyDetail }) {
	const { t } = useTranslate();
	const display = useDisplayContext();
	const scopeLabels = useApiKeyScopeLabels();
	const windowLabels = useRateLimitWindowLabels();
	const { key, requests } = detail;
	const at = (iso: string | null) =>
		iso ? formatInstant(Temporal.Instant.from(iso), display, "dateTimeMedium") : "-";
	const creatorName = key.creator
		? key.creator.name || key.creator.email || key.creator.userId
		: null;
	const windowLabel =
		key.rateLimitTimeWindow !== null && key.rateLimitTimeWindow in windowLabels
			? windowLabels[key.rateLimitTimeWindow as keyof typeof windowLabels]
			: null;

	const facts: [string, string][] = [
		[t("settings.apiKeys.prefix", "Key Prefix"), key.prefix ?? "-"],
		[
			t("settings.apiKeys.detail.creator", "Created by"),
			creatorName === null
				? "-"
				: key.creator?.departed
					? t("settings.apiKeys.detail.creatorDeparted", "{name} (departed)", { name: creatorName })
					: creatorName,
		],
		[t("settings.apiKeys.detail.createdAt", "Created"), at(key.createdAt)],
		[t("settings.apiKeys.lastUsed", "Last Used"), at(key.lastRequest)],
		[
			t("settings.apiKeys.expires", "Expires"),
			key.expiresAt ? at(key.expiresAt) : t("settings.apiKeys.neverExpires", "Never expires"),
		],
		[
			t("settings.apiKeys.detail.rateLimit", "Rate limit"),
			!key.rateLimitEnabled || !key.rateLimitMax
				? t("settings.apiKeys.detail.noRateLimit", "Off")
				: windowLabel
					? t("settings.apiKeys.detail.rateLimitValue", "{max} {window}", {
							max: key.rateLimitMax,
							window: windowLabel,
						})
					: t("settings.apiKeys.detail.rateLimitMilliseconds", "{max} per {window} ms", {
							max: key.rateLimitMax,
							window: key.rateLimitTimeWindow ?? 0,
						}),
		],
	];

	return (
		<div className="p-4 sm:p-6">
			<div className="mx-auto min-w-0 max-w-4xl space-y-6">
				<div className="space-y-2">
					<Button variant="ghost" size="sm" asChild className="-ml-2">
						<Link href="/settings/enterprise/api-keys">
							<IconArrowLeft className="mr-1 size-4" aria-hidden="true" />
							{t("settings.apiKeys.detail.back", "All API keys")}
						</Link>
					</Button>
					<div className="flex flex-wrap items-center gap-3">
						<IconKey className="size-6 text-muted-foreground" aria-hidden="true" />
						<h1 className="text-2xl font-semibold">{key.name}</h1>
						<Badge variant={key.enabled ? "default" : "secondary"}>
							{key.enabled
								? t("settings.apiKeys.active", "Active")
								: t("settings.apiKeys.disabled", "Disabled")}
						</Badge>
					</div>
				</div>

				<Card>
					<CardContent className="pt-6">
						<dl className="grid gap-4 sm:grid-cols-2">
							{facts.map(([label, value]) => (
								<div key={label} className="min-w-0">
									<dt className="text-sm text-muted-foreground">{label}</dt>
									<dd className="break-words font-medium">{value}</dd>
								</div>
							))}
							<div className="min-w-0 sm:col-span-2">
								<dt className="text-sm text-muted-foreground">
									{t("settings.apiKeys.scopes", "Permissions")}
								</dt>
								<dd className="mt-1 flex flex-wrap gap-1">
									{key.scopes.length === 0 ? (
										<span className="font-medium">
											{t("settings.apiKeys.noPermissions", "No permissions")}
										</span>
									) : (
										key.scopes.map((scope) => (
											<Badge key={scope} variant="outline">
												{scopeLabels[scope]}
											</Badge>
										))
									)}
								</dd>
							</div>
						</dl>
					</CardContent>
				</Card>

				<Card>
					<CardHeader>
						<CardTitle>{t("settings.apiKeys.detail.requests", "Recent requests")}</CardTitle>
						<CardDescription>
							{t(
								"settings.apiKeys.detail.requestsDescription",
								"Every request made with this key, newest first. Requests are kept for 90 days.",
							)}
						</CardDescription>
					</CardHeader>
					<CardContent>
						{requests.length === 0 ? (
							<p className="py-6 text-center text-sm text-muted-foreground">
								{t("settings.apiKeys.detail.noRequests", "No requests in the last 90 days.")}
							</p>
						) : (
							<div className="overflow-x-auto">
								<Table>
									<TableHeader>
										<TableRow>
											<TableHead>{t("settings.apiKeys.detail.time", "Time")}</TableHead>
											<TableHead>{t("settings.apiKeys.detail.request", "Request")}</TableHead>
											<TableHead>{t("settings.apiKeys.detail.status", "Status")}</TableHead>
											<TableHead className="text-right">
												{t("settings.apiKeys.detail.rows", "Rows")}
											</TableHead>
											<TableHead>{t("settings.apiKeys.detail.ip", "IP address")}</TableHead>
										</TableRow>
									</TableHeader>
									<TableBody>
										{requests.map((request) => (
											<TableRow key={request.id}>
												<TableCell className="whitespace-nowrap">
													{at(request.requestedAt)}
												</TableCell>
												<TableCell className="font-mono text-sm">
													{request.method} {request.route}
												</TableCell>
												<TableCell>
													<Badge variant={statusVariant(request.status)}>{request.status}</Badge>
												</TableCell>
												<TableCell className="text-right tabular-nums">
													{request.rowCount ?? "-"}
												</TableCell>
												<TableCell className="font-mono text-sm">
													{request.ipAddress ?? "-"}
												</TableCell>
											</TableRow>
										))}
									</TableBody>
								</Table>
							</div>
						)}
					</CardContent>
				</Card>
			</div>
		</div>
	);
}
