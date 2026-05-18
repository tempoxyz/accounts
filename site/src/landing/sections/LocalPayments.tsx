"use client";

import { useState } from "react";
import {
  DEPOSIT_AMOUNTS,
  type DepositAmountId,
  LocalPaymentsBody,
} from "../demo/bodies/LocalPayments";
import { SectionFrame } from "./SectionFrame";
import { TogglePills } from "./TogglePills";
import { useTempoSession } from "./useTempoSession";

const METHODS = [
  { id: "apple-pay", label: "Apple Pay" },
  { id: "card", label: "Card" },
  { id: "sepa", label: "SEPA" },
  { id: "crypto", label: "Crypto" },
] as const;

type MethodId = (typeof METHODS)[number]["id"];

const INFO: Record<MethodId, { title: string; description: string }> = {
  "apple-pay": {
    title: "Apple Pay",
    description:
      "Tap-to-pay deposits via Stripe. Funds settle into the account within seconds.",
  },
  card: {
    title: "Cards",
    description:
      "Visa, Mastercard, and AmEx via Stripe. 3DS challenges handled inside the wallet.",
  },
  sepa: {
    title: "SEPA",
    description:
      "EU bank transfers with IBAN. Funds typically arrive in one business day.",
  },
  crypto: {
    title: "Crypto",
    description:
      "Deposit USDC, ETH, or any supported stablecoin from another chain — bridged automatically.",
  },
};

export default function LocalPayments() {
  const [method, setMethod] = useState<MethodId>("apple-pay");
  const [amountId, setAmountId] = useState<DepositAmountId>("50");
  const { status, balanceDisplay, result, run } = useTempoSession();

  const amount =
    DEPOSIT_AMOUNTS.find((a) => a.id === amountId) ?? DEPOSIT_AMOUNTS[0];

  const onAction = () => {
    void run(async (provider) => {
      await provider.request({
        method: "wallet_deposit",
        params: [{ value: amount.id }],
      } as Parameters<typeof provider.request>[0]);
      return { summary: "Deposit dialog opened" };
    });
  };

  return (
    <SectionFrame
      title="Connect to local payment methods"
      subheading="Add funds the way your users already pay. Integrated local payment options such as Apple Pay, cards, bank transfers, and crypto."
      left={
        <>
          <div className="flex flex-col gap-6">
            <TogglePills
              options={METHODS}
              value={method}
              onChange={setMethod}
              label="Method"
            />
            <DepositCode amount={amount.id} />
          </div>
          <div className="-mx-9 -mb-[26px] mt-auto">
            <div className="bg-panel-1 px-5 py-5">
              <div key={method} className="flex flex-col gap-2">
                <p
                  className="text-[14px] text-foreground"
                  style={{
                    animation: `fadeUp 360ms cubic-bezier(0.23, 1, 0.32, 1) 0ms both`,
                  }}
                >
                  {INFO[method].title}
                </p>
                <p
                  className="text-[12px] text-foreground-muted"
                  style={{
                    animation: `fadeUp 360ms cubic-bezier(0.23, 1, 0.32, 1) 80ms both`,
                  }}
                >
                  {INFO[method].description}
                </p>
              </div>
            </div>
          </div>
        </>
      }
      right={
        <LocalPaymentsBody
          status={status}
          result={result}
          onAction={onAction}
          delay={120}
          adapter="tempoAuth"
          lastVariant={null}
          connectedBalance={balanceDisplay}
          selectedAmountId={amountId}
          onSelectAmount={setAmountId}
          methodLabel={INFO[method].title}
        />
      }
    />
  );
}

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
const Cmnt = ({ children }: { children: React.ReactNode }) => (
  <span style={{ color: "var(--syn-muted)" }}>{children}</span>
);
const Hl = ({ children }: { children: React.ReactNode }) => (
  <span
    className="hl-token rounded-[4px] px-[5px]"
    style={{
      animation: `highlightFlash 900ms cubic-bezier(0.23, 1, 0.32, 1) both`,
    }}
  >
    {children}
  </span>
);

function DepositCode({ amount }: { amount: DepositAmountId }) {
  return (
    <pre
      className="code-pre scrollbar-hide max-h-[320px] overflow-auto font-mono text-[15px] leading-[1.5] text-code"
      style={{
        tabSize: 2,
        animation: `fadeUp 360ms cubic-bezier(0.23, 1, 0.32, 1) 0ms both`,
      }}
    >
      <code>
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
          <Keyword>await</Keyword> <Var>provider</Var>.<Fn>request</Fn>
          {"({"}
        </div>
        <div>
          {"  method: "}
          <Str>{`'wallet_deposit'`}</Str>
          {","}
        </div>
        <div>{"  params: [{"}</div>
        <div>
          {"    value: "}
          <Hl key={`val-${amount}`}>
            <Str>{`'${amount}'`}</Str>
          </Hl>
          {",          "}
          <Cmnt>{"// USD"}</Cmnt>
        </div>
        <div>{"  }],"}</div>
        <div>{"})"}</div>
        <div>{" "}</div>
        <div>
          <Cmnt>{"// The wallet surfaces Apple Pay, cards,"}</Cmnt>
        </div>
        <div>
          <Cmnt>{"// SEPA, and crypto — user picks at deposit."}</Cmnt>
        </div>
      </code>
    </pre>
  );
}
