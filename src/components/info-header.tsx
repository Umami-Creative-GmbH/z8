import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Link } from "@/navigation";
import { getTranslate } from "@/tolgee/server";

type InfoHeaderProps = {
  titleKey: string;
  titleDefault: string;
  backHref?: string;
};

export async function InfoHeader({
  titleKey,
  titleDefault,
  backHref = "/sign-in",
}: InfoHeaderProps) {
  const t = await getTranslate();

  return (
    <div className="sticky top-0 z-30 flex shrink-0 items-center gap-4 pb-6">
      <Button asChild size="icon" variant="ghost">
        <Link href={backHref}>
          <ArrowLeft className="h-4 w-4" />
          <span className="sr-only">
            {t("info.back-to-login", "Back to login")}
          </span>
        </Link>
      </Button>
      <div className="flex flex-1 flex-col items-center text-center">
        <h1 className="font-bold text-2xl">z8</h1>
        <p className="text-balance text-muted-foreground">
          {t(titleKey, titleDefault)}
        </p>
      </div>
      <div className="w-10" />
    </div>
  );
}

