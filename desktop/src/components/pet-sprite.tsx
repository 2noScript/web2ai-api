export type PetId = "fox" | "bot" | "cat" | "owl" | "shiba";
export type PetStatus =
  | "idle"
  | "typing"
  | "thinking"
  | "waiting"
  | "streaming"
  | "done"
  | "error"
  | "happy"
  | "annoyed"
  | "shy"
  | "wink";

export interface PetDefinition {
  id: PetId;
  name: string;
  tagline: string;
  badge: string;
}

export const PET_CATALOG: PetDefinition[] = [
  {
    id: "fox",
    name: "Cyber Fox",
    tagline: "Arctic fox rocking a neon Electric Guitar & glowing visor.",
    badge: "Guitarist",
  },
  {
    id: "bot",
    name: "Terminal Bot",
    tagline: "Codex cloud buddy with >_ visor & glowing Cyber Mic.",
    badge: "Vocalist",
  },
  {
    id: "cat",
    name: "Pixel Neko",
    tagline: "Midnight cyber cat playing a serene Bamboo Flute.",
    badge: "Flutist",
  },
  {
    id: "owl",
    name: "Night Owl",
    tagline: "Late-night coding owl waving a Star Conductor Wand.",
    badge: "Maestro",
  },
  {
    id: "shiba",
    name: "Shiba Dev",
    tagline: "Cheerful Shiba Inu keeping the beat on a Taiko Drum.",
    badge: "Drummer",
  },
];

export const PET_STORAGE_KEY = "web2ai_selected_pet_id";

export function getSavedPetId(): PetId {
  const saved = localStorage.getItem(PET_STORAGE_KEY) as PetId | null;
  if (saved && PET_CATALOG.some((p) => p.id === saved)) {
    return saved;
  }
  return "fox";
}

interface PetSpriteProps {
  petId: PetId;
  status: PetStatus;
  size?: "sm" | "md" | "lg";
}

