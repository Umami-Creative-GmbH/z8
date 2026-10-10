export async function stageUpload(input: {
	batchId: string;
	tusFileKey: string;
	fileName: string;
}): Promise<void> {
	const response = await fetch("/api/upload/personnel-file/payslip-batch", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(input),
	});
	if (!response.ok) {
		const body = (await response.json().catch(() => null)) as { error?: string } | null;
		throw new Error(body?.error || "Upload failed");
	}
}
