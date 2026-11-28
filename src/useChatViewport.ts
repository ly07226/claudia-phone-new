import {readChatViewport,watchChatViewport,setChatViewportValue} from './chatViewport';
import { useLayoutEffect, useRef, type RefObject } from "react";
/** Only the conversation shell follows the visual viewport; all inner regions remain in normal flex flow. */
export function useChatViewport(
  active: boolean,
  input: RefObject<HTMLTextAreaElement | null>,
  onLayout: () => void,
) {
  const lastFrame = useRef<string | null>(null);
  const lastKeyboard = useRef<boolean | null>(null);
  const callback = useRef(onLayout);
  const lastInputHeight = useRef<number | null>(null);
  callback.current = onLayout;
  const fit = () => {
    const el = input.current;
    if (!el) return;
    const viewport = window.visualViewport;
    const max = Math.max(
      40,
      Math.min(120, (viewport?.height || innerHeight) * 0.28),
    );
    // Avoid collapsing the textarea during viewport changes.
    // Read intrinsic height once. Avoid two synchronous layout reads per keystroke.
    el.style.height = "auto";
    const intrinsicHeight = el.scrollHeight;
    const height = Math.max(40, Math.min(intrinsicHeight, max));
    el.style.height = `${height}px`;
    el.style.overflowY = intrinsicHeight > height ? "auto" : "hidden";
    return height;
  };
  useLayoutEffect(() => {
    if (!active) return;
    const phone = document.querySelector<HTMLElement>(".phone");
    const stage = phone?.closest<HTMLElement>(".stage");
    if(!phone)return;
    const sync = () => {
      const frame=readChatViewport(phone);if(!frame)return;
      const signature=`${frame.cssHeight}|${frame.top}|${frame.keyboard}`;
      if(lastFrame.current===signature)return;
      lastFrame.current=signature;
      setChatViewportValue(phone,'--chat-height',frame.top>0?`${frame.bottom}px`:frame.cssHeight);
      setChatViewportValue(stage,'--chat-height',frame.top>0?`${frame.bottom}px`:frame.cssHeight);
      // Anchor the navigation at the layout viewport origin; only the shell's
      // bottom follows the visible keyboard boundary. Panning the whole stage
      // on every visualViewport scroll caused the header to flash.
      setChatViewportValue(stage,'--chat-top','0px');
      phone.classList.toggle('chat-keyboard',frame.keyboard);
      fit();
      // Keyboard animation reports many intermediate heights. Repeatedly
      // forcing scrollTop to scrollHeight during each frame makes the
      // conversation jump between bottom positions on iOS.
      if(lastKeyboard.current!==frame.keyboard){lastKeyboard.current=frame.keyboard;callback.current();}
    };
    phone?.classList.add("chat-open", "chat-conversation");
    stage?.classList.add("chat-stage");
    const stop=watchChatViewport(sync);
    return () => {
      stop();
      phone?.classList.remove(
        "chat-open",
        "chat-conversation",
        "chat-keyboard",
      );
      stage?.classList.remove("chat-stage");
      phone?.style.removeProperty("--chat-height");
      stage?.style.removeProperty("--chat-height");
      stage?.style.removeProperty("--chat-top");
      lastFrame.current=null;
      lastKeyboard.current=null;
      lastInputHeight.current=null;
    };
  }, [active]);
  useLayoutEffect(() => {
    if (!active) return;
    // Observe the native input directly: React draft updates no longer tear down
    // and recreate a layout effect on every keystroke.
    const el = input.current;
    if (!el) return;
    let frame = 0;
    const schedule = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        const height = fit();
        if (height !== undefined && lastInputHeight.current !== height) {
          lastInputHeight.current = height;
          callback.current();
        }
      });
    };
    el.addEventListener('input', schedule);
    el.addEventListener('chat-draft-change', schedule);
    schedule();
    return () => {
      el.removeEventListener('input', schedule);
      el.removeEventListener('chat-draft-change', schedule);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [active, input]);
}
