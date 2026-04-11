import { redirect } from "next/navigation";

export default async function TravelExpenseApprovalsPage({
	params,
}: {
	params: Promise<{ locale: string }>;
}) {
	const { locale } = await params;
	redirect(`/${locale}/approvals/inbox?types=travel_expense_claim`);
}
