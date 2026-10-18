import { connection, NextResponse } from "next/server";
import { downloadPayrollComparison } from "@/lib/payroll-export/comparison-service";

const headers = {
	"Cache-Control": "private, no-store",
	"X-Content-Type-Options": "nosniff",
};
export async function GET(
	_request: Request,
	{ params }: { params: Promise<{ resultId: string }> },
) {
	await connection();
	try {
		const { resultId } = await params;
		const file = await downloadPayrollComparison(resultId);
		if (!file)
			return NextResponse.json(
				{ error: "Comparison unavailable or expired. Refresh the comparison." },
				{ status: 404, headers },
			);
		return new Response(file.content, {
			headers: {
				...headers,
				"Content-Type": "text/csv; charset=utf-8",
				"Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
			},
		});
	} catch {
		return NextResponse.json(
			{ error: "Comparison unavailable. Refresh the comparison." },
			{ status: 404, headers },
		);
	}
}