function renderEyes(status: PetStatus, accent: string, visorY = 11) {
  if (status === "done" || status === "happy") {
    return (
      <g fill={status === "happy" ? "#fbbf24" : "#00e5ff"}>
        <rect x="10" y={visorY + 1} width="1" height="1" />
        <rect x="11" y={visorY} width="2" height="1" />
        <rect x="13" y={visorY + 1} width="1" height="1" />
        <rect x="18" y={visorY + 1} width="1" height="1" />
        <rect x="19" y={visorY} width="2" height="1" />
        <rect x="21" y={visorY + 1} width="1" height="1" />
      </g>
    );
  }
  if (status === "annoyed") {
    // Furrowed pouting brows + sharp eyes (>_< / ` ´)
    return (
      <g>
        <rect x="10" y={visorY - 1} width="2" height="1" fill="#f87171" />
        <rect x="12" y={visorY} width="1" height="1" fill="#f87171" />
        <rect x="20" y={visorY - 1} width="2" height="1" fill="#f87171" />
        <rect x="19" y={visorY} width="1" height="1" fill="#f87171" />
        <rect x="10" y={visorY + 1} width="3" height="2" fill="#fca5a5" />
        <rect x="19" y={visorY + 1} width="3" height="2" fill="#fca5a5" />
      </g>
    );
  }
  if (status === "wink") {
    return (
      <g>
        {/* Left eye winking '>' */}
        <rect x="10" y={visorY} width="2" height="1" fill="#67e8f9" />
        <rect x="12" y={visorY + 1} width="1" height="1" fill="#67e8f9" />
        <rect x="10" y={visorY + 2} width="2" height="1" fill="#67e8f9" />
        {/* Right eye bright */}
        <rect x="19" y={visorY} width="3" height="3" fill={accent} />
        <rect x="20" y={visorY} width="1" height="1" fill="#ffffff" />
      </g>
    );
  }
  if (status === "shy") {
    // Big cute eyes looking slightly aside
    return (
      <g>
        <rect x="10" y={visorY} width="3" height="3" fill={accent} />
        <rect x="19" y={visorY} width="3" height="3" fill={accent} />
        <rect x="10" y={visorY} width="1" height="1" fill="#ffffff" />
        <rect x="19" y={visorY} width="1" height="1" fill="#ffffff" />
        <rect x="11" y={visorY + 2} width="1" height="1" fill="#ffffff" />
        <rect x="20" y={visorY + 2} width="1" height="1" fill="#ffffff" />
      </g>
    );
  }
  if (status === "error") {
    return (
      <g fill="#f87171">
        <rect x="10" y={visorY} width="1" height="1" />
        <rect x="12" y={visorY} width="1" height="1" />
        <rect x="11" y={visorY + 1} width="1" height="1" />
        <rect x="10" y={visorY + 2} width="1" height="1" />
        <rect x="12" y={visorY + 2} width="1" height="1" />

        <rect x="19" y={visorY} width="1" height="1" />
        <rect x="21" y={visorY} width="1" height="1" />
        <rect x="20" y={visorY + 1} width="1" height="1" />
        <rect x="19" y={visorY + 2} width="1" height="1" />
        <rect x="21" y={visorY + 2} width="1" height="1" />
      </g>
    );
  }
  if (status === "waiting") {
    // Half-lidded impatient / sleepy eyes (-_-)
    return (
      <g>
        <rect x="10" y={visorY} width="3" height="1" fill="#64748b" />
        <rect x="19" y={visorY} width="3" height="1" fill="#64748b" />
        <rect x="10" y={visorY + 1} width="3" height="1" fill={accent} />
        <rect x="19" y={visorY + 1} width="3" height="1" fill={accent} />
      </g>
    );
  }
  if (status === "typing") {
    // Attentive curious eyes looking down toward chat input + raised brow
    return (
      <g>
        <rect x="10" y={visorY - 1} width="3" height="1" fill="#94a3b8" />
        <rect x="19" y={visorY - 1} width="2" height="1" fill="#94a3b8" />
        <rect x="10" y={visorY} width="3" height="3" fill={accent} />
        <rect x="19" y={visorY} width="3" height="3" fill={accent} />
        <rect x="11" y={visorY + 2} width="1" height="1" fill="#ffffff" />
        <rect x="20" y={visorY + 2} width="1" height="1" fill="#ffffff" />
      </g>
    );
  }
  if (status === "thinking") {
    // Scanning eyes looking side-to-side
    return (
      <g className="animate-pet-eyes-scan">
        <rect x="10" y={visorY} width="3" height="3" fill={accent} />
        <rect x="19" y={visorY} width="3" height="3" fill={accent} />
        <rect x="11" y={visorY} width="1" height="1" fill="#ffffff" />
        <rect x="20" y={visorY} width="1" height="1" fill="#ffffff" />
      </g>
    );
  }
  if (status === "streaming") {
    // Bright wide excited eyes
    return (
      <g>
        <rect x="10" y={visorY} width="3" height="3" fill="#67e8f9" />
        <rect x="19" y={visorY} width="3" height="3" fill="#67e8f9" />
        <rect x="11" y={visorY} width="1" height="1" fill="#ffffff" />
        <rect x="20" y={visorY} width="1" height="1" fill="#ffffff" />
        <rect x="12" y={visorY + 2} width="1" height="1" fill="#ffffff" />
        <rect x="21" y={visorY + 2} width="1" height="1" fill="#ffffff" />
      </g>
    );
  }
  return (
    <g className="origin-[16px_12px] animate-fox-blink">
      <rect x="10" y={visorY} width="3" height="3" fill={accent} />
      <rect x="19" y={visorY} width="3" height="3" fill={accent} />
      <rect x="11" y={visorY} width="1" height="1" fill="#ffffff" />
      <rect x="20" y={visorY} width="1" height="1" fill="#ffffff" />
    </g>
  );
}

function renderCheeks(status: PetStatus, cheekY = 14) {
  if (
    status !== "done" &&
    status !== "streaming" &&
    status !== "typing" &&
    status !== "happy" &&
    status !== "shy" &&
    status !== "wink" &&
    status !== "annoyed"
  ) {
    return null;
  }
  return (
    <g
      fill={status === "annoyed" ? "#ef4444" : "#fb7185"}
      opacity={status === "shy" || status === "done" || status === "happy" ? 0.95 : 0.65}
    >
      <rect x="8" y={cheekY} width="2" height="1" />
      <rect x="22" y={cheekY} width="2" height="1" />
    </g>
  );
}

