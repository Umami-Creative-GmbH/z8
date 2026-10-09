import { createLogger } from "@/lib/logger";

export const logger = createLogger("TimeTrackingActionsEffect");

export const DEFAULT_TIMEZONE = "UTC";
export const ONE_MINUTE_MS = 60_000;
