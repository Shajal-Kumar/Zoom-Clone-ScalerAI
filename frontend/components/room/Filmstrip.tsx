"use client";

/** Row of camera tiles under the spotlight. Children should size themselves with `filmTile`. */
export const filmTile = "h-24 w-40 shrink-0 sm:h-28 sm:w-48";

export function Filmstrip({ children }: { children: React.ReactNode }) {
  return <div className="flex shrink-0 gap-2 overflow-x-auto pb-1">{children}</div>;
}
