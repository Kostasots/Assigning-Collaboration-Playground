import "./globals.css";
import { AuthProvider } from "@/lib/AuthProvider";
import NavBar from "@/components/NavBar";

export const metadata = {
  title: "FH Assigning Tool",
  description: "NCAA field hockey umpire assigning tool",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col font-sans">
        <AuthProvider>
          <NavBar />
          <div className="flex-1">{children}</div>
        </AuthProvider>
      </body>
    </html>
  );
}
