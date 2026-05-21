const easeOut = "cubic-bezier(0.23, 1, 0.32, 1)";

// Tailwind v4 wasn't picking up the custom `.dash-tl` / `.dash-frame`
// utilities from globals.css, so we inline the dash background-images
// here. Reads `--dash-color/length/gap/thickness` from :root so the
// design-token controls still apply.
const HORIZONTAL_DASH = `repeating-linear-gradient(
  to right,
  var(--dash-color) 0 var(--dash-length),
  transparent var(--dash-length) calc(var(--dash-length) + var(--dash-gap))
)`;
const VERTICAL_DASH = `repeating-linear-gradient(
  to bottom,
  var(--dash-color) 0 var(--dash-length),
  transparent var(--dash-length) calc(var(--dash-length) + var(--dash-gap))
)`;

const cardDashStyle: React.CSSProperties = {
  backgroundImage: `${HORIZONTAL_DASH}, ${VERTICAL_DASH}`,
  backgroundSize:
    "100% var(--dash-thickness), var(--dash-thickness) 100%",
  backgroundPosition: "top left, top left",
  backgroundRepeat: "no-repeat",
};

// Only paint the bottom + right of the outer frame. The cards already
// contribute the top and left edges via `cardDashStyle`, so painting
// them again here would double-up (visually fine in dark mode where
// `--dash-color` is solid `#222`, but in light mode it's
// `rgba(0,0,0,0.18)` and two overlapping lines alpha-blend to a
// noticeably darker stroke than the rest of the page).
const frameDashStyle: React.CSSProperties = {
  backgroundImage: `${HORIZONTAL_DASH}, ${VERTICAL_DASH}`,
  backgroundSize:
    "100% var(--dash-thickness), var(--dash-thickness) 100%",
  backgroundPosition: "bottom left, top right",
  backgroundRepeat: "no-repeat",
};

type Guide = {
  title: string;
  href: string;
};

const GUIDES: readonly Guide[] = [
  {
    title: "Getting Started",
    href: "/docs",
  },
  {
    title: "Authentication",
    href: "/docs/guides/connect-accounts",
  },
  {
    title: "Deposits",
    href: "/docs/guides/deposits",
  },
  {
    title: "Transfers",
    href: "/docs/guides/transfers",
  },
  {
    title: "Spend Permissions",
    href: "/docs/guides/spend-permissions",
  },
  {
    title: "Subscriptions",
    href: "/docs/guides/subscriptions",
  },
  {
    title: "Fee Sponsorship",
    href: "/docs/guides/fee-sponsorship",
  },
  {
    title: "Exchange Currencies",
    href: "/docs/guides/swaps",
  },
  {
    title: "Themes",
    href: "/docs/guides/theming",
  },
];

function ArrowUpRight() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
      className="size-4 sm:size-6"
    >
      <path
        d="M8 17L17 8M17 8H9M17 8V16"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function Guides() {
  return (
    <section
      className="px-6 pt-[100px]"
      style={{ animation: `fadeUp 600ms ${easeOut} 0ms both` }}
    >
      <div
        className="-mx-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3"
        style={frameDashStyle}
      >
        {GUIDES.map((g) => (
          <a
            key={g.title}
            href={g.href}
            className="relative flex min-h-14 items-center justify-between gap-4 overflow-hidden px-6 py-4 text-foreground outline-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-info focus-visible:outline-offset-2 transition-[background-color,transform] duration-150 hover:bg-foreground/[0.025] active:translate-y-px active:bg-foreground/[0.045] sm:min-h-[260px] sm:flex-col sm:items-start sm:justify-end sm:gap-3 sm:p-9"
            style={cardDashStyle}
          >
            <span className="relative z-10 order-2 inline-flex text-foreground-muted sm:order-none sm:text-foreground">
              <ArrowUpRight />
            </span>
            <span className="relative z-10 min-w-0 text-[16px] leading-tight sm:text-[24px]">
              {g.title}
            </span>
          </a>
        ))}
      </div>
    </section>
  );
}
