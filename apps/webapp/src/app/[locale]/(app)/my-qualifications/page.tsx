import { redirect } from "next/navigation";
import { connection } from "next/server";
import { NoEmployeeError } from "@/components/errors/no-employee-error";
import { getMyQualifications } from "./actions";
import { MyQualificationsClient } from "./my-qualifications-client";

export default async function MyQualificationsPage() {
	await connection();

	const result = await getMyQualifications();
	if (!result.success) {
		if (result.error === "Employee profile not found") {
			return (
				<div className="@container/main flex flex-1 items-center justify-center p-6">
					<NoEmployeeError feature="view your qualifications" />
				</div>
			);
		}

		redirect("/");
	}

	return <MyQualificationsClient qualifications={result.data} />;
}
