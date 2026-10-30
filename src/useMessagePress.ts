import { useEffect, useRef } from "react";
import type {
  PointerEvent as ReactPointerEvent,
  MouseEvent as ReactMouseEvent,
} from "react";
export function useMessagePress(open: () => void) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const point = useRef<{
    x: number;
    y: number;
    id: number;
    type: string;
  } | null>(null);
  const fired = useRef(false);
  const callback = useRef(open);
  callback.current = open;
  const clear = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(() => clear, []);
  return {
    onPointerDown: (e: ReactPointerEvent) => {
      clear();
      fired.current = false;
      if (
        e.button !== 0 ||
        (e.target as HTMLElement).closest("button,input,textarea,a")
      )
        return;
      point.current = {
        x: e.clientX,
        y: e.clientY,
        id: e.pointerId,
        type: e.pointerType,
      };
      timer.current = setTimeout(() => {
        timer.current = null;
        fired.current = true;
        callback.current();
      }, 500);
    },
    onPointerMove: (e: ReactPointerEvent) => {
      if (
        point.current &&
        Math.hypot(e.clientX - point.current.x, e.clientY - point.current.y) >
          10
      ) {
        clear();
        point.current = null;
      }
    },
    onPointerUp: () => {
      clear();
    },
    onPointerCancel: () => {
      clear();
      point.current = null;
    },
    onClickCapture: (e: ReactMouseEvent) => {
      if (fired.current) {
        fired.current = false;
        e.preventDefault();
        e.stopPropagation();
      }
    },
    onContextMenu: (e: ReactMouseEvent) => {
      if (point.current?.type === "touch" || fired.current) e.preventDefault();
    },
  };
}
