"use client";

/** Even grid for 1-6 tiles: 1 column on phones, up to 3 columns on large screens. */
export function VideoGrid({ children, count }: { children: React.ReactNode; count: number }) {
  const cols =
    count <= 1
      ? "grid-cols-1"
      : count === 2
        ? "grid-cols-1 sm:grid-cols-2"
        : count <= 4
          ? "grid-cols-2"
          : "grid-cols-2 lg:grid-cols-3";
  return <div className={`grid h-full w-full auto-rows-fr gap-2 sm:gap-3 ${cols}`}>{children}</div>;
}
