"use client";

import { useState } from "react";
import {
  RECEIVE_ACCOUNTS,
  type ReceiveAccountId,
  ReceiveBody,
} from "../demo/bodies/Receive";
import {
  DESTINATIONS,
  type DestinationId,
  SendBody,
} from "../demo/bodies/Send";
import { DEMO_AMOUNT_USD, shorten } from "../demo/sdk";
import { SectionFrame } from "./SectionFrame";
import { TogglePills } from "./TogglePills";
import { useTempoSession } from "./useTempoSession";

const MODES = [
  { id: "send", label: "Send" },
  { id: "receive", label: "Receive" },
] as const;

type ModeId = (typeof MODES)[number]["id"];

export default function SendReceive() {
  const [mode, setMode] = useState<ModeId>("send");
  const [destId, setDestId] = useState<DestinationId>(DESTINATIONS[0].id);
  const [receiveId, setReceiveId] = useState<ReceiveAccountId>(
    RECEIVE_ACCOUNTS[0].id,
  );
  const { status, balanceDisplay, result, run } = useTempoSession();

  const dest = DESTINATIONS.find((d) => d.id === destId) ?? DESTINATIONS[0];
  const receiveAccount =
    RECEIVE_ACCOUNTS.find((a) => a.id === receiveId) ?? RECEIVE_ACCOUNTS[0];
  const receiveIndex = RECEIVE_ACCOUNTS.findIndex((a) => a.id === receiveId);

  const onSend = () => {
    void run(async (provider) => {
      const accounts = (await provider.request({
        method: "eth_accounts",
      })) as readonly `0x${string}`[];
      const self = accounts?.[0];
      if (!self) throw new Error("No account connected.");
      const r = (await provider.request({
        method: "wallet_send",
        params: [{ to: self, value: DEMO_AMOUNT_USD }],
      } as Parameters<typeof provider.request>[0])) as
        | { receipt?: { transactionHash?: `0x${string}` } }
        | undefined;
      const tx = r?.receipt?.transactionHash;
      return { summary: tx ? `tx ${shorten(tx)}` : "Sent" };
    });
  };

  return (
    <SectionFrame
      title="Send and receive stablecoins"
      subheading="Move stablecoins like a message."
      left={
        <>
          <div className="flex flex-col gap-6">
            <TogglePills
              options={MODES}
              value={mode}
              onChange={setMode}
              label="Mode"
            />
            <ModeCode
              mode={mode}
              dest={dest}
              receiveAccount={receiveAccount}
              receiveIndex={receiveIndex}
            />
          </div>
          <div className="-mx-9 -mb-[26px] mt-auto">
            <div className="bg-[#141414] px-5 py-5">
              <div key={mode} className="flex flex-col gap-2">
                <p
                  className="text-[14px] text-white"
                  style={{
                    animation: `fadeUp 360ms cubic-bezier(0.23, 1, 0.32, 1) 0ms both`,
                  }}
                >
                  {INFO[mode].title}
                </p>
                <p
                  className="text-[12px] text-white/50"
                  style={{
                    animation: `fadeUp 360ms cubic-bezier(0.23, 1, 0.32, 1) 80ms both`,
                  }}
                >
                  {INFO[mode].description}
                </p>
              </div>
            </div>
          </div>
        </>
      }
      right={
        mode === "send" ? (
          <SendBody
            status={status}
            result={result}
            onAction={onSend}
            delay={120}
            adapter="tempoAuth"
            lastVariant={null}
            connectedBalance={balanceDisplay}
            selectedId={destId}
            onSelect={setDestId}
          />
        ) : (
          <ReceiveBody
            selectedId={receiveId}
            onSelect={setReceiveId}
            delay={120}
          />
        )
      }
    />
  );
}

const INFO: Record<ModeId, { title: string; description: string }> = {
  send: {
    title: "Send",
    description:
      "Pay any address with wallet_send. Tempo handles routing, gas sponsorship, and confirmation — your app just signs.",
  },
  receive: {
    title: "Receive",
    description:
      "Share the account address (or a QR) to accept payments. Funds settle directly into the user's account — no webhooks to wire.",
  },
};

/* ─── Syntax tokens (mono color palette matches the adapter section) ─── */

