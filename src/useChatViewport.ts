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
    const viewport = window.visualViewport;
    let frame = 0;
    let baseline = Math.max(innerHeight, document.documentElement.clientHeight);
    let width = innerWidth;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (viewport && Math.abs(viewport.scale - 1) > 0.02) return;
        const focused = /^(INPUT|TEXTAREA)$/.test(
          document.activeElement?.tagName || "",
        );
        if (width !== innerWidth || !focused) {
          baseline = Math.max(
            innerHeight,
            document.documentElement.clientHeight,
          );
          width = innerWidth;
        }
        const height = viewport?.height || innerHeight;
        const keyboard = focused && baseline - height > 100;
        phone?.style.setProperty("--chat-height", `${height}px`);
        stage?.style.setProperty("--chat-height", `${height}px`);
        stage?.style.setProperty("--chat-top", `${viewport?.offsetTop || 0}px`);
        phone?.classList.toggle("chat-keyboard", keyboard);
        fit();
        callback.current();
      });
    };
    phone?.classList.add("chat-open", "chat-conversation");
    stage?.classList.add("chat-stage");
    if (phone) {
      phone.scrollTop = 0;
      phone.scrollLeft = 0;
    }
    update();
    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", update);
    viewport?.addEventListener("resize", update);
    viewport?.addEventListener("scroll", update);
    document.addEventListener("focusin", update);
    document.addEventListener("focusout", update);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
      viewport?.removeEventListener("resize", update);
      viewport?.removeEventListener("scroll", update);
      document.removeEventListener("focusin", update);
      document.removeEventListener("focusout", update);
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
