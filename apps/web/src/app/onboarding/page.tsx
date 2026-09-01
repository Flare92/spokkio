"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { callTool, setToken } from "@/lib/api";

// Two-step guided onboarding (no free-form multi-page form) — target:
// time-to-first-campaign under 20 minutes for a non-technical user.
// Step 2 is a plain-language preview of the single, transparent plan and
// the cost simulator, so nobody signs up without seeing real numbers first.
export default function OnboardingPage() {
  const router = useRouter();
  const [step, setStep] = useState<1 | 2>(1);
  const [teamName, setTeamName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleCreateAccount(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const { accessToken } = await callTool<{ accessToken: string }>("/auth/register", {
        teamName,
        email,
        password,
      });
      setToken(accessToken);
      setStep(2);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Registrazione fallita");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-md rounded-lg border bg-white p-8 shadow-sm">
        <p className="mb-2 text-xs uppercase tracking-wide text-gray-400">Passo {step} di 2</p>

        {step === 1 && (
          <form onSubmit={handleCreateAccount} className="space-y-4">
            <h1 className="text-xl font-semibold text-brand-dark">Crea il tuo account Spokkio</h1>
            <p className="text-sm text-gray-500">
              Un solo piano, un prezzo chiaro. Nessun wallet nascosto, nessuna sorpresa in fattura.
            </p>
            <div>
              <label className="block text-sm font-medium">Nome attività</label>
              <input
                required
                value={teamName}
                onChange={(e) => setTeamName(e.target.value)}
                placeholder="Es. Salone Bellezza Maria"
                className="mt-1 w-full rounded border px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium">Email</label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-1 w-full rounded border px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium">Password</label>
              <input
                type="password"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="mt-1 w-full rounded border px-3 py-2 text-sm"
              />
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <button
              type="submit"
              disabled={loading}
              className="w-full rounded bg-brand-dark py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {loading ? "Creazione in corso..." : "Continua"}
            </button>
            <p className="text-center text-sm text-gray-500">
              Hai già un account?{" "}
              <Link href="/login" className="text-brand-dark underline">
                Accedi
              </Link>
            </p>
          </form>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <h1 className="text-xl font-semibold text-brand-dark">Il tuo piano, in chiaro</h1>
            <div className="rounded border bg-gray-50 p-4 text-sm">
              <div className="flex justify-between py-1">
                <span>Canone mensile</span>
                <span className="font-medium">€49 / mese</span>
              </div>
              <div className="flex justify-between py-1">
                <span>Conversazioni incluse</span>
                <span className="font-medium">1000 / mese</span>
              </div>
              <div className="flex justify-between py-1">
                <span>Costo Meta per conversazione (marketing)</span>
                <span className="font-medium">~€0,073</span>
              </div>
              <div className="flex justify-between py-1">
                <span>Markup Spokkio dichiarato</span>
                <span className="font-medium">€0,01</span>
              </div>
              <div className="flex justify-between border-t pt-2 font-semibold">
                <span>Totale per conversazione</span>
                <span>~€0,083</span>
              </div>
            </div>
            <p className="text-xs text-gray-500">
              Nessun overage a sorpresa: ti avvisiamo all&apos;80% della soglia inclusa, mai un blocco improvviso.
              Vedrai lo stesso identico simulatore prima di ogni invio di campagna.
            </p>
            <button
              onClick={() => router.push("/contacts")}
              className="w-full rounded bg-brand-dark py-2 text-sm font-medium text-white"
            >
              Vai alla dashboard
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
