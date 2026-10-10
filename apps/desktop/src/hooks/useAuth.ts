import { useQuery, useQueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useState } from "react";
import type { Session } from "../types";

export function useAuth() {
	const queryClient = useQueryClient();
	const [authError, setAuthError] = useState<string | null>(null);

	const sessionQuery = useQuery({
		queryKey: ["session"],
		queryFn: () => invoke<Session>("get_session"),
		staleTime: Infinity, // Session doesn't change unless we explicitly update it
	});

	// Publish the local sign-out immediately. A refetch can fail or return an old
	// in-flight session; neither may keep the previous tenant on screen.
	const clearSession = useCallback(() => {
		setAuthError(null);
		void queryClient.cancelQueries({ queryKey: ["session"] });
		queryClient.setQueryData<Session>(["session"], (previous) => ({
			isAuthenticated: false,
			credentialError: null,
			sessionRevision: previous?.sessionRevision ?? 0,
		}));
		for (const key of [
			"clock-status",
			"clock-journal",
			"organizations",
			"desktop-context",
		]) {
			void queryClient.cancelQueries({ queryKey: [key] });
			queryClient.removeQueries({ queryKey: [key] });
		}
	}, [queryClient]);

	// Listen for auth events from Rust backend
	useEffect(() => {
		const unlistenSuccess = listen("auth_success", () => {
			setAuthError(null);
			queryClient.invalidateQueries({ queryKey: ["session"] });
			queryClient.invalidateQueries({ queryKey: ["clock-status"] });
		});

		const unlistenLogout = listen("logout", clearSession);

		const unlistenError = listen("auth_error", (event) => {
			setAuthError(String(event.payload));
		});

		return () => {
			unlistenSuccess.then((fn) => fn());
			unlistenLogout.then((fn) => fn());
			unlistenError.then((fn) => fn());
		};
	}, [queryClient, clearSession]);

	const login = useCallback(async () => {
		try {
			setAuthError(null);
			await invoke("initiate_oauth");
		} catch (error) {
			console.error("Failed to initiate login:", error);
			throw error;
		}
	}, []);

	const logout = useCallback(async () => {
		try {
			await invoke("logout");
			clearSession();
		} catch (error) {
			console.error("Failed to logout:", error);
			throw error;
		}
	}, [clearSession]);

	return {
		authError: authError ?? sessionQuery.data?.credentialError ?? null,
		isAuthenticated: sessionQuery.data?.isAuthenticated ?? false,
		isLoading: sessionQuery.isLoading,
		sessionVersion: sessionQuery.dataUpdatedAt,
		sessionRevision: sessionQuery.data?.sessionRevision ?? 0,
		login,
		logout,
	};
}
