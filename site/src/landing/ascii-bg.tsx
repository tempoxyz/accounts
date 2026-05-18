"use client";

import { useEffect, useRef } from "react";
import { readCssVar, useTheme } from "./useTheme";

/* ─── Tweakables ──────────────────────────────────────────────────────── *
 *
 * Colour + alpha values live in `styles.css` under `--canvas-dot-*`
 * (Tier 8) and flip with the landing theme. The geometric tweakables
 * below (spacing, hover radius, breathing speed, ...) stay in code
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

/** Multiplier on dot radius at the cursor center. */
const HOVER_SCALE = 3.5;
/** Cursor influence radius in pixels. */
const HOVER_RADIUS = 160;

/** Cursor follow lag in ms. Higher = smoother / laggier. */
const RESPONSE_MS = 50;
/** Lifetime of each trail point in ms. */
const TRAIL_LIFE_MS = 100;
/** Glow radius around each trail point in pixels. */
const TRAIL_RADIUS = 150;

/** Ambient breathing amplitude as a fraction of base alpha. 0 = static. */
const BREATH_AMPLITUDE = 10;
/** Breathing animation speed in cycles per second (Hz). Lower = slower. */
const BREATH_SPEED = 0.3;

/* ─────────────────────────────────────────────────────────────────────── */

type Props = {
  className?: string;
};

type TrailPoint = { x: number; y: number; t: number };

function hash(x: number, y: number) {
  const s = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
  return s - Math.floor(s);
}

export default function AsciiBackground({ className }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const { resolved } = useTheme();
  const stateRef = useRef({
    targetX: -9999,
    targetY: -9999,
    smoothX: -9999,
    smoothY: -9999,
    active: false,
    trail: [] as TrailPoint[],
    lastFrame: 0,
  });
  const rafRef = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const COLOR = readCssVar(canvas, "--canvas-dot-rgb") || "125, 125, 125";
    const BASE_ALPHA = Number(readCssVar(canvas, "--canvas-dot-alpha-base")) || 0.07;
    const HOVER_ALPHA = Number(readCssVar(canvas, "--canvas-dot-alpha-hover")) || 0.1;

    const dpr = Math.max(1, window.devicePixelRatio || 1);
    let width = 0;
    let height = 0;

    const resize = () => {
      const rect = container.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(container);

    const onMove = (e: MouseEvent) => {
      const rect = container.getBoundingClientRect();
      const s = stateRef.current;
      s.targetX = e.clientX - rect.left;
      s.targetY = e.clientY - rect.top;
      if (!s.active) {
        s.smoothX = s.targetX;
        s.smoothY = s.targetY;
      }
      s.active = true;
    };
    const onLeave = () => {
      stateRef.current.active = false;
    };
    container.addEventListener("mousemove", onMove);
    container.addEventListener("mouseleave", onLeave);

    const reduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;

    const draw = (now: number) => {
      const s = stateRef.current;
      const dt = s.lastFrame ? Math.min(now - s.lastFrame, 100) : 16;
      s.lastFrame = now;

      const damping = reduced ? 1 : 1 - Math.exp(-dt / RESPONSE_MS);
      s.smoothX += (s.targetX - s.smoothX) * damping;
      s.smoothY += (s.targetY - s.smoothY) * damping;

      if (!reduced) {
        if (s.active) {
          const last = s.trail[s.trail.length - 1];
          if (
            !last ||
            (s.smoothX - last.x) ** 2 + (s.smoothY - last.y) ** 2 > 16
          ) {
            s.trail.push({ x: s.smoothX, y: s.smoothY, t: now });
          }
        }
        const cutoff = now - TRAIL_LIFE_MS;
        while (s.trail.length && s.trail[0] && s.trail[0].t < cutoff) s.trail.shift();
        if (s.trail.length > 80) s.trail.splice(0, s.trail.length - 80);
      }

      if (BACKGROUND) {
        ctx.fillStyle = BACKGROUND;
        ctx.fillRect(0, 0, width, height);
      } else {
        ctx.clearRect(0, 0, width, height);
      }

      const r2 = HOVER_RADIUS * HOVER_RADIUS;
      const tr2 = TRAIL_RADIUS * TRAIL_RADIUS;
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

          if (s.active && !reduced) {
            const dx = x - s.smoothX;
            const dy = y - s.smoothY;
            const d2 = dx * dx + dy * dy;
            if (d2 < r2) {
              const t = 1 - Math.sqrt(d2) / HOVER_RADIUS;
              const eased = t * t;
              alpha = alpha + (HOVER_ALPHA - alpha) * eased;
              radius = BASE_RADIUS + BASE_RADIUS * (HOVER_SCALE - 1) * eased;
            }
          }

          if (s.trail.length > 0 && !reduced) {
            let glow = 0;
            for (let i = s.trail.length - 1; i >= 0; i--) {
              const p = s.trail[i];
              if (!p) continue;
              const dx = x - p.x;
              if (dx > TRAIL_RADIUS || dx < -TRAIL_RADIUS) continue;
              const dy = y - p.y;
              if (dy > TRAIL_RADIUS || dy < -TRAIL_RADIUS) continue;
              const d2 = dx * dx + dy * dy;
              if (d2 >= tr2) continue;
              const distFalloff = 1 - Math.sqrt(d2) / TRAIL_RADIUS;
              const ageRatio = 1 - (now - p.t) / TRAIL_LIFE_MS;
              glow += distFalloff * distFalloff * ageRatio * 0.35;
            }
            if (glow > 0) {
              const cap = Math.min(glow, 1);
              alpha = alpha + (HOVER_ALPHA - alpha) * cap;
              radius = radius + BASE_RADIUS * cap * (HOVER_SCALE - 1) * 0.6;
            }
          }

          ctx.fillStyle = `rgba(${COLOR}, ${alpha})`;
          ctx.beginPath();
          ctx.arc(x, y, radius, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      rafRef.current = requestAnimationFrame(draw);
    };
    rafRef.current = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(rafRef.current);
      ro.disconnect();
      container.removeEventListener("mousemove", onMove);
      container.removeEventListener("mouseleave", onLeave);
    };
  }, [resolved]);

  return (
    <div
      ref={containerRef}
      aria-hidden
      className={`pointer-events-auto absolute inset-0 ${className ?? ""}`}
    >
      <canvas ref={canvasRef} className="block size-full" />
    </div>
  );
}