function renderMouth(status: PetStatus, mouthY = 15) {
  if (status === "streaming") {
    return (
      <g className="origin-[16px_15px] animate-pet-mouth-talk">
        <rect x="14" y={mouthY} width="4" height="2" fill="#0f172a" />
        <rect x="15" y={mouthY} width="2" height="1" fill="#fb7185" />
      </g>
    );
  }
  if (status === "done" || status === "happy" || status === "wink") {
    return (
      <g fill="#0f172a">
        <rect x="14" y={mouthY} width="1" height="1" />
        <rect x="15" y={mouthY + 1} width="2" height="1" />
        <rect x="17" y={mouthY} width="1" height="1" />
      </g>
    );
  }
  if (status === "shy") {
    // Cute 'w' cat-like shy mouth
    return (
      <g fill="#fb7185">
        <rect x="14" y={mouthY} width="1" height="1" />
        <rect x="15" y={mouthY + 1} width="2" height="1" />
        <rect x="17" y={mouthY} width="1" height="1" />
      </g>
    );
  }
  if (status === "annoyed") {
    // Pouty zig-zag mouth
    return (
      <g fill="#f87171">
        <rect x="14" y={mouthY + 1} width="2" height="1" />
        <rect x="16" y={mouthY} width="2" height="1" />
      </g>
    );
  }
  if (status === "error") {
    return (
      <g fill="#f87171">
        <rect x="14" y={mouthY + 1} width="1" height="1" />
        <rect x="15" y={mouthY} width="2" height="1" />
        <rect x="17" y={mouthY + 1} width="1" height="1" />
      </g>
    );
  }
  if (status === "waiting") {
    return <rect x="14" y={mouthY} width="4" height="1" fill="#94a3b8" />;
  }
  if (status === "typing") {
    return <rect x="15" y={mouthY} width="2" height="1" fill="#67e8f9" />;
  }
  return null;
}

function armAnimClass(status: PetStatus, side: "l" | "r"): string {
  if (
    status === "happy" ||
    status === "done" ||
    status === "streaming" ||
    status === "wink"
  ) {
    return side === "l" ? "animate-pet-arm-cheer-l" : "animate-pet-arm-cheer-r";
  }
  if (status === "annoyed" || status === "error") {
    return "animate-fox-shake";
  }
  if (status === "thinking" || status === "typing" || status === "shy") {
    return side === "l" ? "animate-fox-ear-l" : "animate-fox-ear-r";
  }
  return side === "l" ? "animate-pet-arm-l" : "animate-pet-arm-r";
}

function footAnimClass(status: PetStatus, side: "l" | "r"): string {
  if (
    status === "happy" ||
    status === "done" ||
    status === "streaming" ||
    status === "wink"
  ) {
    return side === "l" ? "animate-pet-foot-l" : "animate-pet-foot-r";
  }
  if (status === "waiting" && side === "r") {
    return "animate-pet-foot-r";
  }
  return "";
}

function propAnimClass(status: PetStatus): string {
  if (
    status === "happy" ||
    status === "done" ||
    status === "streaming" ||
    status === "wink" ||
    status === "thinking"
  ) {
    return "animate-pet-prop-play";
  }
  return "";
}

