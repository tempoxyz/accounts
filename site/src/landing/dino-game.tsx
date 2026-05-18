"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { readCssVar, useTheme } from "./useTheme";

const SCALE = 2;
const CANVAS_W_INITIAL = 560;
const CANVAS_H = 140;
const GROUND_Y = 110;
const GRAVITY = 0.6;
const JUMP_VEL = -10;
const MINER_W = 20;
const MINER_H = 24;
const MINER_DUCK_H = 14;
const INITIAL_SPEED = 3;
const SPEED_INC = 0.001;

/** All hex values consumed below come from styles.css (`--dino-*`,
 * `--salt-*`, `--sparkle-*`). We refresh the palette on every theme
 * change (re-init keys off `resolved`). */
type Palette = {
  body: string;
  skin: string;
  eye: string;
  shadow: string;
  shade: string;
  line: string;
  detail: string;
  leather: string;
  debris: string;
  saltFill: string;
  saltHighlight: string;
  saltEdge: string;
  saltStreak: string;
  sparkleLight: string;
  sparkleWarm: string;
  scoreFg: string;
  gameOverFg: string;
  gameOverSub: string;
};

function readPalette(el: Element): Palette {
  const v = (name: string) => readCssVar(el, name);
  return {
    body: v("--dino-body") || "#f5a623",
    skin: v("--dino-skin") || "#e0c9a6",
    eye: v("--dino-eye") || "#0a0a0a",
    shadow: v("--dino-shadow") || "#737373",
    shade: v("--dino-shade") || "#525252",
    line: v("--dino-line") || "#404040",
    detail: v("--dino-detail") || "#a3a3a3",
    leather: v("--dino-leather") || "#8b5e3c",
    debris: v("--dino-debris") || "#2a2a2a",
    saltFill: v("--salt-fill") || "#d4d4d4",
    saltHighlight: v("--salt-highlight") || "#fafafa",
    saltEdge: v("--salt-edge") || "#a3a3a3",
    saltStreak: v("--salt-streak") || "#e5e5e5",
    sparkleLight: v("--sparkle-light") || "#fafafa",
    sparkleWarm: v("--sparkle-warm") || "#f5a623",
    scoreFg: v("--score-fg") || "#a3a3a3",
    gameOverFg: v("--game-over-fg") || "#fafafa",
    gameOverSub: v("--game-over-sub") || "#a3a3a3",
  };
}

let audioCtx: AudioContext | null = null;
function getAudioCtx() {
  if (!audioCtx) audioCtx = new AudioContext();
  return audioCtx;
}

function playMineSfx() {
  try {
    const ctx = getAudioCtx();
    // short percussive "clink" — pickaxe hitting salt
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "square";
    osc.frequency.setValueAtTime(800, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(400, ctx.currentTime + 0.08);
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.1);
    osc.connect(gain).connect(ctx.destination);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.1);
  } catch {}
}

type SaltBlock = { x: number; h: number; w: number; mined: boolean; sparkle: number };
type Bird = { x: number; y: number; frame: number };

function drawMiner(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  frame: number,
  jumping: boolean,
  p: Palette,
) {
  // hardhat
  ctx.fillStyle = p.body;
  ctx.fillRect(x + 2, y - 4, 16, 4);
  ctx.fillRect(x + 4, y - 6, 12, 2);
  ctx.fillRect(x + 0, y, 20, 2);

  // head
  ctx.fillStyle = p.skin;
  ctx.fillRect(x + 4, y + 2, 12, 8);
  ctx.fillStyle = p.eye;
  ctx.fillRect(x + 12, y + 4, 2, 2);

  // body
  ctx.fillStyle = p.shadow;
  ctx.fillRect(x + 4, y + 10, 12, 10);
  ctx.fillStyle = p.shade;
  ctx.fillRect(x + 4, y + 16, 12, 2);

  // pickaxe (swings)
  const swingUp = !jumping && frame % 20 < 10;
  ctx.fillStyle = p.detail;
  if (swingUp) {
    ctx.fillRect(x + 16, y + 4, 2, 10);
    ctx.fillStyle = p.leather;
    ctx.fillRect(x + 14, y + 2, 6, 2);
    ctx.fillRect(x + 18, y + 2, 2, 4);
  } else {
    ctx.fillRect(x + 16, y + 8, 2, 10);
    ctx.fillStyle = p.leather;
    ctx.fillRect(x + 14, y + 6, 6, 2);
    ctx.fillRect(x + 18, y + 6, 2, 4);
  }

  // legs
  ctx.fillStyle = p.line;
  if (jumping) {
    ctx.fillRect(x + 5, y + 20, 3, 6);
    ctx.fillRect(x + 12, y + 20, 3, 6);
  } else if (frame % 12 < 6) {
    ctx.fillRect(x + 5, y + 20, 3, 6);
    ctx.fillRect(x + 12, y + 20, 3, 3);
  } else {
    ctx.fillRect(x + 5, y + 20, 3, 3);
    ctx.fillRect(x + 12, y + 20, 3, 6);
  }

  // boots
  ctx.fillStyle = p.shade;
  if (jumping) {
    ctx.fillRect(x + 4, y + 26, 5, 2);
    ctx.fillRect(x + 11, y + 26, 5, 2);
  } else if (frame % 12 < 6) {
    ctx.fillRect(x + 4, y + 26, 5, 2);
    ctx.fillRect(x + 11, y + 23, 5, 2);
  } else {
    ctx.fillRect(x + 4, y + 23, 5, 2);
    ctx.fillRect(x + 11, y + 26, 5, 2);
  }
}

