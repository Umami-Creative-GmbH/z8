import { WifiOff, CloudOff } from "lucide-react";

interface OfflineBannerProps {
  queueLength: number;
}

export function OfflineBanner({ queueLength }: OfflineBannerProps) {
  return (
    <div
      className="bg-amber-50 border-b border-amber-100 px-3 py-2 flex items-center gap-2"
      role="status"
      aria-live="polite"
    >
      <WifiOff className="w-4 h-4 text-amber-600 flex-shrink-0" aria-hidden="true" />
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium text-amber-800">You're offline</p>
        {queueLength > 0 && (
          <p className="text-xs text-amber-600">
            {queueLength} action{queueLength > 1 ? "s" : ""} will sync when online
          </p>
        )}
      </div>
      <CloudOff className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" aria-hidden="true" />
    </div>
  );
}
