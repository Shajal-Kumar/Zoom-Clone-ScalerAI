import type { Metadata } from "next";
import { AppShell } from "@/components/AppShell";
import { SettingsProvider } from "@/providers/SettingsProvider";
import "./globals.css";

export const metadata: Metadata = { title: "Zoom", description: "Video meetings in your browser" };

// Sets the saved theme before first paint to avoid a light-to-dark flash.
const themeScript = `try{var s=JSON.parse(localStorage.getItem("zoomclone.settings.v1")||"{}");document.documentElement.dataset.theme=s.theme==="dark"?"dark":"light"}catch(e){}`;

// Stays a server component (it exports `metadata`). usePathname() lives in <AppShell>, a client component.
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="light" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <SettingsProvider>
          <AppShell>{children}</AppShell>
        </SettingsProvider>
      </body>
    </html>
  );
}
