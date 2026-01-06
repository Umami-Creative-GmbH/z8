"use client";

import { useLocale } from "next-intl";
import { useTransition } from "react";
import { usePathname, useRouter } from "@/navigation";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ALL_LANGUAGES } from "@/tolgee/shared";

const LANGUAGE_NAMES: Record<string, string> = {
  de: "Deutsch",
  en: "English",
};

export function LanguageSwitcher() {
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();

  const handleLanguageChange = (newLocale: string) => {
    startTransition(() => {
      router.replace(pathname, { locale: newLocale });
    });
  };

  return (
    <Select
      value={locale}
      onValueChange={handleLanguageChange}
      disabled={isPending}
    >
      <SelectTrigger className="w-[140px]">
        <SelectValue placeholder="Select language" />
      </SelectTrigger>
      <SelectContent>
        {ALL_LANGUAGES.map((lang) => (
          <SelectItem key={lang} value={lang}>
            {LANGUAGE_NAMES[lang] || lang}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

