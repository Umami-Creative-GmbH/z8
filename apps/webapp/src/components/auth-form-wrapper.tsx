"use client";

import Image from "next/image";
import bgImage from "@/../public/ally-griffin-3hsrEvJi_gw-unsplash.jpg";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import QuoteBox from "./ui/quote-box";

interface AuthFormWrapperProps extends React.ComponentProps<"div"> {
  title: string;
  children: React.ReactNode;
  formProps?: React.ComponentProps<"form">;
}

export function AuthFormWrapper({
  title,
  children,
  className,
  formProps,
  ...props
}: AuthFormWrapperProps) {
  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      <Card className="overflow-hidden p-0">
        <CardContent className="relative p-0">
          <form
            className="relative z-20 w-full p-6 md:w-1/2 md:p-8"
            {...formProps}
          >
            <div className="flex flex-col gap-6">
              <div className="flex flex-col items-center text-center">
                <h1 className="font-bold text-2xl">z8</h1>
                <p className="text-balance text-muted-foreground">{title}</p>
              </div>
              {children}
            </div>
          </form>
          <div className="absolute inset-0 z-10 bg-muted">
            <Image
              alt="Background Image - Foto von Ally Griffin auf Unsplash"
              fill
              placeholder="blur"
              quality={75}
              sizes="100vw"
              src={bgImage}
              style={{
                objectFit: "cover",
              }}
            />
            <div className="hidden md:block">
              <QuoteBox />
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
