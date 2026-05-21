import { spring } from "animejs";

/** Shared Anime.js spring presets for landing page WAAPI motion. */
export const springs = {
  snappy: spring({ stiffness: 2000, damping: 80, mass: 1 }),
  gentle: spring({ stiffness: 800, damping: 50, mass: 1 }),
  entrance: spring({ stiffness: 220, damping: 26, mass: 1 }),
  navEntrance: spring({ stiffness: 440, damping: 28, mass: 1 }),
  progress: spring({ stiffness: 220, damping: 24, mass: 1 }),
} as const;
