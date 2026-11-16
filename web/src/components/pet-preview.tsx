"use client";

import { useState } from "react";

export function PetPreview() {
  const [happy, setHappy] = useState(false);

  const handleClick = () => {
    setHappy(true);
    window.setTimeout(() => setHappy(false), 1200);
  };

  const accent = happy ? "#fbbf24" : "#36b5ba";

  return (
    <button
      type="button"
      onClick={handleClick}
      title="Click to pet!"
      className="group relative flex h-24 w-24 cursor-pointer items-center justify-center rounded-2xl border border-primary/30 bg-primary/10 p-2 transition-transform hover:scale-105 active:scale-95"
    >
      {happy && (
        <span className="pointer-events-none absolute -top-2 right-1 animate-bounce text-xs text-pink-400">
          ♥
        </span>
      )}
      <svg
        viewBox="0 0 32 32"
        shapeRendering="crispEdges"
        className="h-full w-full drop-shadow-[0_6px_12px_rgba(0,0,0,0.65)]"
      >
        {/* Tail */}
        <rect x="22" y="20" width="5" height="5" fill="#0f172a" />
        <rect x="23" y="21" width="3" height="3" fill="#475569" />
        <rect x="25" y="20" width="2" height="2" fill={accent} />

        {/* Ears */}
        <rect x="7" y="2" width="4" height="4" fill="#0f172a" />
        <rect x="21" y="2" width="4" height="4" fill="#0f172a" />
        <rect x="6" y="4" width="6" height="4" fill="#0f172a" />
        <rect x="20" y="4" width="6" height="4" fill="#0f172a" />
        <rect x="8" y="3" width="2" height="3" fill="#e2e8f0" />
        <rect x="22" y="3" width="2" height="3" fill="#e2e8f0" />
        <rect x="9" y="5" width="2" height="2" fill={accent} />
        <rect x="21" y="5" width="2" height="2" fill={accent} />

        {/* Head */}
        <rect x="6" y="6" width="20" height="12" fill="#0f172a" />
        <rect x="5" y="8" width="22" height="8" fill="#0f172a" />
        <rect x="7" y="7" width="18" height="10" fill="#64748b" />
        <rect x="6" y="9" width="20" height="6" fill="#94a3b8" />
        <rect x="11" y="7" width="10" height="3" fill="#cbd5e1" />

        {/* Visor & Eyes */}
        <rect x="8" y="9" width="16" height="7" fill="#0f172a" />
        <rect x="9" y="10" width="14" height="5" fill="#172554" />
        {happy ? (
          <>
            <rect x="10" y="12" width="1" height="1" fill="#ffffff" />
            <rect x="11" y="11" width="2" height="1" fill="#ffffff" />
            <rect x="13" y="12" width="1" height="1" fill="#ffffff" />
            <rect x="18" y="12" width="1" height="1" fill="#ffffff" />
            <rect x="19" y="11" width="2" height="1" fill="#ffffff" />
            <rect x="21" y="12" width="1" height="1" fill="#ffffff" />
          </>
        ) : (
          <>
            <rect x="10" y="11" width="3" height="3" fill={accent} />
            <rect x="19" y="11" width="3" height="3" fill={accent} />
            <rect x="10" y="11" width="1" height="1" fill="#ffffff" />
            <rect x="19" y="11" width="1" height="1" fill="#ffffff" />
          </>
        )}

        {/* Body */}
        <rect x="9" y="18" width="14" height="8" fill="#0f172a" />
        <rect x="10" y="18" width="12" height="7" fill="#334155" />
        <rect x="12" y="19" width="8" height="5" fill="#475569" />
        <rect x="14" y="20" width="4" height="2" fill={accent} />

        {/* Arms */}
        <rect x="6" y="19" width="3" height="5" fill="#0f172a" />
        <rect x="7" y="20" width="2" height="3" fill="#64748b" />
        <rect x="23" y="19" width="3" height="5" fill="#0f172a" />
        <rect x="23" y="20" width="2" height="3" fill="#64748b" />

        {/* Pixel Electric Guitar */}
        <rect x="11" y="20" width="5" height="4" fill="#f43f5e" />
        <rect x="12" y="21" width="2" height="2" fill="#fb7185" />
        <rect x="16" y="19" width="5" height="1" fill="#38bdf8" />
        <rect x="19" y="18" width="2" height="1" fill="#0f172a" />

        {/* Feet */}
        <rect x="10" y="26" width="4" height="3" fill="#0f172a" />
        <rect x="11" y="26" width="2" height="2" fill="#94a3b8" />
        <rect x="18" y="26" width="4" height="3" fill="#0f172a" />
        <rect x="19" y="26" width="2" height="2" fill="#94a3b8" />
      </svg>
    </button>
  );
}
