import {readChatViewport,watchChatViewport,setChatViewportValue} from './chatViewport';
import { useLayoutEffect, useRef, type RefObject } from "react";
/** Only the conversation shell follows the visual viewport; all inner regions remain in normal flex flow. */
export function useChatViewport(
  active: boolean,
  text: string,
  input: RefObject<HTMLTextAreaElement | null>,
  onLayout: () => void,
) {
  const lastFrame = useRef<string | null>(null);
  const lastKeyboard = useRef<boolean | null>(null);
  const callback = useRef(onLayout);
  callback.current = onLayout;
  const fit = () => {
    const el = input.current;
    if (!el) return;
    const viewport = window.visualViewport;
    const max = Math.max(
      40,
      Math.min(120, (viewport?.height || innerHeight) * 0.28),
    );
    // Do not collapse the textarea on every visualViewport event: iOS may\n    // emit another resize while the keyboard is animating, causing a loop.\n    el.style.height = "auto";
    const height = Math.max(40, Math.min(el.scrollHeight, max));
    el.style.height = `${height}px`;
    el.style.overflowY = el.scrollHeight > height ? "auto" : "hidden";
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
      setChatViewportValue(phone,'--chat-height',frame.cssHeight);
      setChatViewportValue(stage,'--chat-height',frame.cssHeight);
      setChatViewportValue(stage,'--chat-top',`${frame.top}px`);
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
    };
  }, [active]);
  useLayoutEffect(() => {
    if (active) {
      fit();
      callback.current();
    }
  }, [active, text]);
}