function drawMinerDucking(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  frame: number,
  p: Palette,
) {
  // hardhat (flat)
  ctx.fillStyle = p.body;
  ctx.fillRect(x + 0, y, 22, 2);
  ctx.fillRect(x + 2, y - 2, 18, 2);

  // head (leaning forward)
  ctx.fillStyle = p.skin;
  ctx.fillRect(x + 4, y + 2, 14, 6);
  ctx.fillStyle = p.eye;
  ctx.fillRect(x + 14, y + 3, 2, 2);

  // body (crouched, wider)
  ctx.fillStyle = p.shadow;
  ctx.fillRect(x + 2, y + 8, 18, 6);
  ctx.fillStyle = p.shade;
  ctx.fillRect(x + 2, y + 12, 18, 2);

  // pickaxe (held low)
  ctx.fillStyle = p.detail;
  ctx.fillRect(x + 20, y + 4, 8, 2);
  ctx.fillStyle = p.leather;
  ctx.fillRect(x + 26, y + 2, 2, 6);

  // legs (tucked)
  ctx.fillStyle = p.line;
  if (frame % 12 < 6) {
    ctx.fillRect(x + 4, y + 14, 4, 3);
    ctx.fillRect(x + 12, y + 14, 4, 3);
  } else {
    ctx.fillRect(x + 3, y + 14, 4, 3);
    ctx.fillRect(x + 13, y + 14, 4, 3);
  }
}

function drawSaltBlock(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  p: Palette,
) {
  ctx.fillStyle = p.saltFill;
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = p.saltHighlight;
  ctx.fillRect(x, y, w, 2);
  ctx.fillRect(x, y, 2, h);
  ctx.fillStyle = p.saltEdge;
  ctx.fillRect(x + w - 2, y, 2, h);
  ctx.fillRect(x, y + h - 2, w, 2);
  ctx.fillStyle = p.saltStreak;
  ctx.fillRect(x + 4, y + Math.floor(h * 0.3), Math.floor(w * 0.4), 1);
}

function drawSparkle(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  t: number,
  p: Palette,
) {
  const alpha = Math.max(0, 1 - t / 20);
  ctx.globalAlpha = alpha;
  ctx.fillStyle = p.sparkleLight;
  const spread = t * 1.5;
  ctx.fillRect(x - spread, y - spread, 2, 2);
  ctx.fillRect(x + spread, y - spread * 0.7, 2, 2);
  ctx.fillRect(x - spread * 0.5, y - spread * 1.2, 2, 2);
  ctx.fillRect(x + spread * 0.8, y - spread * 1.5, 2, 2);
  ctx.fillStyle = p.sparkleWarm;
  ctx.fillRect(x, y - spread * 0.5, 2, 2);
  ctx.fillRect(x + spread * 0.3, y - spread, 2, 2);
  ctx.globalAlpha = 1;
}

