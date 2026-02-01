import { Loader2 } from "lucide-react";

export function Loading() {
  return (
    <div
      className="flex flex-col items-center justify-center py-8"
      role="status"
      aria-live="polite"
    >
      <Loader2 className="w-8 h-8 text-emerald-500 animate-spin" aria-hidden="true" />
      <p className="text-xs text-gray-500 mt-2">Loading…</p>
    </div>
  );
}
