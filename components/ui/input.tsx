import * as React from "react";

import { cn } from "@/lib/utils";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "flex h-10 w-full rounded-md border border-neutral-200 bg-white px-3 py-2 text-base shadow-sm transition-colors outline-none placeholder:text-neutral-500 focus-visible:border-neutral-950 focus-visible:ring-2 focus-visible:ring-neutral-950/15 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
