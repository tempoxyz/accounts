"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { readCssVar, useTheme } from "./useTheme";

/* ─── Tweakables ──────────────────────────────────────────────────────── *
 *
 * Colour comes from `--canvas-dot-rgb` (Tier 8 in `styles.css`) so the
 * field flips with the landing theme automatically. The numeric knobs
 * below are motion-design choices, not colour decisions, so they stay
 * in code.
 *
 * ───────────────────────────────────────────────────────────────────── */

/** Size of each rendered pixel in CSS pixels. */
const PIXEL_SIZE = 2.5;
/** Spatial scale of the FBM noise (higher = smaller wisps). */
const PATTERN_SCALE = 4;
/** Density bias: 0.5 ≈ balanced, lower = sparser, higher = denser. */
const PATTERN_DENSITY = 0.5;
/** Per-pixel size jitter on the dust grid. */
const PIXEL_JITTER = 0;
/** Flow speed multiplier for the noise field. */
const FLOW_SPEED = 2;
/** Soft fade toward the edges (0 = no fade, larger = wider fade). */
const EDGE_FADE = 0.25;
/** Multiplier applied on top of `--canvas-dot-alpha-base` so the binary
 *  dither has enough contrast to read. */
const ALPHA_GAIN = 8;

/** Radius around the cursor (in CSS px) where the dust lifts. */
const CURSOR_RADIUS = 180;
/** Strength of the cursor brightness boost (added to the dither feed). */
const CURSOR_STRENGTH = 0.5;
/** Cursor follow lag (ms). Higher = laggier / smoother. */
const CURSOR_RESPONSE_MS = 90;
/** Max simultaneous click ripples kept in the shader. */
const MAX_CLICKS = 8;
/** Ripple speed in fragCoord units / second. */
const RIPPLE_SPEED = 90;
/** Ripple ring thickness (smaller = thinner / crisper). */
const RIPPLE_THICKNESS = 90;
/** Strength of a fresh ripple. Fades over time. */
const RIPPLE_STRENGTH = 1.1;
/** Lifetime of one ripple in seconds (visual decay). */
const RIPPLE_LIFETIME = 1.3;

const VERTEX_SRC = /* glsl */ `
void main() {
  gl_Position = vec4(position, 1.0);
}
`;

