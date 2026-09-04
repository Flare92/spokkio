"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { clearToken } from "@/lib/api";

const LINKS = [
  { href: "/contacts", label: "Contatti" },
  { href: "/campaigns", label: "Campagne" },
  { href: "/inbox", label: "Inbox" },
  { href: "/analytics", label: "Analytics" },
  { href: "/settings", label: "Impostazioni" },
];

export function Nav() {
  const pathname = usePathname();
  const router = useRouter();

  return (
    <nav className="flex items-center justify-between border-b bg-white px-6 py-3">
      <div className="flex items-center gap-6">
        <span className="font-semibold text-brand-dark">Spokkio</span>
        {LINKS.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className={`text-sm ${pathname === link.href ? "font-semibold text-brand-dark" : "text-gray-600"}`}
          >
            {link.label}
          </Link>
        ))}
      </div>
      <button
        className="text-sm text-gray-500 hover:text-gray-800"
        onClick={() => {
          clearToken();
          router.push("/login");
        }}
      >
        Esci
      </button>
    </nav>
  );
}