function FoxSvg({ status, accent }: { status: PetStatus; accent: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      shapeRendering="crispEdges"
      className="h-full w-full drop-shadow-[0_6px_10px_rgba(0,0,0,0.65)]"
    >
      <g className="origin-[22px_23px] animate-fox-ear-r">
        <rect x="22" y="20" width="5" height="5" fill="#0f172a" />
        <rect x="23" y="21" width="3" height="3" fill="#475569" />
        <rect x="25" y="20" width="2" height="2" fill={accent} />
      </g>
      <rect x="7" y="2" width="4" height="4" fill="#0f172a" />
      <rect x="21" y="2" width="4" height="4" fill="#0f172a" />
      <rect x="6" y="4" width="6" height="4" fill="#0f172a" />
      <rect x="20" y="4" width="6" height="4" fill="#0f172a" />
      <rect x="8" y="3" width="2" height="3" fill="#e2e8f0" />
      <rect x="22" y="3" width="2" height="3" fill="#e2e8f0" />
      <rect x="9" y="5" width="2" height="2" fill={accent} />
      <rect x="21" y="5" width="2" height="2" fill={accent} />

      <rect x="6" y="6" width="20" height="12" fill="#0f172a" />
      <rect x="5" y="8" width="22" height="8" fill="#0f172a" />
      <rect x="7" y="7" width="18" height="10" fill="#64748b" />
      <rect x="6" y="9" width="20" height="6" fill="#94a3b8" />
      <rect x="11" y="7" width="10" height="3" fill="#cbd5e1" />

      <rect x="8" y="9" width="16" height="7" fill="#0f172a" />
      <rect x="9" y="10" width="14" height="5" fill="#172554" />
      {renderEyes(status, accent, 11)}
      {renderCheeks(status, 14)}
      {renderMouth(status, 14)}

      <rect x="9" y="18" width="14" height="8" fill="#0f172a" />
      <rect x="10" y="18" width="12" height="7" fill="#334155" />
      <rect x="12" y="19" width="8" height="5" fill="#475569" />
      <rect x="14" y="20" width="4" height="2" fill={accent} />

      <g className={`origin-[9px_19px] ${armAnimClass(status, "l")}`}>
        <rect x="6" y="19" width="3" height="5" fill="#0f172a" />
        <rect x="7" y="20" width="2" height="3" fill="#64748b" />
      </g>
      <g className={`origin-[23px_19px] ${armAnimClass(status, "r")}`}>
        <rect x="23" y="19" width="3" height="5" fill="#0f172a" />
        <rect x="23" y="20" width="2" height="3" fill="#64748b" />
      </g>
      {/* Prop: Pixel Electric Guitar */}
      <g className={`origin-[15px_22px] ${propAnimClass(status)}`}>
        <rect x="11" y="20" width="5" height="4" fill="#f43f5e" />
        <rect x="12" y="21" width="2" height="2" fill="#fb7185" />
        <rect x="16" y="19" width="5" height="1" fill="#38bdf8" />
        <rect x="19" y="18" width="2" height="1" fill="#0f172a" />
      </g>
      <g className={`origin-[12px_26px] ${footAnimClass(status, "l")}`}>
        <rect x="10" y="26" width="4" height="3" fill="#0f172a" />
        <rect x="11" y="26" width="2" height="2" fill="#94a3b8" />
      </g>
      <g className={`origin-[20px_26px] ${footAnimClass(status, "r")}`}>
        <rect x="18" y="26" width="4" height="3" fill="#0f172a" />
        <rect x="19" y="26" width="2" height="2" fill="#94a3b8" />
      </g>
    </svg>
  );
}

