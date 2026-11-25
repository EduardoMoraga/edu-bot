import { useRef } from "react";
import { useLiveMotion } from "./cloud-buy/live-motion";

export type EduMascotMood = "idle" | "happy" | "thinking";

const BODY = "M19 14h26a13 13 0 0 1 13 13v12a13 13 0 0 1-13 13H27l-13 9 3-10.3A13 13 0 0 1 6 39V27a13 13 0 0 1 13-13Z";
const SPARK = "M54 3l1.6 4.4L60 9l-4.4 1.6L54 15l-1.6-4.4L48 9l4.4-1.6L54 3Z";
const THOUGHT_DOTS = [[49, 9.5, 1.5, 0.45], [54.5, 6, 2, 0.7], [60, 2.8, 2.4, 1]] as const;
const INK = "var(--color-accent-ink)";

function Face({ mood }: { mood: EduMascotMood }) {
  if (mood === "happy") {
    return (
      <g fill="none" stroke={INK} strokeWidth="2.8" strokeLinecap="round">
        <path d="M20.5 31c1.6-3.4 5.4-3.4 7 0" />
        <path d="M36.5 31c1.6-3.4 5.4-3.4 7 0" />
        <path d="M23.5 38c4.5 6 12.5 6 17 0" />
      </g>
    );
  }
  if (mood === "thinking") {
    return (
      <g>
        <circle cx="26" cy="28.5" r="2.7" fill={INK} />
        <circle cx="42" cy="28.5" r="2.7" fill={INK} />
        <path d="M28 40h8" fill="none" stroke={INK} strokeWidth="2.8" strokeLinecap="round" />
      </g>
    );
  }
  return (
    <g>
      <circle cx="24" cy="30" r="2.7" fill={INK} />
      <circle cx="40" cy="30" r="2.7" fill={INK} />
      <path d="M26 38.5c3.5 3.5 8.5 3.5 12 0" fill="none" stroke={INK} strokeWidth="2.8" strokeLinecap="round" />
    </g>
  );
}

/** The app's own character, never a bot's face. It hops once when it turns happy and its thought dots pulse while it
 * thinks; `animated` false, reduced motion or being off screen hold it still. Without a `label` it is decoration. */
export function EduMascot({ mood = "idle", size = 44, label, animated = true }: {
  mood?: EduMascotMood;
  size?: number;
  label?: string;
  animated?: boolean;
}) {
  const root = useRef<HTMLSpanElement>(null);
  const moving = useLiveMotion(root) && animated;
  return (
    <span ref={root} data-edu-mascot={mood} data-moving={moving ? "" : undefined} className="inline-flex shrink-0"
      {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": true })}>
      <svg width={size} height={size} viewBox="0 0 64 64" fill="none" aria-hidden="true">
        <g key={mood} className={mood === "happy" ? "edu-mascot-hop" : undefined}>
          <path d={BODY} fill="var(--color-accent)" />
          <Face mood={mood} />
          {mood === "happy" && <path d={SPARK} fill="var(--color-accent-text)" />}
          {mood === "thinking" && (
            <g fill="var(--color-accent-text)">
              {THOUGHT_DOTS.map(([cx, cy, r, opacity]) => <circle key={cx} className="edu-mascot-dot" cx={cx} cy={cy} r={r} opacity={opacity} />)}
            </g>
          )}
        </g>
      </svg>
    </span>
  );
}
