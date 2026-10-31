"use client";

import dynamic from "next/dynamic";
import { AuthContentLoading } from "../shells/auth-content-loading";

// Only store app shells render this form, so its TanStack Form and zod code load in a
// separate chunk instead of the sign-in page's shared chunks.
export const StoreAppSignInForm = dynamic(
	() => import("./store-app-sign-in-form").then((mod) => mod.StoreAppSignInForm),
	{ loading: () => <AuthContentLoading /> },
);