function BotSvg({ status, accent }: { status: PetStatus; accent: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      shapeRendering="crispEdges"
      className="h-full w-full drop-shadow-[0_6px_10px_rgba(0,0,0,0.65)]"
    >
      {/* Cloud / Fluffy Terminal Head Outline */}
      <rect x="10" y="3" width="12" height="3" fill="#0f172a" />
      <rect x="7" y="5" width="18" height="4" fill="#0f172a" />
      <rect x="5" y="7" width="22" height="10" fill="#0f172a" />
      <rect x="7" y="16" width="18" height="3" fill="#0f172a" />
      {/* Blue Cloud Fill */}
      <rect x="11" y="4" width="10" height="3" fill="#60a5fa" />
      <rect x="8" y="6" width="16" height="3" fill="#60a5fa" />
      <rect x="6" y="8" width="20" height="8" fill="#3b82f6" />
      <rect x="8" y="15" width="16" height="3" fill="#2563eb" />

      {/* Terminal Screen */}
      <rect x="8" y="9" width="16" height="8" fill="#0f172a" />
      <rect x="9" y="10" width="14" height="6" fill="#172554" />

      {/* >_ Face */}
      {status === "error" ||
      status === "done" ||
      status === "waiting" ||
      status === "happy" ||
      status === "annoyed" ||
      status === "shy" ||
      status === "wink" ? (
        <>
          {renderEyes(status, accent, 11)}
          {renderCheeks(status, 14)}
        </>
      ) : status === "streaming" ? (
        <g>
          {/* Animated equalizer bars while talking */}
          <rect x="11" y="12" width="2" height="3" fill="#67e8f9" className="origin-[12px_14px] animate-pet-mouth-talk" />
          <rect x="15" y="11" width="2" height="4" fill="#38bdf8" className="origin-[16px_14px] animate-pet-mouth-talk [animation-delay:90ms]" />
          <rect x="19" y="12" width="2" height="3" fill="#67e8f9" className="origin-[20px_14px] animate-pet-mouth-talk [animation-delay:180ms]" />
        </g>
      ) : (
        <g
          className={
            status === "thinking"
              ? "animate-pet-eyes-scan"
              : status === "idle"
                ? "origin-[16px_13px] animate-fox-blink"
                : ""
          }
        >
          {/* '>' */}
          <rect x="11" y="11" width="1" height="1" fill="#67e8f9" />
          <rect x="12" y="12" width="1" height="1" fill="#67e8f9" />
          <rect x="11" y="13" width="1" height="1" fill="#67e8f9" />
          {/* '_' */}
          <rect
            x="17"
            y="14"
            width="4"
            height="1"
            fill={accent}
            className={status === "typing" ? "animate-pulse" : ""}
          />
        </g>
      )}

      {/* Body */}
      <rect x="9" y="18" width="14" height="8" fill="#0f172a" />
      <rect x="10" y="19" width="12" height="6" fill="#3b82f6" />
      <rect x="13" y="21" width="1" height="1" fill="#93c5fd" />
      <rect x="14" y="22" width="1" height="1" fill="#93c5fd" />
      <rect x="13" y="23" width="1" height="1" fill="#93c5fd" />
      <rect x="16" y="23" width="3" height="1" fill={accent} />

      {/* Arms + Prop: Glowing Cyber Mic */}
      <g className={`origin-[9px_20px] ${armAnimClass(status, "l")}`}>
        <rect x="6" y="19" width="3" height="5" fill="#0f172a" />
        <rect x="7" y="20" width="2" height="3" fill="#3b82f6" />
      </g>
      <g className={`origin-[23px_20px] ${armAnimClass(status, "r")}`}>
        <rect x="23" y="19" width="3" height="5" fill="#0f172a" />
        <rect x="23" y="20" width="2" height="3" fill="#3b82f6" />
        {/* Cyber Mic */}
        <g className={`origin-[25px_19px] ${propAnimClass(status)}`}>
          <rect x="25" y="15" width="2" height="5" fill="#475569" />
          <rect x="24" y="13" width="4" height="3" fill="#00e5ff" />
          <rect x="25" y="14" width="2" height="1" fill="#ffffff" />
        </g>
      </g>

      {/* Feet */}
      <g className={`origin-[12px_26px] ${footAnimClass(status, "l")}`}>
        <rect x="10" y="26" width="4" height="3" fill="#0f172a" />
        <rect x="11" y="26" width="2" height="2" fill="#60a5fa" />
      </g>
      <g className={`origin-[20px_26px] ${footAnimClass(status, "r")}`}>
        <rect x="18" y="26" width="4" height="3" fill="#0f172a" />
        <rect x="19" y="26" width="2" height="2" fill="#60a5fa" />
      </g>
    </svg>
  );
}

