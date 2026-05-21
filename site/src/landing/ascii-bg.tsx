"use client";

import { useEffect, useRef } from "react";
import { readCssVar, useTheme } from "./useTheme";

/* ─── Tweakables ──────────────────────────────────────────────────────── *
 *
 * Colour + alpha values live in `styles.css` under `--canvas-dot-*`
 * (Tier 8) and flip with the landing theme. The geometric tweakables
 * below (spacing, breathing speed, ...) stay in code
 * because they're motion-design knobs, not colour decisions.
 *
 * ───────────────────────────────────────────────────────────────────── */

/** Background color painted behind the dots. `null` = transparent. */
const BACKGROUND: string | null = null;

/** Pixel distance between dots in the grid. Higher = sparser. */
const SPACING = 10;
/** Base radius of each dot in pixels. */
const BASE_RADIUS = 1;
/** Per-dot pseudo-random brightness variance (0 = uniform, 1 = full range). */
const JITTER = 0.2;

/** Ambient-only dot-field motion. Pointer/hover reactions stay disabled. */
const ENABLE_ANIMATION = true;

/** Ambient breathing amplitude as a fraction of base alpha. 0 = static. */
const BREATH_AMPLITUDE = 10;
/** Breathing animation speed in cycles per second (Hz). Lower = slower. */
const BREATH_SPEED = 0.3;

/* ─────────────────────────────────────────────────────────────────────── */

type Props = {
  className?: string;
};

function hash(x: number, y: number) {
  const s = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
  return s - Math.floor(s);
}

export default function AsciiBackground({ className }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const { resolved } = useTheme();
  const rafRef = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const COLOR = readCssVar(canvas, "--canvas-dot-rgb") || "125, 125, 125";
    const BASE_ALPHA = Number(readCssVar(canvas, "--canvas-dot-alpha-base")) || 0.07;

    const reduced =
      !ENABLE_ANIMATION ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    let width = 0;
    let height = 0;

    const draw = (now: number) => {
      if (BACKGROUND) {
        ctx.fillStyle = BACKGROUND;
        ctx.fillRect(0, 0, width, height);
      } else {
        ctx.clearRect(0, 0, width, height);
      }

      const breathPhase = (now / 1000) * BREATH_SPEED * Math.PI * 2;

      for (let y = SPACING; y < height; y += SPACING) {
        const gy = Math.round(y / SPACING);
        for (let x = SPACING; x < width; x += SPACING) {
          const gx = Math.round(x / SPACING);
          const variance = JITTER > 0 ? 1 - JITTER * (1 - hash(gx, gy)) : 1;

          // Independent per-dot phase so the field twinkles instead of
          // pulsing in unison.
          const breath = reduced
            ? 1
            : 1 +
              BREATH_AMPLITUDE * Math.sin(breathPhase + hash(gx, gy) * 6.28);

          let alpha = BASE_ALPHA * variance * breath;
          let radius = BASE_RADIUS;

          ctx.fillStyle = `rgba(${COLOR}, ${alpha})`;
          ctx.beginPath();
          ctx.arc(x, y, radius, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      if (ENABLE_ANIMATION) rafRef.current = requestAnimationFrame(draw);
    };

    const resize = () => {
      const rect = container.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (!ENABLE_ANIMATION) draw(0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(container);

    if (ENABLE_ANIMATION) rafRef.current = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(rafRef.current);
      ro.disconnect();
    };
  }, [resolved]);

  return (
    <div
      ref={containerRef}
      aria-hidden
      className={`pointer-events-none absolute inset-0 ${className ?? ""}`}
    >
      <canvas ref={canvasRef} className="block size-full" />
    </div>
  );
}
