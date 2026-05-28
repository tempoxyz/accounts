"use client";

import type { CSSProperties } from "react";
import type { DemoPreludeMessage } from "../types";

export function ChatBubble({
  message,
  style,
}: {
  message: DemoPreludeMessage;
  style?: CSSProperties | undefined;
}) {
  return (
    <div
      data-demo-message
      className="max-w-full bg-panel-2 px-3 py-2"
      style={style}
    >
      <p className="text-[14px] break-words text-foreground sm:whitespace-nowrap">
        {typeof message === "string" ? (
          message
        ) : (
          <>
            {message.before}
            <a
              href={message.href}
              target="_blank"
              rel="noreferrer"
              className="underline decoration-foreground-subtle underline-offset-3 outline-none hover:text-foreground focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-info focus-visible:outline-offset-2"
            >
              {message.label}
            </a>
            {message.after}
          </>
        )}
      </p>
    </div>
  );
}