function CatSvg({ status, accent }: { status: PetStatus; accent: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      shapeRendering="crispEdges"
      className="h-full w-full drop-shadow-[0_6px_10px_rgba(0,0,0,0.65)]"
    >
      {/* Curled Tail */}
      <g className="origin-[22px_24px] animate-fox-ear-r">
        <rect x="22" y="21" width="5" height="4" fill="#0f172a" />
        <rect x="24" y="18" width="3" height="4" fill="#0f172a" />
        <rect x="23" y="22" width="3" height="2" fill="#312e81" />
        <rect x="25" y="19" width="1" height="3" fill="#818cf8" />
      </g>

      {/* Cat Ears */}
      <rect x="7" y="4" width="4" height="3" fill="#0f172a" />
      <rect x="21" y="4" width="4" height="3" fill="#0f172a" />
      <rect x="8" y="5" width="2" height="2" fill="#f472b6" />
      <rect x="22" y="5" width="2" height="2" fill="#f472b6" />

      {/* Head */}
      <rect x="6" y="7" width="20" height="11" fill="#0f172a" />
      <rect x="7" y="8" width="18" height="9" fill="#1e1b4b" />
      <rect x="9" y="9" width="14" height="7" fill="#312e81" />

      {/* Eyes & Cute Nose & Expressions */}
      {renderEyes(status, accent, 11)}
      {renderCheeks(status, 14)}
      <rect x="15" y="14" width="2" height="1" fill="#f472b6" />
      {renderMouth(status, 15)}

      {/* Collar + Bell */}
      <rect x="9" y="18" width="14" height="8" fill="#0f172a" />
      <rect x="10" y="18" width="12" height="2" fill={accent} />
      <rect x="15" y="19" width="2" height="2" fill="#fde047" />
      <rect x="10" y="20" width="12" height="5" fill="#1e1b4b" />

      {/* Paws + Prop: Pixel Bamboo Flute */}
      <g className={`origin-[9px_20px] ${armAnimClass(status, "l")}`}>
        <rect x="7" y="20" width="3" height="4" fill="#0f172a" />
        <rect x="8" y="21" width="1" height="2" fill="#818cf8" />
      </g>
      <g className={`origin-[23px_20px] ${armAnimClass(status, "r")}`}>
        <rect x="22" y="20" width="3" height="4" fill="#0f172a" />
        <rect x="23" y="21" width="1" height="2" fill="#818cf8" />
      </g>
      <g className={`origin-[16px_19px] ${propAnimClass(status)}`}>
        <rect x="10" y="17" width="12" height="2" fill="#34d399" />
        <rect x="13" y="17" width="1" height="1" fill="#0f172a" />
        <rect x="16" y="17" width="1" height="1" fill="#0f172a" />
        <rect x="19" y="17" width="1" height="1" fill="#0f172a" />
      </g>

      <g className={`origin-[12px_26px] ${footAnimClass(status, "l")}`}>
        <rect x="10" y="26" width="4" height="3" fill="#0f172a" />
        <rect x="11" y="26" width="2" height="2" fill="#818cf8" />
      </g>
      <g className={`origin-[20px_26px] ${footAnimClass(status, "r")}`}>
        <rect x="18" y="26" width="4" height="3" fill="#0f172a" />
        <rect x="19" y="26" width="2" height="2" fill="#818cf8" />
      </g>
    </svg>
  );
}

function OwlSvg({ status, accent }: { status: PetStatus; accent: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      shapeRendering="crispEdges"
      className="h-full w-full drop-shadow-[0_6px_10px_rgba(0,0,0,0.65)]"
    >
      {/* Ear Tufts */}
      <rect x="7" y="4" width="3" height="3" fill="#0f172a" />
      <rect x="22" y="4" width="3" height="3" fill="#0f172a" />
      <rect x="8" y="5" width="2" height="2" fill={accent} />
      <rect x="22" y="5" width="2" height="2" fill={accent} />

      {/* Owl Body Outline */}
      <rect x="7" y="6" width="18" height="20" fill="#0f172a" />
      <rect x="8" y="7" width="16" height="18" fill="#1f2937" />

      {/* Face Mask */}
      <rect x="9" y="9" width="14" height="8" fill="#374151" />
      {renderEyes(status, accent, 11)}
      {renderCheeks(status, 14)}
      {/* Beak */}
      <rect
        x="15"
        y="14"
        width="2"
        height="2"
        fill="#fbbf24"
        className={status === "streaming" ? "origin-[16px_15px] animate-pet-mouth-talk" : ""}
      />

      {/* Belly */}
      <rect x="11" y="18" width="10" height="6" fill="#4b5563" />
      <rect x="13" y="19" width="6" height="4" fill="#9ca3af" />
      <rect x="14" y="20" width="4" height="2" fill={accent} />

      {/* Wings + Prop: Star Conductor Wand */}
      <g className={`origin-[8px_17px] ${armAnimClass(status, "l")}`}>
        <rect x="4" y="15" width="4" height="8" fill="#0f172a" />
        <rect x="5" y="16" width="2" height="6" fill="#374151" />
      </g>
      <g className={`origin-[24px_17px] ${armAnimClass(status, "r")}`}>
        <rect x="24" y="15" width="4" height="8" fill="#0f172a" />
        <rect x="25" y="16" width="2" height="6" fill="#374151" />
        <g className={`origin-[26px_16px] ${propAnimClass(status)}`}>
          <rect x="26" y="11" width="1" height="6" fill="#a855f7" />
          <rect x="25" y="9" width="3" height="3" fill="#fde047" />
          <rect x="26" y="10" width="1" height="1" fill="#ffffff" />
        </g>
      </g>

      {/* Claws */}
      <g className={`origin-[12px_26px] ${footAnimClass(status, "l")}`}>
        <rect x="10" y="26" width="4" height="3" fill="#0f172a" />
        <rect x="11" y="26" width="2" height="2" fill="#fbbf24" />
      </g>
      <g className={`origin-[20px_26px] ${footAnimClass(status, "r")}`}>
        <rect x="18" y="26" width="4" height="3" fill="#0f172a" />
        <rect x="19" y="26" width="2" height="2" fill="#fbbf24" />
      </g>
    </svg>
  );
}

