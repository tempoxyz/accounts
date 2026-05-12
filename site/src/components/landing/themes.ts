export type ThemeAccent =
  | "blue"
  | "red"
  | "amber"
  | "green"
  | "purple"
  | "invert"
  | (string & {});

export type Scenario = {
  context: string;
  title: string;
  detail: string;
  amount: string;
  cta: string;
};

export type Theme = {
  id: string;
  name: string;
  accent: ThemeAccent;
  scheme: "light" | "dark";
  swatch: string;
  buttonText: string;
  surface: string;
  foreground: string;
  muted: string;
  scenario: Scenario;
};

export const themes: Theme[] = [
  {
    id: "tempo",
    name: "Tempo",
    accent: "invert",
    scheme: "dark",
    swatch: "#f5f5f5",
    buttonText: "#0a0a0a",
    surface: "#0f0f0f",
    foreground: "#f5f5f5",
    muted: "rgba(245,245,245,0.55)",
    scenario: {
      context: "Connect",
      title: "Continue with Tempo",
      detail: "Create a programmable account in one tap",
      amount: "Free",
      cta: "Continue",
    },
  },
  {
    id: "doordash",
    name: "DoorDash",
    accent: "#eb1700",
    scheme: "light",
    swatch: "#eb1700",
    buttonText: "#ffffff",
    surface: "#ffffff",
    foreground: "#191919",
    muted: "#6f6f6f",
    scenario: {
      context: "Checkout",
      title: "Pad Thai Express",
      detail: "1.2 mi · 25–35 min",
      amount: "$24.50",
      cta: "Pay with wallet",
    },
  },
  {
    id: "claude",
    name: "Claude",
    accent: "#d97757",
    scheme: "light",
    swatch: "#d97757",
    buttonText: "#241b15",
    surface: "#f6f0e8",
    foreground: "#2f261f",
    muted: "#7f746b",
    scenario: {
      context: "Subscribe",
      title: "Claude Pro",
      detail: "Unlimited messages · Projects",
      amount: "$20/mo",
      cta: "Subscribe",
    },
  },
  {
    id: "linear",
    name: "Linear",
    accent: "blue",
    scheme: "dark",
    swatch: "#5e6ad2",
    buttonText: "#ffffff",
    surface: "#1c1c24",
    foreground: "#f6f6f8",
    muted: "rgba(246,246,248,0.55)",
    scenario: {
      context: "Team billing",
      title: "Add a seat",
      detail: "Acme · 4 → 5 members",
      amount: "$8/mo",
      cta: "Add seat",
    },
  },
  {
    id: "vercel",
    name: "Vercel",
    accent: "invert",
    scheme: "light",
    swatch: "#000000",
    buttonText: "#ffffff",
    surface: "#ffffff",
    foreground: "#000000",
    muted: "#666666",
    scenario: {
      context: "Deploy",
      title: "Pro plan",
      detail: "More builds, analytics, priority",
      amount: "$20/mo",
      cta: "Upgrade",
    },
  },
  {
    id: "stripe",
    name: "Stripe",
    accent: "purple",
    scheme: "light",
    swatch: "#635bff",
    buttonText: "#ffffff",
    surface: "#f6f9fc",
    foreground: "#0a2540",
    muted: "#425466",
    scenario: {
      context: "Invoice",
      title: "Inv #2841 · Acme",
      detail: "Due Nov 12 · 12 line items",
      amount: "$1,840",
      cta: "Pay invoice",
    },
  },
  {
    id: "cash",
    name: "Cash",
    accent: "green",
    scheme: "light",
    swatch: "#00d64f",
    buttonText: "#001b09",
    surface: "#ffffff",
    foreground: "#031601",
    muted: "#5d6a64",
    scenario: {
      context: "Send",
      title: "Maya Park",
      detail: "@mayap · For Friday dinner",
      amount: "$42.00",
      cta: "Send",
    },
  },
  {
    id: "notion",
    name: "Notion",
    accent: "#000000",
    scheme: "light",
    swatch: "#191919",
    buttonText: "#ffffff",
    surface: "#fbfaf7",
    foreground: "#191919",
    muted: "#787774",
    scenario: {
      context: "Workspace",
      title: "Upgrade to Plus",
      detail: "Unlimited blocks · 30-day history",
      amount: "$10/editor",
      cta: "Upgrade",
    },
  },
];

export const themeById = (id: string): Theme => {
  const t = themes.find((x) => x.id === id);
  if (!t) throw new Error(`Theme not found: ${id}`);
  return t;
};
