/**
 * Approval Center Initialization
 *
 * Registers all approval type handlers at startup.
 * Import this file in your app entry point to ensure handlers are registered.
 */

import { registerApprovalHandler } from "./domain/registry";
import { AbsenceRequestHandler, TimeCorrectionHandler } from "./handlers";

/**
 * Initialize the approval center by registering all handlers.
 * Call this once at application startup.
 */
export function initializeApprovalCenter(): void {
	// Register built-in handlers
	registerApprovalHandler(AbsenceRequestHandler);
	registerApprovalHandler(TimeCorrectionHandler);

	// Future handlers can be registered here:
	// registerApprovalHandler(ShiftRequestHandler);
}

// Auto-initialize on import
initializeApprovalCenter();
