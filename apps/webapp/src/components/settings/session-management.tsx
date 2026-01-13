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
		return { browser: "Unknown", os: "Unknown", device: "Unknown" };
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
			toast.success(t("sessions.revoked", "Session revoked successfully"));
			queryClient.invalidateQueries({ queryKey: queryKeys.auth.sessions() });
		},
		onError: (error) => {
			toast.error(t("sessions.revoke-failed", "Failed to revoke session"));
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
			toast.success(t("sessions.others-revoked", "All other sessions revoked successfully"));
			queryClient.invalidateQueries({ queryKey: queryKeys.auth.sessions() });
		},
		onError: (error) => {
			toast.error(t("sessions.revoke-all-failed", "Failed to revoke other sessions"));
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
					<CardTitle>{t("sessions.title", "Active Sessions")}</CardTitle>
					<CardDescription>
						{t("sessions.description", "Manage your active sessions across different devices")}
					</CardDescription>
				</CardHeader>
				<CardContent>
					<div className="flex items-center justify-center py-8">
						<IconLoader2 className="h-8 w-8 animate-spin text-muted-foreground" />
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
						<CardTitle>{t("sessions.title", "Active Sessions")}</CardTitle>
						<CardDescription>
							{t("sessions.description", "Manage your active sessions across different devices")}
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
									<IconLoader2 className="mr-2 h-4 w-4 animate-spin" />
									{t("sessions.revoking", "Revoking...")}
								</>
							) : (
								t("sessions.revoke-all-others", "Revoke All Other Sessions")
							)}
						</Button>
					)}
				</div>
			</CardHeader>
			<CardContent>
				<div className="space-y-4">
					{sessions.length === 0 ? (
						<p className="text-center text-muted-foreground py-8">
							{t("sessions.none", "No active sessions")}
						</p>
					) : (
						sessions.map((session, index) => {
							const isCurrentSession = session.token === currentSessionToken;
							const { browser, os, device } = parseUserAgent(session.userAgent);
							const DeviceIcon = getDeviceIcon(session.userAgent);

							return (
								<div key={session.id}>
									{index > 0 && <Separator className="my-4" />}
									<div className="flex items-start justify-between gap-4">
										<div className="flex items-start gap-3 flex-1">
											<div className="rounded-full bg-muted p-2">
												<DeviceIcon className="h-5 w-5 text-muted-foreground" />
											</div>
											<div className="flex-1 space-y-1">
												<div className="flex items-center gap-2">
													<p className="font-medium">
														{browser} on {os}
													</p>
													{isCurrentSession && (
														<span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700 dark:bg-green-900/30 dark:text-green-400">
															<IconCheck className="h-3 w-3" />
															{t("sessions.current", "Current Session")}
														</span>
													)}
												</div>
												<div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
													<span>{device}</span>
													{session.ipAddress && (
														<span className="flex items-center gap-1">
															<IconMapPin className="h-3 w-3" />
															{session.ipAddress}
														</span>
													)}
													<span>
														{t("sessions.signed-in", "Signed in")}{" "}
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
													<IconLoader2 className="h-4 w-4 animate-spin" />
												) : (
													<>
														<IconTrash className="h-4 w-4" />
														<span className="sr-only">{t("sessions.revoke", "Revoke")}</span>
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
								"sessions.security-tip",
								"If you see a session you don't recognize, revoke it immediately and change your password.",
							)}
						</p>
					</div>
				)}
			</CardContent>
		</Card>
	);
}
