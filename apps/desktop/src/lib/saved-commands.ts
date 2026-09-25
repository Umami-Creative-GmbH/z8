import type { SavedClockCommand } from "../types";

/** Still active on this device: unsent, stopped retrying, or refused for review. */
export function isUnresolved(command: SavedClockCommand) {
  return command.state === "pending" || command.state === "stalled" || command.state === "rejected";
}

/** Blocks new clock actions in its context until the user reviews it. */
export function needsReview(command: SavedClockCommand) {
  return command.state === "stalled" || command.state === "rejected";
}

/** Saved and still sent automatically. */
export function isUnsent(command: SavedClockCommand) {
  return command.state === "pending";
}
