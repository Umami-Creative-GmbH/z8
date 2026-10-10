/**
 * The kiosk device protocol (#859), shared by the kiosk endpoints and the
 * kiosk page, so this file has no server-only imports.
 *
 * - The device pairs at `POST /api/kiosk/pair` with `{ code }` and receives
 *   `{ token, kiosk }`. It stores the token in `localStorage` under
 *   `KIOSK_TOKEN_STORAGE_KEY` and nothing else about the kiosk.
 * - Every later kiosk request sends the token in the `x-kiosk-token` header
 *   (never `Authorization: Bearer`, which Better Auth's bearer plugin consumes).
 * - A refused token is answered with 401 and `{ code }`: `kiosk_unknown` (pair
 *   again) or `kiosk_revoked` (show the revoked screen).
 */
export const KIOSK_TOKEN_HEADER = "x-kiosk-token";

export const KIOSK_TOKEN_STORAGE_KEY = "z8.kiosk.deviceToken";

export type KioskRefusalCode = "kiosk_unknown" | "kiosk_revoked";

/** What the device may show about its kiosk. */
export type KioskDeviceInfo = {
	id: string;
	name: string;
	locationId: string;
	locationName: string;
	timezone: string;
	boardEnabled: boolean;
};
