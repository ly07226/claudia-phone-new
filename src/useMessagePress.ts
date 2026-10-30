import { useCallback, useEffect, useRef } from "react";
import type {
  PointerEvent as ReactPointerEvent,
  MouseEvent as ReactMouseEvent,
  KeyboardEvent as ReactKeyboardEvent,
} from "react";
export function useMessagePress(open: () => void) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const point = useRef<{ x: number; y: number; id: number } | null>(null);
  const pointerType = useRef("");
  const fired = useRef(false);
  const callback = useRef(open);
  callback.current = open;
  const clear = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    document.removeEventListener("scroll", clear, true);
  }, []);
  useEffect(() => clear, [clear]);
  return {
    onPointerDown: (e: ReactPointerEvent) => {
      clear();
      fired.current = false;
      pointerType.current = e.pointerType;
      if (
        e.button !== 0 ||
        (e.target as HTMLElement).closest("button,input,textarea,a")
      )
        return;
      point.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
      // Observe actual scrolling as well as pointer displacement; do not block pan/zoom.
      document.addEventListener("scroll", clear, true);
      timer.current = setTimeout(() => {
        clear();
        fired.current = true;
        callback.current();
      }, 500);
    },
    onPointerMove: (e: ReactPointerEvent) => {
      if (
        point.current &&
        (point.current.id !== e.pointerId ||
          Math.hypot(e.clientX - point.current.x, e.clientY - point.current.y) >
            10)
      ) {
        clear();
        point.current = null;
      }
    },
    onPointerUp: () => {
      clear();
      point.current = null;
    },
    onPointerCancel: () => {
      clear();
      point.current = null;
    },
    onClickCapture: (e: ReactMouseEvent) => {
      if (fired.current) {
        fired.current = false;
        if (e.detail > 0) {
          e.preventDefault();
          e.stopPropagation();
        }
      }
    },
    onContextMenu: (e: ReactMouseEvent) => {
      e.preventDefault();
      // Touch context menus can arrive before 500ms: suppress native UI and let
      // our timer decide. Mouse right-click opens the same whole-message menu.
      if (pointerType.current !== "touch" && !fired.current) {
        clear();
        callback.current();
      }
    },
    onKeyDown: (e: ReactKeyboardEvent) => {
      if (e.key === "ContextMenu" || (e.shiftKey && e.key === "F10")) {
        e.preventDefault();
        clear();
        callback.current();
      }
    },
  };
}