const Keyword = ({ children }: { children: React.ReactNode }) => (
  <span style={{ color: "#f47066" }}>{children}</span>
);
const Str = ({ children }: { children: React.ReactNode }) => (
  <span style={{ color: "#96d0ff" }}>{children}</span>
);
const Fn = ({ children }: { children: React.ReactNode }) => (
  <span style={{ color: "#dcbdfb" }}>{children}</span>
);
const Var = ({ children }: { children: React.ReactNode }) => (
  <span style={{ color: "#6db6ff" }}>{children}</span>
);
const Cmnt = ({ children }: { children: React.ReactNode }) => (
  <span style={{ color: "#7d8590" }}>{children}</span>
);
const Hl = ({ children }: { children: React.ReactNode }) => (
  <span
    className="hl-token rounded-[4px] px-[5px]"
    style={{
      background: "rgba(255, 255, 255, 0.12)",
      boxShadow: "inset 0 0 0 1px rgba(255, 255, 255, 0.2)",
      animation: `highlightFlash 900ms cubic-bezier(0.23, 1, 0.32, 1) both`,
    }}
  >
    {children}
  </span>
);

type Destination = (typeof DESTINATIONS)[number];
type ReceiveAccount = (typeof RECEIVE_ACCOUNTS)[number];

function ModeCode({
  mode,
  dest,
  receiveAccount,
  receiveIndex,
}: {
  mode: ModeId;
  dest: Destination;
  receiveAccount: ReceiveAccount;
  receiveIndex: number;
}) {
  return (
    <pre
      key={mode}
      className="code-pre scrollbar-hide max-h-[320px] overflow-auto font-mono text-[15px] leading-[1.5] text-[#adbac7]"
      style={{
        tabSize: 2,
        animation: `fadeUp 360ms cubic-bezier(0.23, 1, 0.32, 1) 0ms both`,
      }}
    >
      <code>
        {mode === "send" ? <SendSnippet dest={dest} /> : null}
        {mode === "receive" ? (
          <ReceiveSnippet account={receiveAccount} index={receiveIndex} />
        ) : null}
      </code>
    </pre>
  );
}

function SendSnippet({ dest }: { dest: Destination }) {
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
        <Var>receipt</Var>
        {" } = "}
        <Keyword>await</Keyword> <Var>provider</Var>.<Fn>request</Fn>
        {"({"}
      </div>
      <div>
        {"  method: "}
        <Str>{`'wallet_send'`}</Str>
        {","}
      </div>
      <div>{"  params: [{"}</div>
      <div>
        {"    to: "}
        <Hl key={`to-${dest.id}`}>
          <Str>{`'${shorten(dest.address)}'`}</Str>
        </Hl>
        {",   "}
        <Cmnt key={`cmnt-${dest.id}`}>{`// ${dest.label}`}</Cmnt>
      </div>
      <div>
        {"    value: "}
        <Str>{`'0.01'`}</Str>
        {",          "}
        <Cmnt>{"// USD"}</Cmnt>
      </div>
      <div>{"  }],"}</div>
      <div>{"})"}</div>
      <div>{" "}</div>
      <div>
        <Var>receipt</Var>.<Var>transactionHash</Var>{" "}
        <Cmnt>{"// → 0xabc…f00d"}</Cmnt>
      </div>
    </>
  );
}

function ReceiveSnippet({
  account,
  index,
}: {
  account: ReceiveAccount;
  index: number;
}) {
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
        <Str>{`'eth_accounts'`}</Str>
        {","}
      </div>
      <div>{"})"}</div>
      <div>{" "}</div>
      <div>
        <Keyword>const</Keyword> {"["}
        <Var>balance</Var>
        {"] = "}
        <Keyword>await</Keyword> <Var>provider</Var>.<Fn>request</Fn>
        {"({"}
      </div>
      <div>
        {"  method: "}
        <Str>{`'wallet_getBalances'`}</Str>
        {","}
      </div>
      <div>
        {"  params: [{ account: "}
        <Hl key={`acc-${account.id}`}>
          <Var>accounts</Var>
          {"["}
          <span style={{ color: "#f0a868" }}>{index}</span>
          {"]"}
        </Hl>
        {" "}
        <Cmnt key={`cmnt-${account.id}`}>{`/* ${account.label} */`}</Cmnt>
        {" }],"}
      </div>
      <div>{"})"}</div>
      <div>
        <Var>balance</Var>.<Var>display</Var> <Cmnt>{"// → $1,247.32"}</Cmnt>
      </div>
    </>
  );
}
