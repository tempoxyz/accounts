"use client";

/**
 * Inline SVG icon components for the landing page.
 *
 * The static files in `public/icons/*.svg` use `var(--fill-0, white)` /
 * `var(--stroke-0, …)` defaults, but `<img src="…svg">` loads each SVG in
 * its own document context where the parent page's CSS variables don't
 * resolve — so the icons end up rendering as their literal fallback
 * (white) and disappear on a light background.
 *
 * Inline SVG, on the other hand, inherits from the React tree's CSS, so
 * `fill="currentColor"` / `stroke="currentColor"` automatically picks up
 * the `text-foreground` / `text-foreground-muted` utility applied on the
 * surrounding element. The shapes here are identical to the files in
 * `public/icons` so the visual result matches one-to-one.
 */

type IconProps = {
  width?: number;
  height?: number;
  className?: string;
};

export function TempoLogo({ width = 20, height = 21, className }: IconProps) {
  return (
    <svg
      width={width}
      height={height}
      viewBox="0 0 19.0138 19.786"
      fill="none"
      aria-hidden
      className={className}
      style={{ display: "block" }}
    >
      <path
        d="M6.71995 19.786H1.38045L6.32925 4.48482H0L1.38045 0H19.0138L17.6333 4.48482H11.6427L6.71995 19.786Z"
        fill="currentColor"
      />
    </svg>
  );
}

export function DocsIcon({ width = 16, height = 16, className }: IconProps) {
  return (
    <svg
      width={width}
      height={height}
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden
      className={className}
      style={{ display: "block" }}
    >
      <path
        d="M3.16667 7.83333V3.16667C3.16667 2.43029 3.76362 1.83333 4.5 1.83333H7.94773C8.30133 1.83333 8.64047 1.97381 8.89053 2.22386L12.4428 5.77614C12.6929 6.02619 12.8333 6.36533 12.8333 6.71893V12.8333C12.8333 13.5697 12.2364 14.1667 11.5 14.1667H7.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M8.5 2.16667V4.83333C8.5 5.56971 9.09693 6.16667 9.83333 6.16667H12.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path
        d="M4.82697 10.7901L4.36239 9.5822C4.30472 9.43227 4.16066 9.33333 4 9.33333C3.83934 9.33333 3.69528 9.43227 3.63761 9.5822L3.17303 10.7901C3.10531 10.9662 2.96618 11.1053 2.79012 11.173L1.58223 11.6376C1.43228 11.6953 1.33333 11.8393 1.33333 12C1.33333 12.1607 1.43228 12.3047 1.58223 12.3624L2.79012 12.827C2.96618 12.8947 3.10531 13.0338 3.17303 13.2099L3.63761 14.4178C3.69528 14.5677 3.83934 14.6667 4 14.6667C4.16066 14.6667 4.30472 14.5677 4.36239 14.4178L4.82697 13.2099C4.89469 13.0338 5.03382 12.8947 5.20988 12.827L6.41777 12.3624C6.56772 12.3047 6.66667 12.1607 6.66667 12C6.66667 11.8393 6.56772 11.6953 6.41777 11.6376L5.20988 11.173C5.03382 11.1053 4.89469 10.9662 4.82697 10.7901Z"
        fill="currentColor"
      />
    </svg>
  );
}

export function GithubIcon({ width = 16, height = 16, className }: IconProps) {
  return (
    <svg
      width={width}
      height={height}
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden
      className={className}
      style={{ display: "block" }}
    >
      <path
        d="M8 1.30045C11.6833 1.30045 14.6667 4.28379 14.6667 7.96713C14.6663 9.36393 14.2279 10.7255 13.4132 11.8601C12.5985 12.9948 11.4485 13.8453 10.125 14.2921C9.79167 14.3588 9.66667 14.1505 9.66667 13.9755C9.66667 13.7505 9.675 13.0338 9.675 12.1421C9.675 11.5171 9.46667 11.1171 9.225 10.9088C10.7083 10.7421 12.2667 10.1755 12.2667 7.61713C12.2667 6.8838 12.0083 6.29212 11.5833 5.82545C11.65 5.65879 11.8833 4.97545 11.5167 4.05879C11.5167 4.05879 10.9583 3.87545 9.68333 4.74212C9.15 4.59212 8.58333 4.51712 8.01667 4.51712C7.45 4.51712 6.88333 4.59212 6.35 4.74212C5.075 3.88379 4.51667 4.05879 4.51667 4.05879C4.15 4.97545 4.38333 5.65879 4.45 5.82545C4.025 6.29212 3.76667 6.89213 3.76667 7.61713C3.76667 10.1671 5.31667 10.7421 6.8 10.9088C6.60833 11.0755 6.43333 11.3671 6.375 11.8005C5.99167 11.9755 5.03333 12.2588 4.43333 11.2505C4.30833 11.0505 3.93333 10.5588 3.40833 10.5671C2.85 10.5755 3.18333 10.8838 3.41667 11.0088C3.7 11.1671 4.025 11.7588 4.1 11.9505C4.23333 12.3255 4.66667 13.0421 6.34167 12.7338C6.34167 13.2921 6.35 13.8171 6.35 13.9755C6.35 14.1505 6.225 14.3505 5.89167 14.2921C4.56387 13.8501 3.40895 13.0013 2.59074 11.866C1.77254 10.7307 1.3326 9.36653 1.33333 7.96713C1.33333 4.28379 4.31667 1.30045 8 1.30045Z"
        fill="currentColor"
      />
    </svg>
  );
}

