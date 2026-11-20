import { useEffect } from "react";
import { createPortal } from "react-dom";
import { useMessages } from "@/shared/i18n/messages.ts";
import { Button } from "@/shared/ui/shadcn/button.tsx";

const CORNERS = [
  "top-0 left-0 border-t-4 border-l-4",
  "top-0 right-0 border-t-4 border-r-4",
  "bottom-0 left-0 border-b-4 border-l-4",
  "bottom-0 right-0 border-b-4 border-r-4",
];

/**
 * While the phone's camera scans, the page turns see-through over it: only a frame to aim with,
 * what to do, and a way out are left on top.
 */
export function ScanFrame({ onCancel }: { onCancel: () => void }) {
  const t = useMessages().together;
  useEffect(() => {
    const root = document.documentElement;
    root.classList.add("scanning");
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", escape);
    return () => {
      root.classList.remove("scanning");
      window.removeEventListener("keydown", escape);
    };
  }, [onCancel]);

  return createPortal(
    <div
      data-scanner
      role="dialog"
      aria-modal
      aria-label={t.scan}
      className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-8 overflow-hidden px-6"
    >
      {/* The dim around the frame is the frame's own shadow, so the camera shows clear inside it. */}
      <div aria-hidden className="relative size-64 shadow-[0_0_0_100vmax_rgb(0_0_0/0.5)]">
        {CORNERS.map((corner) => (
          <span key={corner} className={`absolute size-10 border-seal ${corner}`} />
        ))}
      </div>
      <p role="status" className="max-w-xs bg-paper/90 px-3 py-1.5 text-center text-ink">
        {t.scanning}
      </p>
      <Button size="lg" onClick={onCancel} className="h-12 min-w-40">
        {t.cancelScan}
      </Button>
    </div>,
    document.body
  );
}
