"use client";

import {
	IconCheck,
	IconDeviceDesktop,
	IconDeviceMobile,
	IconDeviceTablet,
	IconLoader2,
	IconMapPin,
	IconTrash,
} from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { authClient } from "@/lib/auth-client";
import { formatRelative as formatDistanceToNow } from "@/lib/datetime/luxon-utils";
import { queryKeys } from "@/lib/query/keys";

interface Session {
	id: string;
	token: string;
	userId: string;
	expiresAt: Date;
	ipAddress?: string | null;
	userAgent?: string | null;
	createdAt: Date;
}

function getDeviceIcon(userAgent: string | null | undefined) {
	if (!userAgent) return IconDeviceDesktop;

	const ua = userAgent.toLowerCase();
	if (ua.includes("mobile") || ua.includes("android") || ua.includes("iphone")) {
		return IconDeviceMobile;
	}
	if (ua.includes("tablet") || ua.includes("ipad")) {
		return IconDeviceTablet;
	}
	return IconDeviceDesktop;
}

function parseUserAgent(userAgent: string | null | undefined): {
	browser: string;
	os: string;
	device: string;
} {
	if (!userAgent) {
		return { browser: "Unknown Browser", os: "Unknown OS", device: "Desktop" };
	}

	// Simple user agent parsing (you might want to use a library like ua-parser-js for production)
	let browser = "Unknown Browser";
	let os = "Unknown OS";
	let device = "Desktop";

	const ua = userAgent.toLowerCase();

	// Detect browser
	if (ua.includes("chrome") && !ua.includes("edge")) browser = "Chrome";
	else if (ua.includes("safari") && !ua.includes("chrome")) browser = "Safari";
	else if (ua.includes("firefox")) browser = "Firefox";
	else if (ua.includes("edge")) browser = "Edge";
	else if (ua.includes("opera")) browser = "Opera";

	// Detect OS
	if (ua.includes("windows")) os = "Windows";
	else if (ua.includes("mac")) os = "macOS";
	else if (ua.includes("linux")) os = "Linux";
	else if (ua.includes("android")) os = "Android";
	else if (ua.includes("ios") || ua.includes("iphone") || ua.includes("ipad")) os = "iOS";

	// Detect device type
	if (ua.includes("mobile") || ua.includes("android") || ua.includes("iphone")) {
		device = "Mobile";
	} else if (ua.includes("tablet") || ua.includes("ipad")) {
		device = "Tablet";
	}

	return { browser, os, device };
}

