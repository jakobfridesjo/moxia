import { createMemo } from "solid-js";
import type { InviteCode } from "@/shared/api/commands.ts";

/** The quiet zone a scanner needs round a QR code, in modules. */
const QUIET = 4;

/** An invite's QR code, always black on white: scanners can't read it inverted or in pale ink at night. */
export function InviteQr(props: { qr: InviteCode["qr"]; label: string }) {
  const d = createMemo(() => {
    const { modules, width } = props.qr;
    let path = "";
    for (let i = 0; i < modules.length; i++) {
      if (modules[i] === "1")
        path += `M${(i % width) + QUIET} ${Math.floor(i / width) + QUIET}h1v1h-1z`;
    }
    return path;
  });
  const size = () => props.qr.width + QUIET * 2;
  return (
    <svg
      role="img"
      aria-label={props.label}
      viewBox={`0 0 ${size()} ${size()}`}
      shape-rendering="crispEdges"
      class="aspect-square w-full max-w-56 bg-white"
    >
      <rect width={size()} height={size()} fill="#fff" />
      <path d={d()} fill="#000" />
    </svg>
  );
}
