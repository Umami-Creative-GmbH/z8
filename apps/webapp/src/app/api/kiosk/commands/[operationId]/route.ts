import { kioskFrozenCommandService } from "@/lib/time-tracking/kiosk/kiosk-frozen-commands";

/**
 * What became of a frozen kiosk command this kiosk sent (#1289), for recovery
 * after a lost answer. See `KioskFrozenCommandLookup`.
 */
export async function GET(request: Request, context: { params: Promise<{ operationId: string }> }) {
	const { operationId } = await context.params;
	return kioskFrozenCommandService.lookup(request, operationId);
}
