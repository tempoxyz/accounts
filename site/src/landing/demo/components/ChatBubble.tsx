"use client";

import type { CSSProperties } from "react";

export function ChatBubble({
  text,
  style,
}: {
  text: string;
  style?: CSSProperties | undefined;
}) {
  return (
    <div
      data-demo-message
      className="max-w-full bg-panel-2 px-3 py-2"
      style={style}
    >
      <p className="text-[14px] break-words text-foreground sm:text-[16px] sm:whitespace-nowrap">
        {text}
      </p>
    </div>
  );
}
