import type { ReactNode } from "react";
import { cn } from "@/shared/lib/class-names.ts";

export function CenteredEmpty({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={cn("flex flex-1 items-center justify-center", className)}>{children}</div>;
}
