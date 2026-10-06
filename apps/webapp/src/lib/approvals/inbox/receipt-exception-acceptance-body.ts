import { z } from "zod";

/**
 * Optional JSON body of an inbox approval (#604): the missing-receipt
 * exceptions of an expense report the approver explicitly accepts. Without a
 * JSON body nothing is accepted; the decision owner then refuses to approve a
 * report that has exceptions.
 */

const bodySchema = z.object({
	acceptedReceiptExceptionItemIds: z.array(z.uuid()).max(200).optional(),
});

export type ReceiptExceptionAcceptanceBody =
	| { ok: true; acceptedReceiptExceptionItemIds?: string[] }
	| { ok: false };

export async function readReceiptExceptionAcceptanceBody(request: {
	headers: Headers;
	text?: () => Promise<string>;
}): Promise<ReceiptExceptionAcceptanceBody> {
	const contentType = request.headers.get("content-type") ?? "";
	if (!contentType.includes("application/json") || !request.text) return { ok: true };
	let payload: unknown;
	try {
		const text = await request.text();
		if (!text.trim()) return { ok: true };
		payload = JSON.parse(text);
	} catch {
		return { ok: false };
	}
	const parsed = bodySchema.safeParse(payload);
	if (!parsed.success) return { ok: false };
	return parsed.data.acceptedReceiptExceptionItemIds
		? { ok: true, acceptedReceiptExceptionItemIds: parsed.data.acceptedReceiptExceptionItemIds }
		: { ok: true };
}