function drawBird(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  frame: number,
  p: Palette,
) {
  ctx.fillStyle = p.detail;
  // body
  ctx.fillRect(x + 4, y + 4, 10, 6);
  // head
  ctx.fillRect(x + 14, y + 4, 6, 4);
  // beak
  ctx.fillStyle = p.body;
  ctx.fillRect(x + 20, y + 5, 3, 2);
  // eye
  ctx.fillStyle = p.eye;
  ctx.fillRect(x + 17, y + 5, 2, 2);
  // wings (flap)
  ctx.fillStyle = p.shadow;
  if (frame % 16 < 8) {
    ctx.fillRect(x + 6, y, 8, 4);
    ctx.fillRect(x + 8, y - 2, 4, 2);
  } else {
    ctx.fillRect(x + 6, y + 10, 8, 4);
    ctx.fillRect(x + 8, y + 14, 4, 2);
  }
  // tail
  ctx.fillStyle = p.detail;
  ctx.fillRect(x, y + 2, 4, 4);
}

export function DinoGame() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const widthRef = useRef(CANVAS_W_INITIAL);
  const { resolved } = useTheme();
  const stateRef = useRef({
    minerY: GROUND_Y - MINER_H - 4,
    velY: 0,
    jumping: false,
    ducking: false,
    salts: [] as SaltBlock[],
    birds: [] as Bird[],
    speed: INITIAL_SPEED,
    score: 0,
    gameOver: false,
    frameCount: 0,
    saltTimer: 30,
    birdTimer: 100,
  });
  const animRef = useRef<number>(0);
  const [, setScore] = useState(0);
  const [, setGameOver] = useState(false);

  const reset = useCallback(() => {
    const s = stateRef.current;
    s.minerY = GROUND_Y - MINER_H - 4;
    s.velY = 0;
    s.jumping = false;
    s.ducking = false;
    s.salts = [];
    s.birds = [];
    s.speed = INITIAL_SPEED;
    s.score = 0;
    s.gameOver = false;
    s.frameCount = 0;
    s.saltTimer = 30;
    s.birdTimer = 100;
    setGameOver(false);
    setScore(0);
  }, []);

  const jump = useCallback(() => {
    const s = stateRef.current;
    if (s.gameOver) {
      reset();
      return;
    }
    if (!s.jumping) {
      s.velY = JUMP_VEL;
      s.jumping = true;
    }
  }, [reset]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === "Space" || e.code === "ArrowUp") {
        e.preventDefault();
        jump();
      }
      if (e.code === "ArrowDown") {
        e.preventDefault();
        const s = stateRef.current;
        if (s.gameOver) return;
        s.ducking = true;
        if (s.jumping) s.velY = Math.max(s.velY, 8);
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === "ArrowDown") {
        stateRef.current.ducking = false;
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, [jump]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const ctx = canvas.getContext("2d")!;
    const palette = readPalette(canvas);

    const sync = (dispW: number) => {
      canvas.width = dispW;
      widthRef.current = Math.floor(dispW / SCALE);
    };

    const initialDisp = Math.floor(container.getBoundingClientRect().width) || CANVAS_W_INITIAL * SCALE;
    sync(initialDisp);

    const ro = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const dispW = Math.floor(entry.contentRect.width);
      if (dispW > 0 && dispW !== canvas.width) sync(dispW);
    });
    ro.observe(container);

    const loop = () => {
      const s = stateRef.current;
      const minerBottom = GROUND_Y - MINER_H - 4;
      const W = widthRef.current;

      if (!s.gameOver) {
        // physics
        s.velY += GRAVITY;
        s.minerY += s.velY;
        if (s.minerY >= minerBottom) {
          s.minerY = minerBottom;
          s.velY = 0;
          s.jumping = false;
        }

        // spawn salt blocks (collectibles)
        s.saltTimer--;
        if (s.saltTimer <= 0) {
          const w = 14 + Math.random() * 6;
          s.salts.push({
            x: W,
            h: 10 + Math.random() * 8,
            w,
            mined: false,
            sparkle: 0,
          });
          s.saltTimer = 40 + Math.random() * 60;
        }

        // spawn birds (obstacles) - low birds (jump) and high birds (duck)
        s.birdTimer--;
        if (s.birdTimer <= 0) {
          const isHigh = Math.random() < 0.4;
          s.birds.push({
            x: W,
            y: isHigh ? GROUND_Y - 50 - Math.random() * 15 : GROUND_Y - 20 - Math.random() * 15,
            frame: 0,
          });
          s.birdTimer = 80 + Math.random() * 100;
        }

        // move salt blocks
        for (const b of s.salts) b.x -= s.speed;
        // mine salt when miner passes over it
        const mLeft = 30;
        const mRight = mLeft + MINER_W;
        for (const b of s.salts) {
          if (!b.mined && mRight > b.x && mLeft < b.x + b.w) {
            b.mined = true;
            b.sparkle = 1;
            s.score += 10;
            setScore(s.score);
            playMineSfx();
          }
          if (b.mined && b.sparkle > 0) b.sparkle++;
        }
        s.salts = s.salts.filter((b) => b.x + b.w > 0 && (!b.mined || b.sparkle < 25));

        // move birds
        for (const b of s.birds) {
          b.x -= s.speed + 1;
          b.frame++;
        }
        s.birds = s.birds.filter((b) => b.x + 24 > 0);

        // bird collision (ducking reduces height)
        const effectiveH = s.ducking ? MINER_DUCK_H : MINER_H + 4;
        const mTop = s.ducking ? GROUND_Y - MINER_DUCK_H - 2 : s.minerY - 6;
        const mBottom = mTop + effectiveH;
        for (const b of s.birds) {
          if (
            mRight > b.x + 4 &&
            mLeft < b.x + 18 &&
            mBottom > b.y + 2 &&
            mTop < b.y + 12
          ) {
            s.gameOver = true;
            setGameOver(true);
            break;
          }
        }

        s.speed += SPEED_INC;
        s.frameCount++;
      }

      // draw
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.save();
      ctx.scale(SCALE, SCALE);

      // ground
      ctx.strokeStyle = palette.line;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, GROUND_Y + 0.5);
      ctx.lineTo(W, GROUND_Y + 0.5);
      ctx.stroke();

      // ground debris
      ctx.fillStyle = palette.debris;
      for (let i = 0; i < W; i += 30) {
        const offset = (i * 7 + s.frameCount) % 40;
        ctx.fillRect(((i + offset * s.speed * 0.3) % W), GROUND_Y + 2, 2, 1);
        ctx.fillRect(((i + 15 + offset * s.speed * 0.3) % W), GROUND_Y + 4, 1, 1);
      }

      // salt blocks (draw before miner so sparkles show on top)
      for (const b of s.salts) {
        if (b.mined) {
          if (b.sparkle < 25) {
            drawSparkle(ctx, b.x + b.w / 2, GROUND_Y - b.h / 2, b.sparkle, palette);
          }
        } else {
          drawSaltBlock(ctx, b.x, GROUND_Y - b.h, b.w, b.h, palette);
        }
      }

      // miner
      if (s.ducking && !s.jumping) {
        drawMinerDucking(ctx, 30, GROUND_Y - MINER_DUCK_H - 2, s.frameCount, palette);
      } else {
        drawMiner(ctx, 30, s.minerY, s.frameCount, s.jumping, palette);
      }

      // birds
      for (const b of s.birds) {
        drawBird(ctx, b.x, b.y, b.frame, palette);
      }

      // score
      ctx.fillStyle = palette.scoreFg;
      ctx.font = "11px 'Geist Mono', monospace";
      ctx.textAlign = "right";
      ctx.fillText(`⛏ ${String(s.score).padStart(5, "0")}`, W - 12, 20);

      // game over
      if (s.gameOver) {
        ctx.fillStyle = palette.gameOverFg;
        ctx.font = "12px 'Geist Mono', monospace";
        ctx.textAlign = "center";
        ctx.fillText("REKT", W / 2, CANVAS_H / 2 - 4);
        ctx.fillStyle = palette.gameOverSub;
        ctx.font = "10px 'Geist Mono', monospace";
        ctx.fillText(
          "tap or space to restart",
          W / 2,
          CANVAS_H / 2 + 12
        );
      }

      ctx.restore();
      animRef.current = requestAnimationFrame(loop);
    };

    animRef.current = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(animRef.current);
      ro.disconnect();
    };
  }, [resolved]);

  return (
    <div ref={containerRef} className="cursor-pointer" onClick={jump}>
      <canvas
        ref={canvasRef}
        width={CANVAS_W_INITIAL * SCALE}
        height={CANVAS_H * SCALE}
        className="block w-full"
        style={{ height: CANVAS_H * SCALE }}
      />
    </div>
  );
}
