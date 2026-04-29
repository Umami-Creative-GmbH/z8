import { connection } from "next/server";
import { NoEmployeeError } from "@/components/errors/no-employee-error";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { getTranslate } from "@/tolgee/server";
import { getMyRequests } from "./actions";
import { MyRequestsClient } from "./my-requests-client";

export default async function MyRequestsPage() {
	await connection();

	const [t, result] = await Promise.all([getTranslate(), getMyRequests()]);

	if (!result.success && result.error === "Employee profile not found") {
		return (
			<div className="@container/main flex flex-1 items-center justify-center p-6">
				<NoEmployeeError feature={t("myRequests.featureName", "view your requests")} />
			</div>
		);
	}

	if (!result.success) {
		return (
			<div className="@container/main flex flex-1 flex-col gap-6 p-4 md:p-6">
				<Alert variant="destructive">
					<AlertTitle>{t("myRequests.unavailableTitle", "Requests unavailable")}</AlertTitle>
					<AlertDescription>{result.error}</AlertDescription>
				</Alert>
			</div>
		);
	}

	return <MyRequestsClient initialResult={result.data} />;
}
