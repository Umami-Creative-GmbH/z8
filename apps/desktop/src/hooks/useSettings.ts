import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useState } from "react";
import type { Settings } from "../types";

export function useSettings() {
  const queryClient = useQueryClient();
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  const settingsQuery = useQuery({
    queryKey: ["settings"],
    queryFn: () => invoke<Settings>("get_settings"),
    staleTime: Infinity,
  });

  // Listen for settings open event from tray menu
  useEffect(() => {
    const unlisten = listen("open_settings", () => {
      setIsSettingsOpen(true);
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  const saveMutation = useMutation({
    mutationFn: (settings: Omit<Settings, "version">) =>
      invoke("save_settings", settings),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["settings"] });
    },
  });

  return {
    settings: settingsQuery.data,
    isLoading: settingsQuery.isLoading,
    saveSettings: saveMutation.mutateAsync,
    isSaving: saveMutation.isPending,
    isSettingsOpen,
    setIsSettingsOpen,
  };
}
