"use client";

import { useState } from "react";
import { LogInBody } from "../demo/bodies/LogIn";
import { connectWallet, shorten } from "../demo/sdk";
import { SectionFrame } from "./SectionFrame";
import { TogglePills } from "./TogglePills";
import { useTempoSession } from "./useTempoSession";

const LIFECYCLE = [
  { id: "connect", label: "Connect" },
  { id: "authorize", label: "Authorize" },
  { id: "disconnect", label: "Disconnect" },
] as const;

type LifecycleId = (typeof LIFECYCLE)[number]["id"];

const noop = () => undefined;

export default function Accounts() {
  const [action, setAction] = useState<LifecycleId>("connect");
  const { status, address, result, run } = useTempoSession();

  // The Accounts demo IS about sign-in, so a hydrated session should
  // render as "done" (so the LogInBody CTA shows "Signed in · 0x…"
  // instead of "Continue with Tempo"). `useTempoSession` no longer
  // sets status on hydration, so derive it here.
  const displayStatus = status === "idle" && address ? "done" : status;

  const onSignIn = () => {
    void run(async (provider) => {
      const address = await connectWallet(provider);
      return {
        summary: address ? `Signed in · ${shorten(address)}` : "Signed in",
      };
    });
  };

  return (
    <SectionFrame
      title="Create and manage stablecoin accounts"
      subheading="Open a stablecoin account in seconds. Hold balances, move money, and authorize sessions — all with one passkey."
      left={
        <>
          <div className="flex flex-col gap-6">
            <TogglePills
              options={LIFECYCLE}
              value={action}
              onChange={setAction}
              label="Lifecycle"
            />
            <LifecycleCode action={action} />
          </div>
          <div className="-mx-9 -mb-[26px] mt-auto">
            <div className="bg-panel-1 px-5 py-5">
              <div key={action} className="flex flex-col gap-2">
                <p
                  className="text-[14px] text-foreground"
                  style={{
                    animation: `fadeUp 360ms cubic-bezier(0.23, 1, 0.32, 1) 0ms both`,
                  }}
                >
                  {INFO[action].title}
                </p>
                <p
                  className="text-[12px] text-foreground-muted"
                  style={{
                    animation: `fadeUp 360ms cubic-bezier(0.23, 1, 0.32, 1) 80ms both`,
                  }}
                >
                  {INFO[action].description}
                </p>
              </div>
            </div>
          </div>
        </>
      }
      right={
        <LogInBody
          status={displayStatus}
          result={result}
          onAction={onSignIn}
          delay={120}
          adapter="tempoAuth"
          lastVariant={null}
          connectedBalance={null}
          onNextDemo={noop}
          setupStatus="idle"
          setupError={null}
          needsFunding={false}
          onSetupConnect={noop}
          onSetupFund={noop}
        />
      }
    />
  );
}

const INFO: Record<LifecycleId, { title: string; description: string }> = {
  connect: {
    title: "Connect",
    description:
      "Open the wallet — create the user's stablecoin account on first sign-in, or load an existing one.",
  },
  authorize: {
    title: "Authorize a session",
    description:
      "Co-sign a scoped session key so follow-up payments settle without re-prompting the passkey, within the limits you set.",
  },
  disconnect: {
    title: "Disconnect",
    description:
      "End the session and revoke the access key. The wallet keeps the account; the app forgets it.",
  },
};

/* ─── Syntax tokens (mono color palette matches the adapter section) ─── */

const Keyword = ({ children }: { children: React.ReactNode }) => (
  <span style={{ color: "var(--syn-red)" }}>{children}</span>
);
const Str = ({ children }: { children: React.ReactNode }) => (
  <span style={{ color: "var(--syn-blue)" }}>{children}</span>
);
const Fn = ({ children }: { children: React.ReactNode }) => (
  <span style={{ color: "var(--syn-purple)" }}>{children}</span>
);
const Var = ({ children }: { children: React.ReactNode }) => (
  <span style={{ color: "var(--syn-cyan)" }}>{children}</span>
);
const Num = ({ children }: { children: React.ReactNode }) => (
  <span style={{ color: "var(--syn-orange)" }}>{children}</span>
);
const Cmnt = ({ children }: { children: React.ReactNode }) => (
  <span style={{ color: "var(--syn-muted)" }}>{children}</span>
);

function LifecycleCode({ action }: { action: LifecycleId }) {
  return (
    <pre
      key={action}
      className="code-pre overflow-x-auto font-mono text-[15px] leading-[1.5] text-code"
      style={{
        tabSize: 2,
        animation: `fadeUp 360ms cubic-bezier(0.23, 1, 0.32, 1) 0ms both`,
      }}
    >
      <code>
        {action === "connect" ? <ConnectSnippet /> : null}
        {action === "authorize" ? <AuthorizeSnippet /> : null}
        {action === "disconnect" ? <DisconnectSnippet /> : null}
      </code>
    </pre>
  );
}

function ConnectSnippet() {
  return (
    <>
      <div>
        <Keyword>import</Keyword> {"{ Provider } "}
        <Keyword>from</Keyword> <Str>{`'accounts'`}</Str>
      </div>
      <div>{" "}</div>
      <div>
        <Keyword>const</Keyword> <Var>provider</Var> <Keyword>=</Keyword>{" "}
        <Var>Provider</Var>.<Fn>create</Fn>()
      </div>
      <div>{" "}</div>
      <div>
        <Keyword>const</Keyword> {"{ "}
        <Var>accounts</Var>
        {" } = "}
        <Keyword>await</Keyword> <Var>provider</Var>.<Fn>request</Fn>
        {"({"}
      </div>
      <div>
        {"  method: "}
        <Str>{`'wallet_connect'`}</Str>
        {","}
      </div>
      <div>{"})"}</div>
    </>
  );
}

function AuthorizeSnippet() {
  return (
    <>
      <div>
        <Keyword>await</Keyword> <Var>provider</Var>.<Fn>request</Fn>
        {"({"}
      </div>
      <div>
        {"  method: "}
        <Str>{`'wallet_authorizeAccessKey'`}</Str>
        {","}
      </div>
      <div>{"  params: [{"}</div>
      <div>
        {"    expiry: "}
        <Var>Math</Var>.<Fn>floor</Fn>({"Date."}
        <Fn>now</Fn>
        {"() / "}
        <Num>1000</Num>
        {") + "}
        <Num>86_400</Num>
        {","}
      </div>
      <div>{"    limits: [{"}</div>
      <div>
        {"      token: "}
        <Var>PATH_USD</Var>
        {","}
      </div>
      <div>
        {"      limit: "}
        <Num>5_000_000n</Num>
        {",   "}
        <Cmnt>{"// $5"}</Cmnt>
      </div>
      <div>
        {"      period: "}
        <Num>3_600</Num>
        {",       "}
        <Cmnt>{"// per hour"}</Cmnt>
      </div>
      <div>{"    }],"}</div>
      <div>{"  }],"}</div>
      <div>{"})"}</div>
    </>
  );
}

function DisconnectSnippet() {
  return (
    <>
      <div>
        <Keyword>await</Keyword> <Var>provider</Var>.<Fn>request</Fn>
        {"({"}
      </div>
      <div>
        {"  method: "}
        <Str>{`'wallet_disconnect'`}</Str>
        {","}
      </div>
      <div>{"})"}</div>
      <div>{" "}</div>
      <div>
        <Cmnt>{"// Subsequent eth_accounts returns []"}</Cmnt>
      </div>
      <div>
        <Cmnt>{"// until the user reconnects."}</Cmnt>
      </div>
    </>
  );
}