export function CopyIcon({ width = 18, height = 18, className }: IconProps) {
  return (
    <svg
      width={width}
      height={height}
      viewBox="0 0 18 18"
      fill="none"
      aria-hidden
      className={className}
      style={{ display: "block" }}
    >
      <path
        d="M11.4375 6.5625V3C11.4375 2.48223 11.0178 2.0625 10.5 2.0625H3C2.48223 2.0625 2.0625 2.48223 2.0625 3V10.5C2.0625 11.0178 2.48223 11.4375 3 11.4375H6.5625M7.5 6.5625H15C15.5178 6.5625 15.9375 6.98223 15.9375 7.5V15C15.9375 15.5178 15.5178 15.9375 15 15.9375H7.5C6.98223 15.9375 6.5625 15.5178 6.5625 15V7.5C6.5625 6.98223 6.98223 6.5625 7.5 6.5625Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * "Copy instructions for my agent" sparkle icon. Renders entirely in
 * `currentColor` so it follows the surrounding text colour in either
 * theme.
 */
export function AgentCopyIcon({ width = 16, height = 16, className }: IconProps) {
  return (
    <svg
      width={width}
      height={height}
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden
      className={className}
      style={{ display: "block" }}
    >
      <path
        d="M2.5 8.67733C2.5 7.30107 2.5 6.61298 2.77822 6.05265C3.01364 5.57853 3.43319 5.14421 3.89889 4.89255C4.44927 4.59513 5.09233 4.57289 6.37845 4.52842C7.4742 4.49053 8.5258 4.49053 9.62153 4.52842C10.9077 4.57289 11.5507 4.59513 12.1011 4.89255C12.5668 5.14421 12.9863 5.57853 13.2218 6.05265C13.5 6.61298 13.5 7.30107 13.5 8.67733V9.32267C13.5 10.6989 13.5 11.387 13.2218 11.9473C12.9863 12.4215 12.5668 12.8558 12.1011 13.1075C11.5507 13.4049 10.9077 13.4271 9.62153 13.4716C8.5258 13.5095 7.4742 13.5095 6.37845 13.4716C5.09233 13.4271 4.44927 13.4049 3.89889 13.1075C3.43319 12.8558 3.01364 12.4215 2.77822 11.9473C2.5 11.387 2.5 10.6989 2.5 9.32267V8.67733Z"
        stroke="currentColor"
        strokeWidth="1.125"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M8 3.33333C8.55228 3.33333 9 2.88562 9 2.33333C9 1.78105 8.55228 1.33333 8 1.33333C7.44772 1.33333 7 1.78105 7 2.33333C7 2.88562 7.44772 3.33333 8 3.33333Z"
        fill="currentColor"
      />
      <path
        d="M6.33333 8.75V7.58333C6.33333 7.44527 6.22141 7.33333 6.08333 7.33333C5.94526 7.33333 5.83333 7.44527 5.83333 7.58333V8.75C5.83333 8.88807 5.94526 9 6.08333 9C6.22141 9 6.33333 8.88807 6.33333 8.75Z"
        stroke="currentColor"
        strokeWidth="1.125"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M10.1667 8.75V7.58333C10.1667 7.44527 10.0547 7.33333 9.91667 7.33333C9.7786 7.33333 9.66667 7.44527 9.66667 7.58333V8.75C9.66667 8.88807 9.7786 9 9.91667 9C10.0547 9 10.1667 8.88807 10.1667 8.75Z"
        stroke="currentColor"
        strokeWidth="1.125"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M2.33333 7.16667C2.05719 7.16667 1.83333 7.39053 1.83333 7.66667V9C1.83333 9.27613 2.05719 9.5 2.33333 9.5"
        stroke="currentColor"
        strokeWidth="1.125"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M13.6667 7.16667C13.9428 7.16667 14.1667 7.39053 14.1667 7.66667V9C14.1667 9.27613 13.9428 9.5 13.6667 9.5"
        stroke="currentColor"
        strokeWidth="1.125"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M8 4.33333V2"
        stroke="currentColor"
        strokeWidth="0.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * Padlock icon used in the demo browser-mockup URL bar. The static SVG
 * encoded a `#02C540` green default; the inline version uses
 * `currentColor` so we can opt into either an `--accent-live` (green) or
 * the local foreground tint via the parent's text class.
 */
export function LockIcon({ width = 12, height = 15, className }: IconProps) {
  return (
    <svg
      width={width}
      height={height}
      viewBox="0 0 12 15"
      fill="none"
      aria-hidden
      className={className}
      style={{ display: "block" }}
    >
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M6 0C3.92893 0 2.25 1.70019 2.25 3.79747V5.12658H2.0625C0.923415 5.12658 0 6.06167 0 7.21519V12.9114C0 14.0649 0.923415 15 2.0625 15H9.9375C11.0766 15 12 14.0649 12 12.9114V7.21519C12 6.06167 11.0766 5.12658 9.9375 5.12658H9.75V3.79747C9.75 1.70019 8.07105 0 6 0ZM8.625 5.12658V3.79747C8.625 2.32937 7.44975 1.13924 6 1.13924C4.55025 1.13924 3.375 2.32937 3.375 3.79747V5.12658H8.625ZM6 8.35443C6.31065 8.35443 6.5625 8.60947 6.5625 8.92405V11.2025C6.5625 11.5171 6.31065 11.7722 6 11.7722C5.68935 11.7722 5.4375 11.5171 5.4375 11.2025V8.92405C5.4375 8.60947 5.68935 8.35443 6 8.35443Z"
        fill="currentColor"
      />
    </svg>
  );
}
