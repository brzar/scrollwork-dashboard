import "@/styles/globals.css";
import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { resolveTheme } from "@/lib/theme";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Scrollwork Dashboard",
  description: "Podcast analytics and revenue.",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const theme = await resolveTheme();
  return (
    <html
      lang="en"
      className={`${inter.variable} ${theme === "dark" ? "dark" : ""}`}
      // Hint to the browser so form controls / scrollbars adopt the
      // right native appearance.
      style={{ colorScheme: theme }}
    >
      <body className="font-sans">{children}</body>
    </html>
  );
}
