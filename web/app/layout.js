import "./globals.css";

export const metadata = {
  title: "GPU Availability Live Board",
  description: "Next.js frontend for the live GPU availability API."
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
