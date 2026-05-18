"use client";

const easeOut = "cubic-bezier(0.23, 1, 0.32, 1)";

export function ChatBubble({
  text,
  delay,
}: {
  text: string;
  delay: number;
}) {
  return (
    <div
      className="max-w-full bg-panel-2 px-3 py-2"
      style={{ animation: `fadeUp 480ms ${easeOut} ${delay}ms both` }}
    >
      <p className="text-[14px] break-words text-foreground sm:text-[16px] sm:whitespace-nowrap">
        {text}
      </p>
    </div>
  );
}
