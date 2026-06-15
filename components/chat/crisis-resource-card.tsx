"use client";

import { ChevronDown, ChevronUp, LifeBuoy, Phone } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function CrisisResourceCard({
  collapsed,
  onToggle,
}: {
  collapsed: boolean;
  onToggle: () => void;
}) {
  return (
    <section
      className={cn(
        "shrink-0 border-b border-rose-200 bg-rose-50 px-3 py-3 text-rose-950 sm:px-6",
        collapsed ? "py-2" : "py-3",
      )}
    >
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <LifeBuoy className="size-5 text-rose-700" />
            <h2 className="text-sm font-semibold">求助资源</h2>
          </div>
          <Button
            aria-label={collapsed ? "展开求助资源卡" : "收起求助资源卡"}
            className="h-8 rounded-full px-3 text-rose-900 hover:bg-rose-100"
            onClick={onToggle}
            size="sm"
            type="button"
            variant="ghost"
          >
            {collapsed ? (
              <>
                展开
                <ChevronDown className="size-4" />
              </>
            ) : (
              <>
                收起
                <ChevronUp className="size-4" />
              </>
            )}
          </Button>
        </div>

        {!collapsed ? (
          <div className="rounded-lg border border-rose-200 bg-white px-4 py-3 shadow-sm">
            <p className="text-sm leading-6 text-neutral-800">
              你现在的难受是真的,你值得被好好对待。如果撑不住,可以找人说说——他们是真人,会听你。
            </p>

            <div className="mt-3 grid gap-2 text-sm text-neutral-900">
              <ResourceLine label="全国心理援助热线" value="400-161-9995(24小时)" />
              <ResourceLine label="北京心理危机研究与干预中心" value="010-82951332" />
              <ResourceLine label="紧急情况请拨打" value="120" />
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function ResourceLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-md bg-rose-50 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
      <span className="font-medium">{label}</span>
      <span className="flex items-center gap-2 font-semibold">
        <Phone className="size-4 text-rose-700" />
        {value}
      </span>
    </div>
  );
}
