import { useQuery, useQueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect } from "react";
import type { Session } from "../types";

export function useAuth() {
  const queryClient = useQueryClient();

  const sessionQuery = useQuery({
    queryKey: ["session"],
    queryFn: () => invoke<Session>("get_session"),
    staleTime: Infinity, // Session doesn't change unless we explicitly update it
  });

  // Listen for auth events from Rust backend
  useEffect(() => {
    const unlistenSuccess = listen("auth_success", () => {
      queryClient.invalidateQueries({ queryKey: ["session"] });
      queryClient.invalidateQueries({ queryKey: ["clock-status"] });
    });

    const unlistenLogout = listen("logout", () => {
      queryClient.invalidateQueries({ queryKey: ["session"] });
      queryClient.setQueryData(["clock-status"], null);
    });

    const unlistenError = listen("auth_error", (event) => {
      console.error("Auth error:", event.payload);
    });

    return () => {
      unlistenSuccess.then((fn) => fn());
      unlistenLogout.then((fn) => fn());
      unlistenError.then((fn) => fn());
    };
  }, [queryClient]);

  const login = useCallback(async () => {
    try {
      await invoke("initiate_oauth");
    } catch (error) {
      console.error("Failed to initiate login:", error);
      throw error;
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await invoke("logout");
      queryClient.invalidateQueries({ queryKey: ["session"] });
    } catch (error) {
      console.error("Failed to logout:", error);
      throw error;
    }
  }, [queryClient]);

  return {
    isAuthenticated: sessionQuery.data?.isAuthenticated ?? false,
    isLoading: sessionQuery.isLoading,
    login,
    logout,
  };
}
