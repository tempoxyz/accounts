"use client";

import { type ComponentType, useCallback, useEffect, useState } from "react";

type DemoModule = {
  default: ComponentType;
};

function DemoPlaceholder() {
  return (
    <section
      aria-hidden="true"
      className="relative px-6 pt-2 pb-12 sm:pt-4 sm:pb-20"
    >
      <div className="relative z-10 mx-auto w-full max-w-[1089px] border border-panel-3 bg-background/75 backdrop-blur-sm">
        <div className="m-3 mb-0 flex flex-wrap items-center justify-between gap-2 bg-panel-deep p-3 sm:m-[27px] sm:gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="block h-[15px] w-3 bg-panel-5" />
            <span className="block h-3 w-44 max-w-[48vw] bg-panel-5 sm:w-64" />
          </div>
          <div className="flex min-w-[148px] items-center justify-end gap-2 sm:min-w-[260px]">
            <span className="size-1.5 rounded-full bg-foreground-subtle" />
            <span className="block h-3 w-24 bg-panel-5" />
          </div>
        </div>
        <div className="grid min-h-[420px] grid-cols-1 sm:min-h-[510px] sm:grid-cols-[260px_1fr]">
          <div className="hidden border-r border-panel-border sm:block">
            <div className="flex h-full flex-col justify-between py-4">
              {Array.from({ length: 6 }).map((_, index) => (
                <span
                  key={index}
                  className="mx-4 block h-10 bg-panel-5"
                  style={{ opacity: 1 - index * 0.08 }}
                />
              ))}
            </div>
          </div>
          <div className="flex min-h-[420px] flex-col gap-4 px-4 pt-4 pb-6 sm:min-h-[510px] sm:px-[27px] sm:pt-[27px]">
            <span className="block h-12 w-3/4 bg-panel-5" />
            <span className="ml-auto block h-12 w-2/3 bg-panel-5" />
            <span className="block h-28 w-full bg-panel-5" />
          </div>
        </div>
      </div>
    </section>
  );
}

export default function DeferredDemo() {
  const [Demo, setDemo] = useState<ComponentType | null>(null);

  const load = useCallback(() => {
    void import("./demo/Demo").then((mod: DemoModule) => {
      setDemo(() => mod.default);
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    let loaded = false;
    let timeoutHandle: number | undefined;

    function cleanup() {
      if (timeoutHandle !== undefined) window.clearTimeout(timeoutHandle);
    }

    function loadAfterIdle() {
      if (loaded) return;
      loaded = true;
      cleanup();
      void import("./demo/Demo").then((mod: DemoModule) => {
        if (!cancelled) setDemo(() => mod.default);
      });
    }

    timeoutHandle = window.setTimeout(loadAfterIdle, 8000);

    return () => {
      cancelled = true;
      cleanup();
    };
  }, []);

  return Demo ? (
    <Demo />
  ) : (
    <div onPointerDown={load}>
      <DemoPlaceholder />
    </div>
  );
}
