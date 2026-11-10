import {readChatViewport,watchChatViewport,setChatViewportValue} from './chatViewport';
import { useLayoutEffect, useRef, type RefObject } from "react";
/** Only the conversation shell follows the visual viewport; all inner regions remain in normal flex flow. */
export function useChatViewport(
  active: boolean,
  text: string,
  input: RefObject<HTMLTextAreaElement | null>,
  onLayout: () => void,
) {
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
    el.style.height = "0px";
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
      setChatViewportValue(phone,'--chat-height',frame.cssHeight);
      setChatViewportValue(stage,'--chat-height',frame.cssHeight);
      setChatViewportValue(stage,'--chat-top',`${frame.top}px`);
      phone.classList.toggle('chat-keyboard',frame.keyboard);
      fit();
      callback.current();
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
    };
  }, [active]);
  useLayoutEffect(() => {
    if (active) {
      fit();
      callback.current();
    }
  }, [active, text]);
}
