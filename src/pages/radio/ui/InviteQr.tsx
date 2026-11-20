import { useMemo } from "react";
import type { InviteCode } from "@/shared/api/commands.ts";

/** The quiet zone a scanner needs round a QR code, in modules. */
const QUIET = 4;

/** An invite's QR code, in ink on paper. */
export function InviteQr({ qr, label }: { qr: InviteCode["qr"]; label: string }) {
  const d = useMemo(() => {
    let path = "";
    for (let i = 0; i < qr.modules.length; i++) {
      if (qr.modules[i] === "1")
        path += `M${(i % qr.width) + QUIET} ${Math.floor(i / qr.width) + QUIET}h1v1h-1z`;
    }
    return path;
  }, [qr]);
  const size = qr.width + QUIET * 2;
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${size} ${size}`}
      shapeRendering="crispEdges"
      className="aspect-square w-full max-w-56 bg-white"
    >
      <path d={d} className="fill-ink" />
    </svg>
  );
}
