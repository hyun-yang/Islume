"use client";

import { useEffect, useRef } from "react";
import { type KeyboardInput } from "./KeyboardInput";
import { useT } from "@/lib/i18n";

interface Props {
  input: KeyboardInput;
}

// Mobile virtual D-pad (left/right) + Jump button.
// Forwards into the same KeyboardInput instance so the engine sees one source.
export default function TouchInput({ input }: Props) {
  const t = useT();
  const visible = useRef(false);
  useEffect(() => {
    const isTouch = typeof window !== "undefined" && "ontouchstart" in window;
    visible.current = isTouch;
  }, []);

  const onLeftStart = (e: React.TouchEvent | React.MouseEvent) => {
    e.preventDefault();
    input.setMoveAxis(-1);
  };
  const onRightStart = (e: React.TouchEvent | React.MouseEvent) => {
    e.preventDefault();
    input.setMoveAxis(1);
  };
  const onMoveEnd = (e: React.TouchEvent | React.MouseEvent) => {
    e.preventDefault();
    input.setMoveAxis(0);
  };
  const onJumpStart = (e: React.TouchEvent | React.MouseEvent) => {
    e.preventDefault();
    input.triggerJumpPressed();
  };
  const onJumpEnd = (e: React.TouchEvent | React.MouseEvent) => {
    e.preventDefault();
    input.triggerJumpReleased();
  };

  return (
    <div className="md:hidden absolute bottom-4 left-0 right-0 z-40 flex justify-between px-4 pointer-events-none select-none">
      <div className="flex gap-2 pointer-events-auto">
        <button
          onTouchStart={onLeftStart}
          onTouchEnd={onMoveEnd}
          onMouseDown={onLeftStart}
          onMouseUp={onMoveEnd}
          onMouseLeave={onMoveEnd}
          className="w-16 h-16 rounded-full bg-black/40 border-2 border-white/30 text-white text-2xl font-bold backdrop-blur-sm active:bg-black/60"
          aria-label={t("game.moveLeft")}
        >
          ◀
        </button>
        <button
          onTouchStart={onRightStart}
          onTouchEnd={onMoveEnd}
          onMouseDown={onRightStart}
          onMouseUp={onMoveEnd}
          onMouseLeave={onMoveEnd}
          className="w-16 h-16 rounded-full bg-black/40 border-2 border-white/30 text-white text-2xl font-bold backdrop-blur-sm active:bg-black/60"
          aria-label={t("game.moveRight")}
        >
          ▶
        </button>
      </div>
      <div className="pointer-events-auto">
        <button
          onTouchStart={onJumpStart}
          onTouchEnd={onJumpEnd}
          onMouseDown={onJumpStart}
          onMouseUp={onJumpEnd}
          onMouseLeave={onJumpEnd}
          className="w-20 h-20 rounded-full bg-amber-500/60 border-2 border-amber-200/60 text-white text-2xl font-bold backdrop-blur-sm active:bg-amber-600/70"
          aria-label={t("game.jump")}
        >
          {t("game.jump")}
        </button>
      </div>
    </div>
  );
}