function ShibaSvg({ status, accent }: { status: PetStatus; accent: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      shapeRendering="crispEdges"
      className="h-full w-full drop-shadow-[0_6px_10px_rgba(0,0,0,0.65)]"
    >
      {/* Curled Tail */}
      <g className="origin-[22px_22px] animate-fox-ear-r">
        <rect x="22" y="19" width="5" height="5" fill="#0f172a" />
        <rect x="23" y="20" width="3" height="3" fill="#f59e0b" />
        <rect x="24" y="20" width="2" height="2" fill="#fef3c7" />
      </g>

      {/* Ears */}
      <rect x="7" y="3" width="4" height="4" fill="#0f172a" />
      <rect x="21" y="3" width="4" height="4" fill="#0f172a" />
      <rect x="8" y="4" width="2" height="3" fill="#d97706" />
      <rect x="22" y="4" width="2" height="3" fill="#d97706" />

      {/* Head */}
      <rect x="6" y="7" width="20" height="11" fill="#0f172a" />
      <rect x="7" y="8" width="18" height="9" fill="#f59e0b" />
      {/* Cream Cheeks */}
      <rect x="8" y="13" width="16" height="4" fill="#fef3c7" />
      <rect x="13" y="11" width="6" height="3" fill="#fef3c7" />

      {/* Eyes & Nose & Expressions */}
      {renderEyes(status, status === "idle" ? "#0f172a" : accent, 10)}
      {renderCheeks(status, 13)}
      <rect x="15" y="14" width="2" height="1" fill="#0f172a" />
      {renderMouth(status, 15)}

      {/* Body & Bandana */}
      <rect x="9" y="18" width="14" height="8" fill="#0f172a" />
      <rect x="10" y="18" width="12" height="2" fill={accent} />
      <rect x="10" y="20" width="12" height="5" fill="#f59e0b" />
      <rect x="13" y="20" width="6" height="5" fill="#fef3c7" />

      {/* Paws + Prop: Mini Taiko Drum & Stick */}
      <g className={`origin-[9px_20px] ${armAnimClass(status, "l")}`}>
        <rect x="6" y="19" width="3" height="5" fill="#0f172a" />
        <rect x="7" y="20" width="2" height="3" fill="#f59e0b" />
      </g>
      <g className={`origin-[23px_20px] ${armAnimClass(status, "r")}`}>
        <rect x="23" y="19" width="3" height="5" fill="#0f172a" />
        <rect x="23" y="20" width="2" height="3" fill="#f59e0b" />
        <g className={`origin-[24px_19px] ${propAnimClass(status)}`}>
          <rect x="24" y="16" width="1" height="4" fill="#fef3c7" />
          <rect x="23" y="15" width="3" height="2" fill="#ef4444" />
        </g>
      </g>
      <g className={`origin-[16px_23px] ${propAnimClass(status)}`}>
        <rect x="13" y="21" width="6" height="4" fill="#ef4444" />
        <rect x="14" y="22" width="4" height="2" fill="#fef3c7" />
      </g>

      <g className={`origin-[12px_26px] ${footAnimClass(status, "l")}`}>
        <rect x="10" y="26" width="4" height="3" fill="#0f172a" />
        <rect x="11" y="26" width="2" height="2" fill="#fef3c7" />
      </g>
      <g className={`origin-[20px_26px] ${footAnimClass(status, "r")}`}>
        <rect x="18" y="26" width="4" height="3" fill="#0f172a" />
        <rect x="19" y="26" width="2" height="2" fill="#fef3c7" />
      </g>
    </svg>
  );
}

