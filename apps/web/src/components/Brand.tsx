// Brand marks: the 3D brain that stands for LORE, and the avatar used beside
// chat turns. The brain is drawn as layered gradients — a dark base, a lit
// hemisphere and glowing gyri — so it reads as a solid object rather than a
// flat icon, at 20px in the sidebar and 28px in a chat.
import { useEffect, useState } from "react";
import { api } from "../lib/api";

export function BrainMark({ size = 28 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      role="img"
      aria-label="EXPANDABLES LORE"
      className="shrink-0"
    >
      <defs>
        <radialGradient id="lore-brain-core" cx="38%" cy="30%" r="78%">
          <stop offset="0%" stopColor="#a9f1ff" />
          <stop offset="38%" stopColor="#5aa9ff" />
          <stop offset="72%" stopColor="#7c5cff" />
          <stop offset="100%" stopColor="#2b1d6b" />
        </radialGradient>
        <linearGradient id="lore-brain-rim" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#8ef2ff" stopOpacity="0.95" />
          <stop offset="55%" stopColor="#9d7bff" stopOpacity="0.55" />
          <stop offset="100%" stopColor="#ff6ad5" stopOpacity="0.75" />
        </linearGradient>
        <radialGradient id="lore-brain-glow" cx="50%" cy="45%" r="55%">
          <stop offset="0%" stopColor="#6ee7ff" stopOpacity="0.55" />
          <stop offset="100%" stopColor="#6ee7ff" stopOpacity="0" />
        </radialGradient>
        <filter id="lore-brain-soft" x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="1.4" />
        </filter>
      </defs>

      {/* halo */}
      <circle cx="32" cy="32" r="30" fill="url(#lore-brain-glow)" />

      {/* silhouette: two hemispheres with a fissure down the middle */}
      <path
        d="M31 9.5c-6.2-3.6-14.5-1.1-16.4 5.1-3.7 1.3-6.1 4.7-6.1 8.6 0 2.9 1.5 5.4 3.6 6.9-1 1.4-1.6 3.1-1.6 5 0 4.6 3.7 8.3 8.3 8.3.7 0 1.4-.1 2-.3 1.6 4.1 5.6 6.9 10.1 6.6v-40.2z"
        fill="url(#lore-brain-core)"
      />
      <path
        d="M33 9.5c6.2-3.6 14.5-1.1 16.4 5.1 3.7 1.3 6.1 4.7 6.1 8.6 0 2.9-1.5 5.4-3.6 6.9 1 1.4 1.6 3.1 1.6 5 0 4.6-3.7 8.3-8.3 8.3-.7 0-1.4-.1-2-.3-1.6 4.1-5.6 6.9-10.1 6.6v-40.2z"
        fill="url(#lore-brain-core)"
        opacity="0.92"
      />

      {/* the fissure, which is what makes it read as a brain */}
      <path d="M32 10.5v40" stroke="#1b1440" strokeWidth="1.6" opacity="0.75" />

      {/* gyri: glowing folds, slightly blurred so they sit inside the volume */}
      <g
        fill="none"
        stroke="url(#lore-brain-rim)"
        strokeWidth="1.5"
        strokeLinecap="round"
        filter="url(#lore-brain-soft)"
      >
        <path d="M22 20c4 1 6 4 5.5 7.5" />
        <path d="M18 27c3.5 0 6 2 6.5 5" />
        <path d="M21 36c3-.5 5.5 1 6.5 3.5" />
        <path d="M27 43c1.5-1.5 3-2 4.5-1.5" />
        <path d="M42 20c-4 1-6 4-5.5 7.5" />
        <path d="M46 27c-3.5 0-6 2-6.5 5" />
        <path d="M43 36c-3-.5-5.5 1-6.5 3.5" />
        <path d="M37 43c-1.5-1.5-3-2-4.5-1.5" />
      </g>

      {/* specular highlight, the "3D" tell */}
      <ellipse cx="24" cy="19.5" rx="6.5" ry="4" fill="#ffffff" opacity="0.28" />
      <circle cx="24.5" cy="18.6" r="1.6" fill="#ffffff" opacity="0.7" />
    </svg>
  );
}

/** A person's picture, or their initials until they upload one. */
export function Avatar({
  token,
  userId,
  hasAvatar,
  name,
  size = 28,
}: {
  token: string;
  userId: string;
  hasAvatar: boolean;
  name: string;
  size?: number;
}) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!hasAvatar) {
      setUrl(null);
      return;
    }
    let active = true;
    let objectUrl: string | null = null;
    api
      .avatarBlob(token, userId)
      .then((blob) => {
        if (!active) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => {
        // a missing avatar just falls back to initials
      });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [token, userId, hasAvatar]);

  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");

  if (url) {
    return (
      <img
        src={url}
        alt={name}
        width={size}
        height={size}
        className="shrink-0 rounded-full border border-[rgb(var(--glass-border))] object-cover"
        style={{ width: size, height: size }}
      />
    );
  }

  return (
    <span
      aria-label={name}
      className="grid shrink-0 place-items-center rounded-full bg-slate-800/80 text-[10px] font-semibold text-slate-300"
      style={{ width: size, height: size }}
    >
      {initials || "·"}
    </span>
  );
}
