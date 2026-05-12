import type { DemoBodyProps } from "../types";
import { PrimaryButton, SecondaryButton, bodyAnimation } from "./shared";

export function ReadAndWriteBody({
  status,
  result,
  onAction,
  lastVariant,
  delay,
}: DemoBodyProps) {
  // result.summary stores the most recent action's payload.
  // lastVariant tells us which button was pressed: "read" or "write".
  const isReadRunning = status === "running" && lastVariant === "read";
  const isWriteRunning = status === "running" && lastVariant === "write";
  const readDone = status === "done" && lastVariant === "read";
  const writeDone = status === "done" && lastVariant === "write";
  const readSummary = readDone ? result?.summary ?? null : null;

  return (
    <div
      className="flex w-full max-w-[460px] flex-col gap-3 bg-[#181818] p-6"
      style={bodyAnimation(delay)}
    >
      <div className="flex flex-col gap-2 border-b border-white/5 pb-4">
        <p className="text-[12px] text-white/50">Read · SIWE</p>
        {readSummary ? (
          <p className="font-mono text-[13px] text-white">{readSummary}</p>
        ) : (
          <p className="text-[14px] text-white/70">
            Sign with Ethereum to read your usage.
          </p>
        )}
        <SecondaryButton
          label={
            isReadRunning
              ? "Signing…"
              : readDone
                ? "Read again"
                : "Sign to read"
          }
          status={isReadRunning ? "running" : "idle"}
          onClick={() => onAction("read")}
          className="w-full"
        />
      </div>

      <div className="flex flex-col gap-2 pt-2">
        <p className="text-[12px] text-white/50">Write · onchain action</p>
        <p className="text-[14px] text-white/70">
          Save your preference onchain.
        </p>
        <PrimaryButton
          label={
            isWriteRunning
              ? "Saving…"
              : writeDone
                ? "Saved · " + (result?.summary ?? "")
                : "Save preference"
          }
          status={isWriteRunning ? "running" : "idle"}
          onClick={() => onAction("write")}
          className="h-10 w-full"
        />
      </div>
    </div>
  );
}
