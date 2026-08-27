import * as generatedAuthSchema from "@/db/auth-schema";
import * as applicationSchema from "@/db/schema";

export const authDatabaseSchema = {
	...applicationSchema,
	...generatedAuthSchema,
};