export function PetSprite({ petId, status, size = "lg" }: PetSpriteProps) {
  const sizeClass =
    size === "sm" ? "h-12 w-12" : size === "md" ? "h-16 w-16" : "h-20 w-20";

  const motionClass =
    status === "typing" || status === "shy"
      ? "animate-pet-curious"
      : status === "thinking"
        ? "animate-fox-think"
        : status === "waiting"
          ? "animate-pet-wait"
          : status === "streaming"
            ? "animate-pet-talk-bob"
            : status === "done" || status === "happy" || status === "wink"
              ? "animate-fox-bounce"
              : status === "error" || status === "annoyed"
                ? "animate-fox-shake"
                : "animate-pet-float";

  const accent =
    status === "error" || status === "annoyed"
      ? "#f87171"
      : status === "waiting" || status === "happy"
        ? "#fbbf24"
        : status === "shy"
          ? "#f472b6"
          : status === "thinking" || status === "streaming"
            ? "#00e5ff"
            : "#36b5ba";

  return (
    <div className="relative flex items-center justify-center">
      {status === "happy" && (
        <>
          <span className="animate-fox-sparkle pointer-events-none absolute -top-1 left-2 text-xs text-pink-400">
            ♥
          </span>
          <span className="animate-fox-sparkle pointer-events-none absolute -top-2 right-2 text-[11px] text-amber-300 [animation-delay:140ms]">
            ♪
          </span>
        </>
      )}

      {status === "annoyed" && (
        <span className="animate-bounce pointer-events-none absolute -top-1 right-1 text-xs drop-shadow">
          💢
        </span>
      )}

      {status === "shy" && (
        <span className="animate-fox-sparkle pointer-events-none absolute -top-1 right-1 text-xs text-pink-300">
          ♡
        </span>
      )}

      {status === "wink" && (
        <span className="animate-fox-sparkle pointer-events-none absolute -top-1 right-1 text-xs text-cyan-300">
          ★
        </span>
      )}
      {status === "typing" && (
        <span className="pointer-events-none absolute -top-1 right-0 rounded-full border border-white/15 bg-[#202020]/90 px-1.5 py-0.5 text-[9px] font-semibold text-cyan-300 shadow">
          ...
        </span>
      )}

      {status === "thinking" && (
        <span className="pointer-events-none absolute -top-1 right-0 flex items-center gap-0.5 rounded-full border border-cyan-400/30 bg-[#172554]/90 px-1.5 py-0.5 text-[9px] font-bold text-cyan-300 shadow animate-pulse">
          • • •
        </span>
      )}

      {status === "waiting" && (
        <span className="animate-pet-sweat pointer-events-none absolute top-0 right-1 text-xs drop-shadow">
          💧
        </span>
      )}

      {status === "streaming" && (
        <span className="animate-fox-sparkle pointer-events-none absolute -top-1 right-1 text-[11px] text-cyan-300">
          ⚡
        </span>
      )}

      {status === "done" && (
        <>
          <span className="animate-fox-sparkle pointer-events-none absolute -top-1 left-2 text-xs text-brand">
            ✦
          </span>
          <span className="animate-fox-sparkle pointer-events-none absolute -top-2 right-2 text-[10px] text-primary [animation-delay:150ms]">
            ✦
          </span>
        </>
      )}

      {status === "error" && (
        <span className="pointer-events-none absolute top-0 right-1 flex h-4 w-4 items-center justify-center rounded-full bg-destructive text-[10px] font-bold text-white shadow">
          !
        </span>
      )}

      <div className={`relative ${sizeClass} ${motionClass}`}>
        {petId === "fox" && <FoxSvg status={status} accent={accent} />}
        {petId === "bot" && <BotSvg status={status} accent={accent} />}
        {petId === "cat" && <CatSvg status={status} accent={accent} />}
        {petId === "owl" && <OwlSvg status={status} accent={accent} />}
        {petId === "shiba" && <ShibaSvg status={status} accent={accent} />}
      </div>
    </div>
  );
}
