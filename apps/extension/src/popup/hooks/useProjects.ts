import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

export function useProjects(enabled: boolean = true) {
  return useQuery({
    queryKey: ["projects"],
    queryFn: () => api.getProjects(),
    staleTime: 5 * 60 * 1000,
    enabled,
  });
}
