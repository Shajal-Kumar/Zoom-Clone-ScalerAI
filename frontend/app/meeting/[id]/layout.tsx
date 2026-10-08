import { MeetingProvider } from "@/providers/MeetingProvider";

/**
 * Owns media, socket and mesh for everything under /meeting/[id], so they survive the
 * lobby -> room navigation. AppShell already hides the Sidebar/Navbar on /meeting/... paths.
 */
export default function MeetingLayout({ children }: { children: React.ReactNode }) {
  return <MeetingProvider>{children}</MeetingProvider>;
}