const FRAGMENT_SRC = /* glsl */ `
precision highp float;

#define MAX_CLICKS ${MAX_CLICKS}

uniform vec3  uColor;
uniform vec2  uResolution;
uniform float uTime;
uniform float uPixelSize;
uniform float uScale;
uniform float uDensity;
uniform float uPixelJitter;
uniform float uAlpha;
uniform float uEdgeFade;

uniform vec2  uCursor;
uniform float uCursorRadius;
uniform float uCursorStrength;

uniform vec2  uClickPos[MAX_CLICKS];
uniform float uClickTimes[MAX_CLICKS];
uniform float uRippleSpeed;
uniform float uRippleThickness;
uniform float uRippleStrength;
uniform float uRippleLifetime;

out vec4 fragColor;

float Bayer2(vec2 a) {
  a = floor(a);
  return fract(a.x / 2.0 + a.y * a.y * 0.75);
}
#define Bayer4(a) (Bayer2(0.5*(a))*0.25 + Bayer2(a))
#define Bayer8(a) (Bayer4(0.5*(a))*0.25 + Bayer2(a))

#define FBM_OCTAVES    5
#define FBM_LACUNARITY 1.25
#define FBM_GAIN       1.0

float hash11(float n){ return fract(sin(n) * 43758.5453); }

float vnoise(vec3 p){
  vec3 ip = floor(p);
  vec3 fp = fract(p);
  float n000 = hash11(dot(ip + vec3(0.0, 0.0, 0.0), vec3(1.0, 57.0, 113.0)));
  float n100 = hash11(dot(ip + vec3(1.0, 0.0, 0.0), vec3(1.0, 57.0, 113.0)));
  float n010 = hash11(dot(ip + vec3(0.0, 1.0, 0.0), vec3(1.0, 57.0, 113.0)));
  float n110 = hash11(dot(ip + vec3(1.0, 1.0, 0.0), vec3(1.0, 57.0, 113.0)));
  float n001 = hash11(dot(ip + vec3(0.0, 0.0, 1.0), vec3(1.0, 57.0, 113.0)));
  float n101 = hash11(dot(ip + vec3(1.0, 0.0, 1.0), vec3(1.0, 57.0, 113.0)));
  float n011 = hash11(dot(ip + vec3(0.0, 1.0, 1.0), vec3(1.0, 57.0, 113.0)));
  float n111 = hash11(dot(ip + vec3(1.0, 1.0, 1.0), vec3(1.0, 57.0, 113.0)));
  vec3 w = fp * fp * fp * (fp * (fp * 6.0 - 15.0) + 10.0);
  float x00 = mix(n000, n100, w.x);
  float x10 = mix(n010, n110, w.x);
  float x01 = mix(n001, n101, w.x);
  float x11 = mix(n011, n111, w.x);
  float y0  = mix(x00, x10, w.y);
  float y1  = mix(x01, x11, w.y);
  return mix(y0, y1, w.z) * 2.0 - 1.0;
}

float fbm2(vec2 uv, float t){
  vec3 p = vec3(uv * uScale, t);
  float amp = 1.0;
  float freq = 1.0;
  float sum = 1.0;
  for (int i = 0; i < FBM_OCTAVES; ++i){
    sum  += amp * vnoise(p * freq);
    freq *= FBM_LACUNARITY;
    amp  *= FBM_GAIN;
  }
  return sum * 0.5 + 0.5;
}

void main(){
  vec2 fragCoord = gl_FragCoord.xy - uResolution * 0.5;
  float aspectRatio = uResolution.x / uResolution.y;

  float cellPixelSize = 8.0 * uPixelSize;
  vec2 cellId = floor(fragCoord / cellPixelSize);
  vec2 cellCoord = cellId * cellPixelSize;
  vec2 uv = cellCoord / uResolution * vec2(aspectRatio, 1.0);

  float base = fbm2(uv, uTime * 0.05);
  base = base * 0.5 - 0.65;
  float feed = base + (uDensity - 0.5) * 0.3;

  // Cursor lift — soft bell-curve boost in fragCoord space so the boost
  // is uniform regardless of aspect ratio.
  if (uCursorStrength > 0.0 && uCursorRadius > 0.0) {
    vec2 cellCenterPx = (cellId + 0.5) * cellPixelSize + uResolution * 0.5;
    float d = distance(cellCenterPx, uCursor);
    float t = d / uCursorRadius;
    float bell = exp(-t * t * 2.0);
    feed += uCursorStrength * bell;
  }

  // Click ripples — concentric rings that decay in time and distance.
  if (uRippleStrength > 0.0) {
    vec2 cellCenterPx = (cellId + 0.5) * cellPixelSize + uResolution * 0.5;
    for (int i = 0; i < MAX_CLICKS; ++i){
      vec2 pos = uClickPos[i];
      if (pos.x < 0.0) continue;
      float age = max(uTime - uClickTimes[i], 0.0);
      if (age > uRippleLifetime) continue;
      float r = distance(cellCenterPx, pos);
      float waveR = uRippleSpeed * age;
      float ring = exp(-pow((r - waveR) / uRippleThickness, 2.0));
      float decay = 1.0 - age / uRippleLifetime;
      feed = max(feed, ring * decay * uRippleStrength);
    }
  }

  float bayer = Bayer8(fragCoord / uPixelSize) - 0.5;
  float bw = step(0.5, feed + bayer);

  float h = fract(sin(dot(floor(fragCoord / uPixelSize), vec2(127.1, 311.7))) * 43758.5453);
  float jitterScale = 1.0 + (h - 0.5) * uPixelJitter;
  float coverage = bw * jitterScale;

  float fade = 1.0;
  if (uEdgeFade > 0.0) {
    vec2 norm = gl_FragCoord.xy / uResolution;
    float edge = min(min(norm.x, norm.y), min(1.0 - norm.x, 1.0 - norm.y));
    fade = smoothstep(0.0, uEdgeFade, edge);
  }

  fragColor = vec4(uColor, coverage * fade * uAlpha);
}
`;

function parseRgbVar(value: string): [number, number, number] {
  const parts = value.split(",").map((s) => Number.parseFloat(s.trim()));
  const [r, g, b] = parts;
  if (
    r === undefined ||
    g === undefined ||
    b === undefined ||
    Number.isNaN(r) ||
    Number.isNaN(g) ||
    Number.isNaN(b)
  )
    return [0.49, 0.49, 0.49];
  return [r / 255, g / 255, b / 255];
}

type Props = {
  className?: string;
};

