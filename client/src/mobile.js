import { useEffect, useState, useRef } from "react";
export function useMobile() {
  const [mobile, setMobile] = useState(
    () => window.matchMedia("(max-width: 760px)").matches,
  );
  useEffect(() => {
    const media = window.matchMedia("(max-width: 760px)");
    const update = () => setMobile(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return mobile;
}
const dialogs = [];
let originalOverflow = "";
export function useMobileDialog(open, ref, close) {
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement;
    if (!dialogs.length) originalOverflow = document.body.style.overflow;
    const token = {};
    dialogs.push(token);
    document.body.style.overflow = "hidden";
    const elements = () =>
      [
        ...ref.current.querySelectorAll(
          'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex="0"]',
        ),
      ].filter((el) => el.getClientRects().length);
    elements()[0]?.focus();
    const key = (event) => {
      if (dialogs.at(-1) !== token || event.defaultPrevented) return;
      if (event.key === "Escape") {
        event.preventDefault();
        closeRef.current();
      }
      if (event.key === "Tab") {
        const items = elements(),
          first = items[0],
          last = items.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", key);
    return () => {
      dialogs.splice(dialogs.indexOf(token), 1);
      if (!dialogs.length) document.body.style.overflow = originalOverflow;
      document.removeEventListener("keydown", key);
      if (previous?.isConnected) previous.focus();
    };
  }, [open, ref]);
}