export function SessionManagement() {
	const { t } = useTranslate();
	const queryClient = useQueryClient();
	const [revokingSessionId, setRevokingSessionId] = useState<string | null>(null);

	// Query for current session token
	const currentSessionQuery = useQuery({
		queryKey: ["auth", "current-session"],
		queryFn: async () => {
			const { data } = await authClient.getSession();
			return data?.session?.token || null;
		},
		staleTime: 5 * 60 * 1000, // 5 minutes
	});

	// Query for sessions list
	const sessionsQuery = useQuery({
		queryKey: queryKeys.auth.sessions(),
		queryFn: async () => {
			const { data } = await authClient.listSessions();
			return (data || []) as Session[];
		},
		staleTime: 30 * 1000, // 30 seconds
	});

	// Mutation for revoking a single session
	const revokeSessionMutation = useMutation({
		mutationFn: async ({ token }: { token: string; sessionId: string }) => {
			await authClient.revokeSession({ token });
		},
		onMutate: ({ sessionId }) => {
			setRevokingSessionId(sessionId);
		},
		onSuccess: () => {
			toast.success(t("settings.sessions.revoked", "Session revoked successfully"));
			queryClient.invalidateQueries({ queryKey: queryKeys.auth.sessions() });
		},
		onError: (error) => {
			toast.error(t("settings.sessions.revokeFailed", "Failed to revoke session"));
			console.error("Failed to revoke session:", error);
		},
		onSettled: () => {
			setRevokingSessionId(null);
		},
	});

	// Mutation for revoking all other sessions
	const revokeOtherSessionsMutation = useMutation({
		mutationFn: async () => {
			await authClient.revokeOtherSessions();
		},
		onSuccess: () => {
			toast.success(
				t("settings.sessions.othersRevoked", "All other sessions revoked successfully"),
			);
			queryClient.invalidateQueries({ queryKey: queryKeys.auth.sessions() });
		},
		onError: (error) => {
			toast.error(t("settings.sessions.revokeAllFailed", "Failed to revoke other sessions"));
			console.error("Failed to revoke other sessions:", error);
		},
	});

	const sessions = sessionsQuery.data || [];
	const currentSessionToken = currentSessionQuery.data;
	const isLoading = sessionsQuery.isLoading || currentSessionQuery.isLoading;
	const otherSessionsCount = sessions.filter((s) => s.token !== currentSessionToken).length;

	if (isLoading) {
		return (
			<Card>
				<CardHeader>
					<CardTitle>{t("settings.sessions.title", "Active Sessions")}</CardTitle>
					<CardDescription>
						{t(
							"settings.sessions.description",
							"Manage your active sessions across different devices",
						)}
					</CardDescription>
				</CardHeader>
				<CardContent>
					<div className="flex items-center justify-center py-8">
						<IconLoader2 className="size-8 animate-spin text-muted-foreground" />
					</div>
				</CardContent>
			</Card>
		);
	}

	return (
		<Card>
			<CardHeader>
				<div className="flex items-center justify-between">
					<div>
						<CardTitle>{t("settings.sessions.title", "Active Sessions")}</CardTitle>
						<CardDescription>
							{t(
								"settings.sessions.description",
								"Manage your active sessions across different devices",
							)}
						</CardDescription>
					</div>
					{otherSessionsCount > 0 && (
						<Button
							variant="outline"
							size="sm"
							onClick={() => revokeOtherSessionsMutation.mutate()}
							disabled={revokeOtherSessionsMutation.isPending}
						>
							{revokeOtherSessionsMutation.isPending ? (
								<>
									<IconLoader2 className="mr-2 size-4 animate-spin" />
									{t("settings.sessions.revoking", "Revoking…")}
								</>
							) : (
								t("settings.sessions.revokeAllOthers", "Revoke All Other Sessions")
							)}
						</Button>
					)}
				</div>
			</CardHeader>
			<CardContent>
				<div className="space-y-4">
					{sessions.length === 0 ? (
						<p className="text-center text-muted-foreground py-8">
							{t("settings.sessions.none", "No active sessions")}
						</p>
					) : (
						sessions.map((session, index) => {
							const isCurrentSession = session.token === currentSessionToken;
							const { browser, os, device } = parseUserAgent(session.userAgent);
							const DeviceIcon = getDeviceIcon(session.userAgent);
							const browserLabel =
								browser === "Unknown Browser"
									? t("settings.sessions.unknownBrowser", "Unknown Browser")
									: browser;
							const osLabel =
								os === "Unknown OS" ? t("settings.sessions.unknownOs", "Unknown OS") : os;
							const deviceLabel =
								device === "Mobile"
									? t("settings.sessions.devices.mobile", "Mobile")
									: device === "Tablet"
										? t("settings.sessions.devices.tablet", "Tablet")
										: t("settings.sessions.devices.desktop", "Desktop");

							return (
								<div key={session.id}>
									{index > 0 && <Separator className="my-4" />}
									<div className="flex items-start justify-between gap-4">
										<div className="flex min-w-0 flex-1 items-start gap-3">
											<div className="rounded-full bg-muted p-2">
												<DeviceIcon className="size-5 text-muted-foreground" aria-hidden="true" />
											</div>
											<div className="min-w-0 flex-1 space-y-1">
												<div className="flex items-center gap-2">
													<p className="font-medium">
														{t("settings.sessions.browserOnOs", "{browser} on {os}", {
															browser: browserLabel,
															os: osLabel,
														})}
													</p>
													{isCurrentSession && (
														<span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700 dark:bg-green-900/30 dark:text-green-400">
															<IconCheck className="size-3" aria-hidden="true" />
															{t("settings.sessions.current", "Current Session")}
														</span>
													)}
												</div>
												<div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
													<span>{deviceLabel}</span>
													{session.ipAddress && (
														<span
															className="flex min-w-0 max-w-full items-center gap-1"
															title={session.ipAddress}
														>
															<IconMapPin className="size-3 shrink-0" aria-hidden="true" />
															<span className="block min-w-0 truncate">{session.ipAddress}</span>
														</span>
													)}
													<span>
														{t("settings.sessions.signedIn", "Signed in")}{" "}
														{formatDistanceToNow(new Date(session.createdAt))}
													</span>
												</div>
											</div>
										</div>
										{!isCurrentSession && (
											<Button
												variant="ghost"
												size="sm"
												onClick={() =>
													revokeSessionMutation.mutate({
														token: session.token,
														sessionId: session.id,
													})
												}
												disabled={revokingSessionId === session.id}
											>
												{revokingSessionId === session.id ? (
													<IconLoader2 className="size-4 animate-spin" aria-hidden="true" />
												) : (
													<>
														<IconTrash className="size-4" aria-hidden="true" />
														<span className="sr-only">
															{t("settings.sessions.revoke", "Revoke")}
														</span>
													</>
												)}
											</Button>
										)}
									</div>
								</div>
							);
						})
					)}
				</div>

				{otherSessionsCount > 0 && (
					<div className="mt-6 rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-900/50 dark:bg-amber-900/20">
						<p className="text-sm text-amber-900 dark:text-amber-200">
							{t(
								"settings.sessions.securityTip",
								"If you see a session you don't recognize, revoke it immediately and change your password.",
							)}
						</p>
					</div>
				)}
			</CardContent>
		</Card>
	);
}