export default function AsciiBackground({ className }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const { resolved } = useTheme();

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const reduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;

    const canvas = document.createElement("canvas");
    const renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      alpha: true,
      powerPreference: "low-power",
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearAlpha(0);
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    canvas.style.display = "block";
    container.appendChild(canvas);

    const [r, g, b] = parseRgbVar(
      readCssVar(container, "--canvas-dot-rgb") || "125, 125, 125",
    );
    const baseAlpha =
      Number(readCssVar(container, "--canvas-dot-alpha-base")) || 0.07;

    const clickPositions = Array.from(
      { length: MAX_CLICKS },
      () => new THREE.Vector2(-1, -1),
    );
    const clickTimes = new Float32Array(MAX_CLICKS);

    const uniforms = {
      uResolution: { value: new THREE.Vector2(0, 0) },
      uTime: { value: 0 },
      uColor: { value: new THREE.Color(r, g, b) },
      uPixelSize: { value: PIXEL_SIZE * renderer.getPixelRatio() },
      uScale: { value: PATTERN_SCALE },
      uDensity: { value: PATTERN_DENSITY },
      uPixelJitter: { value: PIXEL_JITTER },
      uAlpha: { value: Math.min(baseAlpha * ALPHA_GAIN, 1) },
      uEdgeFade: { value: EDGE_FADE },
      uCursor: { value: new THREE.Vector2(-9999, -9999) },
      uCursorRadius: {
        value: CURSOR_RADIUS * renderer.getPixelRatio(),
      },
      uCursorStrength: { value: reduced ? 0 : CURSOR_STRENGTH },
      uClickPos: { value: clickPositions },
      uClickTimes: { value: clickTimes },
      uRippleSpeed: { value: RIPPLE_SPEED * renderer.getPixelRatio() },
      uRippleThickness: {
        value: RIPPLE_THICKNESS * renderer.getPixelRatio(),
      },
      uRippleStrength: { value: reduced ? 0 : RIPPLE_STRENGTH },
      uRippleLifetime: { value: RIPPLE_LIFETIME },
    };

    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const material = new THREE.ShaderMaterial({
      vertexShader: VERTEX_SRC,
      fragmentShader: FRAGMENT_SRC,
      uniforms,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      glslVersion: THREE.GLSL3,
    });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
    scene.add(quad);

    const clock = new THREE.Clock();
    const timeOffset = Math.random() * 1000;

    const setSize = () => {
      const w = container.clientWidth || 1;
      const h = container.clientHeight || 1;
      renderer.setSize(w, h, false);
      uniforms.uResolution.value.set(canvas.width, canvas.height);
      uniforms.uPixelSize.value = PIXEL_SIZE * renderer.getPixelRatio();
      uniforms.uCursorRadius.value =
        CURSOR_RADIUS * renderer.getPixelRatio();
      uniforms.uRippleSpeed.value = RIPPLE_SPEED * renderer.getPixelRatio();
      uniforms.uRippleThickness.value =
        RIPPLE_THICKNESS * renderer.getPixelRatio();
    };
    setSize();
    const ro = new ResizeObserver(setSize);
    ro.observe(container);

    // Pause work when the field is offscreen — avoids painting an idle
    // landing tab forever.
    let visible = true;
    const io = new IntersectionObserver(
      ([entry]) => {
        visible = entry?.isIntersecting ?? true;
      },
      { rootMargin: "200px" },
    );
    io.observe(container);

    // Cursor follow + click ripples — listen on window so pointer events
    // reach us even though the container is pointer-events:none.
    const target = { x: -9999, y: -9999, active: false };
    const smooth = { x: -9999, y: -9999 };
    let clickIx = 0;

    const toCanvasPx = (clientX: number, clientY: number) => {
      const rect = container.getBoundingClientRect();
      const inside =
        clientX >= rect.left &&
        clientX <= rect.right &&
        clientY >= rect.top &&
        clientY <= rect.bottom;
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      const fx = (clientX - rect.left) * scaleX;
      // WebGL fragCoord origin is bottom-left, so flip Y.
      const fy = (rect.height - (clientY - rect.top)) * scaleY;
      return { fx, fy, inside };
    };

    const onMove = (e: MouseEvent) => {
      const { fx, fy, inside } = toCanvasPx(e.clientX, e.clientY);
      if (inside) {
        target.x = fx;
        target.y = fy;
        if (!target.active) {
          smooth.x = fx;
          smooth.y = fy;
        }
        target.active = true;
      } else {
        target.active = false;
      }
    };
    const onLeave = () => {
      target.active = false;
    };
    const onPointerDown = (e: PointerEvent) => {
      if (reduced) return;
      const { fx, fy, inside } = toCanvasPx(e.clientX, e.clientY);
      if (!inside) return;
      const slot = clickPositions[clickIx];
      if (slot) slot.set(fx, fy);
      clickTimes[clickIx] = uniforms.uTime.value;
      clickIx = (clickIx + 1) % MAX_CLICKS;
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseleave", onLeave);
    window.addEventListener("blur", onLeave);
    window.addEventListener("pointerdown", onPointerDown);

    let raf = 0;
    let lastFrame = 0;
    const animate = (now: number) => {
      if (!visible) {
        lastFrame = now;
        raf = requestAnimationFrame(animate);
        return;
      }
      const dt = lastFrame ? Math.min(now - lastFrame, 100) : 16;
      lastFrame = now;

      // Exponential smoothing toward the target so the lift trails the
      // cursor naturally instead of snapping.
      const damping = 1 - Math.exp(-dt / CURSOR_RESPONSE_MS);
      smooth.x += (target.x - smooth.x) * damping;
      smooth.y += (target.y - smooth.y) * damping;
      uniforms.uCursor.value.set(
        target.active ? smooth.x : -9999,
        target.active ? smooth.y : -9999,
      );

      uniforms.uTime.value =
        timeOffset + clock.getElapsedTime() * (reduced ? 0 : FLOW_SPEED);
      renderer.render(scene, camera);
      raf = requestAnimationFrame(animate);
    };
    raf = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseleave", onLeave);
      window.removeEventListener("blur", onLeave);
      window.removeEventListener("pointerdown", onPointerDown);
      quad.geometry.dispose();
      material.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      if (canvas.parentElement === container) container.removeChild(canvas);
    };
  }, [resolved]);

  return (
    <div
      ref={containerRef}
      aria-hidden
      className={`pointer-events-none absolute inset-0 ${className ?? ""}`}
    />
  );
}
