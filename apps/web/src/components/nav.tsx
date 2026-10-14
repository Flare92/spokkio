"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { callTool, clearToken } from "@/lib/api";

const LINKS = [
  { href: "/contacts", label: "Contatti" },
  { href: "/campaigns", label: "Campagne" },
  { href: "/automations", label: "Automazioni" },
  { href: "/inbox", label: "Inbox" },
  { href: "/analytics", label: "Analytics" },
  { href: "/settings", label: "Impostazioni" },
];

export function Nav() {
  const pathname = usePathname();
  const router = useRouter();
  const [closed, setClosed] = useState(false);

  // Cmd+Q chiude il browser, non Spokkio: questo pulsante ferma davvero
  // Spokkio (API e interfaccia), e l'app nel Dock si chiude da sola.
  async function shutdown() {
    if (!confirm("Chiudere Spokkio? Per riaprirlo basta un doppio click sull'app.")) return;
    try {
      const res = await callTool<{ stopping: boolean; reason?: string }>("/system/shutdown", {});
      if (res.stopping) setClosed(true);
      else alert(res.reason ?? "Non è stato possibile chiudere Spokkio da qui.");
    } catch (err) {
      alert(err instanceof Error ? err.message : "Non è stato possibile chiudere Spokkio da qui.");
    }
  }

  if (closed) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-white p-6 text-center">
        <div>
          <p className="text-lg font-semibold">Spokkio è stato chiuso.</p>
          <p className="mt-1 text-sm text-gray-500">
            Puoi chiudere questa scheda. Per riaprirlo, doppio click su Spokkio in Applicazioni o nel Launchpad.
          </p>
        </div>
      </div>
    );
  }

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
      <div className="flex items-center gap-4">
        <button
          className="text-sm text-gray-500 hover:text-gray-800"
          onClick={() => {
            clearToken();
            router.push("/login");
          }}
        >
          Esci dall&apos;account
        </button>
        <button onClick={shutdown} className="rounded border px-3 py-1 text-sm text-gray-700 hover:bg-gray-50">
          Chiudi Spokkio
        </button>
      </div>
    </nav>
  );
}
