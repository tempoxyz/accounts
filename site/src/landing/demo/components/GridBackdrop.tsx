"use client";

export function GridBackdrop() {
  // Concentric horizontal dashed lines centered on the browser frame.
  // Extends past the section's px-6 so lines reach the container edges.
  const heights = [588, 487, 381, 265, 145];
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute -inset-x-6 inset-y-0 flex items-center justify-center overflow-hidden"
    >
      <div className="relative h-full w-full">
        {heights.map((h) => (
          <div
            key={h}
            className="dash-t dash-b absolute left-0 right-0"
            style={{
              height: h,
              top: `calc(50% - ${h / 2}px)`,
            }}
          />
        ))}
      </div>
    </div>
  );
}
