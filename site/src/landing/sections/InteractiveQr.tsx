"use client";

import { Cuer } from "cuer";
import { useContext, useEffect, useRef, useState } from "react";
import { readCssVar, useTheme } from "../useTheme";

/* ─── Tweakables ──────────────────────────────────────────────────────── *
 *
 * Colour comes from the landing token catalogue (`--canvas-dot-rgb` in
 * styles.css, Tier 8) so the QR retints with the page theme. The QR's
 * own alpha levels stay in code — they're tuned for legibility, not
 * theme, so we override the dot-field hover alpha locally.
 *
 * ───────────────────────────────────────────────────────────────────── */

/** Resting opacity for data-module dots. */
const BASE_ALPHA = 0.8;
/** Peak opacity under the cursor / brightest trail point. */
const HOVER_ALPHA = 1;
/** Multiplier on dot radius at the cursor center. Modest so dots don't overlap into a blob. */
const HOVER_SCALE = 1.6;
/** Cursor influence radius in pixels. */
const HOVER_RADIUS = 90;
const RESPONSE_MS = 100;
const TRAIL_LIFE_MS = 120;
const TRAIL_RADIUS = 100;
/** Per-dot breathing amplitude — subtle so the pattern stays scannable. */
const BREATH_AMPLITUDE = 0.1;
const BREATH_SPEED = 0.4;
/** Fraction of a cell that a data-module dot fills at rest. */
const DOT_FILL = 0.45;
/** Trail glow contribution per recent cursor sample. */
const TRAIL_BOOST = 0.25;
/** Pixels a data-module dot leans toward the cursor at peak proximity. 0 = no displacement. */
const DOT_LEAN_PX = 1.5;
/** Quiet-zone width in modules. QR spec requires ≥ 4 for reliable scanning. */
const QUIET_ZONE = 4;
/** Length (in modules) of each finder pattern; spec value is always 7. */
const FINDER_SIZE = 7;
/** Corner-rounding ratio for the finder outer ring + inner square (0 = square, 0.5 = pill). */
const FINDER_RADIUS_RATIO = 0.22;
/** How far the cursor reaches into a finder before it starts reacting (px). Set to 0 to disable. */
const FINDER_HOVER_RADIUS = 110;
/** Peak scale on hover. Keep ≤ 1.05 so spec geometry stays intact. 1 = no scale. */
const FINDER_HOVER_SCALE = 1.04;
/** Pixels the finder leans toward the cursor at peak. ≤ ~3 px is safe to scan. 0 = no displacement. */
const FINDER_LEAN_PX = 2.5;

type TrailPoint = { x: number; y: number; t: number };

function hash(x: number, y: number) {
  const s = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
  return s - Math.floor(s);
}

/**
 * True when matrix cell (x, y) falls inside one of the three finder
 * patterns (top-left, top-right, bottom-left).
 */
function isFinderCell(x: number, y: number, edge: number) {
  const inTopLeft = x < FINDER_SIZE && y < FINDER_SIZE;
  const inTopRight = x >= edge - FINDER_SIZE && y < FINDER_SIZE;
  const inBottomLeft = x < FINDER_SIZE && y >= edge - FINDER_SIZE;
  return inTopLeft || inTopRight || inBottomLeft;
}

/**
 * Interactive QR. Uses cuer's `Cuer.Context` for encoding, then renders the
 * matrix as a canvas of dots driven by the same hover / trail / breath
 * engine as `ascii-bg.tsx`. Finder patterns (the 3 corner anchors) are
 * drawn as solid rounded squares so phone scanners can lock onto them; a
 * 4-module quiet zone is added around the whole pattern.
 *
 * `size` is the final canvas size in pixels — the QR data area is smaller
 * by the quiet-zone padding.
 */
export function InteractiveQr({
  value,
  size = 220,
}: {
  value: string;
  size?: number;
}) {
  const [matrix, setMatrix] = useState<readonly (readonly boolean[])[] | null>(
    null,
  );

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <Cuer.Root
        value={value}
        size={`${size}px`}
        style={{ position: "absolute", inset: 0, visibility: "hidden" }}
      >
        <MatrixBridge onMatrix={setMatrix} />
      </Cuer.Root>
      {matrix ? <DotCanvas matrix={matrix} size={size} /> : null}
    </div>
  );
}

