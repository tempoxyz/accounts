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
    title: "Create & Use Accounts",
    href: "https://docs.tempo.xyz/guide/use-accounts",
  },
  {
    title: "Make Payments",
    href: "https://docs.tempo.xyz/guide/payments",
  },
  {
    title: "Sponsor Fees",
    href: "https://docs.tempo.xyz/guide/payments/sponsor-user-fees",
  },
  {
    title: "Issue Stablecoins",
    href: "https://docs.tempo.xyz/guide/issuance",
  },
  {
    title: "Exchange Stablecoins",
    href: "https://docs.tempo.xyz/guide/stablecoin-dex",
  },
  {
    title: "View all docs",
    href: "https://docs.tempo.xyz/accounts",
  },
];

function ArrowUpRight() {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
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
      className="px-6 pt-12 sm:pt-[55px]"
      style={{ animation: `fadeUp 600ms ${easeOut} 0ms both` }}
    >
      <h2 className="text-[24px] leading-tight text-foreground sm:text-[24px]">
        Guides
      </h2>

      <div
        className="-mx-6 mt-8 grid grid-cols-1 sm:mt-12 sm:grid-cols-2 lg:grid-cols-3"
        style={frameDashStyle}
      >
        {GUIDES.map((g) => (
          <a
            key={g.title}
            href={g.href}
            target="_blank"
            rel="noreferrer"
            className="relative flex min-h-[200px] flex-col justify-end gap-3 overflow-hidden p-6 text-foreground outline-none focus-visible:outline-2 focus-visible:outline-info focus-visible:outline-offset-2 transition-[background-color,transform] duration-150 hover:bg-foreground/[0.025] active:translate-y-px active:bg-foreground/[0.045] focus-visible:bg-foreground/[0.03] sm:min-h-[260px] sm:p-9"
            style={cardDashStyle}
          >
            <span className="relative z-10 inline-flex">
              <ArrowUpRight />
            </span>
            <span className="relative z-10 text-[20px] leading-tight tracking-[-0.01em] sm:text-[24px]">
              {g.title}
            </span>
          </a>
        ))}
      </div>
    </section>
  );
}