function MatrixBridge({
  onMatrix,
}: {
  onMatrix: (m: readonly (readonly boolean[])[]) => void;
}) {
  const ctx = useContext(Cuer.Context);
  useEffect(() => {
    onMatrix(ctx.qrcode.grid);
  }, [ctx.qrcode.grid, onMatrix]);
  return null;
}

function DotCanvas({
  matrix,
  size,
}: {
  matrix: readonly (readonly boolean[])[];
  size: number;
}) {
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

    const COLOR = readCssVar(canvas, "--canvas-dot-rgb") || "150, 150, 150";

    const dpr = Math.max(1, window.devicePixelRatio || 1);
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);
    canvas.style.width = `${size}px`;
    canvas.style.height = `${size}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

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

    const edge = matrix.length;
    /** Total cells including the 4-module quiet zone on every side. */
    const totalCells = edge + 2 * QUIET_ZONE;
    const cellSize = size / totalCells;
    const dotRadius = (cellSize / 2) * DOT_FILL;
    /** Pixel offset where the actual QR data starts. */
    const dataOrigin = QUIET_ZONE * cellSize;

    /**
     * Draw a single 7×7 finder pattern as outer rounded ring + inner filled
     * square. When the cursor is near, the finder gently scales and leans
     * toward it. The displacements are tuned to stay within QR scanning
     * tolerance — set `FINDER_LEAN_PX` / `FINDER_HOVER_SCALE` to 0 / 1 to
     * disable any movement.
     */
    const drawFinder = (
      originX: number,
      originY: number,
      cursorX: number,
      cursorY: number,
      cursorActive: boolean,
    ) => {
      const outerSize = FINDER_SIZE * cellSize;
      const innerSize = 3 * cellSize;
      const innerOffset = 2 * cellSize;
      const outerRadius = outerSize * FINDER_RADIUS_RATIO;
      const innerRadius = innerSize * FINDER_RADIUS_RATIO;
      const centerX = originX + outerSize / 2;
      const centerY = originY + outerSize / 2;

      // Cursor proximity in [0..1]. 0 when far / inactive / reduced motion.
      let proximity = 0;
      if (cursorActive && !reduced && FINDER_HOVER_RADIUS > 0) {
        const dx = centerX - cursorX;
        const dy = centerY - cursorY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < FINDER_HOVER_RADIUS) {
          const t = 1 - dist / FINDER_HOVER_RADIUS;
          proximity = t * t;
        }
      }

      ctx.save();
      if (proximity > 0) {
        const lean = FINDER_LEAN_PX * proximity;
        const scale = 1 + (FINDER_HOVER_SCALE - 1) * proximity;
        const angle = Math.atan2(cursorY - centerY, cursorX - centerX);
        ctx.translate(centerX, centerY);
        ctx.translate(Math.cos(angle) * lean, Math.sin(angle) * lean);
        ctx.scale(scale, scale);
        ctx.translate(-centerX, -centerY);
      }

      ctx.strokeStyle = `rgba(${COLOR}, 1)`;
      ctx.lineWidth = cellSize;
      ctx.beginPath();
      ctx.roundRect(
        originX + cellSize / 2,
        originY + cellSize / 2,
        outerSize - cellSize,
        outerSize - cellSize,
        outerRadius,
      );
      ctx.stroke();

      ctx.fillStyle = `rgba(${COLOR}, 1)`;
      ctx.beginPath();
      ctx.roundRect(
        originX + innerOffset,
        originY + innerOffset,
        innerSize,
        innerSize,
        innerRadius,
      );
      ctx.fill();

      ctx.restore();
    };

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
        while (s.trail.length && s.trail[0] && s.trail[0].t < cutoff)
          s.trail.shift();
        if (s.trail.length > 60) s.trail.splice(0, s.trail.length - 60);
      }

      ctx.clearRect(0, 0, size, size);

      const r2 = HOVER_RADIUS * HOVER_RADIUS;
      const tr2 = TRAIL_RADIUS * TRAIL_RADIUS;
      const breathPhase = (now / 1000) * BREATH_SPEED * Math.PI * 2;

      // Data-module dots (skip finder cells — those are drawn as solid shapes after).
      for (let y = 0; y < edge; y++) {
        const row = matrix[y]!;
        for (let x = 0; x < edge; x++) {
          if (!row[x]) continue;
          if (isFinderCell(x, y, edge)) continue;
          const cx = dataOrigin + x * cellSize + cellSize / 2;
          const cy = dataOrigin + y * cellSize + cellSize / 2;

          const breath = reduced
            ? 1
            : 1 +
              BREATH_AMPLITUDE * Math.sin(breathPhase + hash(x, y) * 6.28);

          let alpha = BASE_ALPHA * breath;
          let radius = dotRadius;
          let drawX = cx;
          let drawY = cy;

          if (s.active && !reduced) {
            const dx = cx - s.smoothX;
            const dy = cy - s.smoothY;
            const d2 = dx * dx + dy * dy;
            if (d2 < r2) {
              const t = 1 - Math.sqrt(d2) / HOVER_RADIUS;
              const eased = t * t;
              alpha = alpha + (HOVER_ALPHA - alpha) * eased;
              radius = dotRadius + dotRadius * (HOVER_SCALE - 1) * eased;
              if (DOT_LEAN_PX > 0) {
                const angle = Math.atan2(s.smoothY - cy, s.smoothX - cx);
                const lean = DOT_LEAN_PX * eased;
                drawX += Math.cos(angle) * lean;
                drawY += Math.sin(angle) * lean;
              }
            }
          }

          if (s.trail.length > 0 && !reduced) {
            let glow = 0;
            for (let i = s.trail.length - 1; i >= 0; i--) {
              const p = s.trail[i];
              if (!p) continue;
              const dx = cx - p.x;
              if (dx > TRAIL_RADIUS || dx < -TRAIL_RADIUS) continue;
              const dy = cy - p.y;
              if (dy > TRAIL_RADIUS || dy < -TRAIL_RADIUS) continue;
              const d2 = dx * dx + dy * dy;
              if (d2 >= tr2) continue;
              const distFalloff = 1 - Math.sqrt(d2) / TRAIL_RADIUS;
              const ageRatio = 1 - (now - p.t) / TRAIL_LIFE_MS;
              glow += distFalloff * distFalloff * ageRatio * TRAIL_BOOST;
            }
            if (glow > 0) {
              const cap = Math.min(glow, 1);
              alpha = alpha + (HOVER_ALPHA - alpha) * cap;
              radius =
                radius + dotRadius * cap * (HOVER_SCALE - 1) * 0.5;
            }
          }

          ctx.fillStyle = `rgba(${COLOR}, ${alpha})`;
          ctx.beginPath();
          ctx.arc(drawX, drawY, radius, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // Finder patterns — solid, full-opacity, gently rounded squares.
      // Drawn after the dots so they always read as the QR anchors.
      // Each finder leans toward the cursor independently.
      drawFinder(dataOrigin, dataOrigin, s.smoothX, s.smoothY, s.active);
      drawFinder(
        dataOrigin + (edge - FINDER_SIZE) * cellSize,
        dataOrigin,
        s.smoothX,
        s.smoothY,
        s.active,
      );
      drawFinder(
        dataOrigin,
        dataOrigin + (edge - FINDER_SIZE) * cellSize,
        s.smoothX,
        s.smoothY,
        s.active,
      );

      rafRef.current = requestAnimationFrame(draw);
    };
    rafRef.current = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(rafRef.current);
      container.removeEventListener("mousemove", onMove);
      container.removeEventListener("mouseleave", onLeave);
    };
  }, [matrix, size, resolved]);

  return (
    <div ref={containerRef} className="absolute inset-0">
      <canvas ref={canvasRef} className="block size-full" />
    </div>
  );
}
