import { explainRejection, findTemplateProblems } from "@spokkio/shared";

const problems = (bodyText: string, name = "promo_autunno") => findTemplateProblems({ name, bodyText });

describe("findTemplateProblems", () => {
  it("accepts a well-formed template", () => {
    expect(problems("Ciao {{1}}, da questa settimana trovi il {{2}} di sconto in negozio. Ti aspettiamo!")).toEqual([]);
  });

  it("flags the mistakes Meta rejects", () => {
    expect(problems("Ciao", "Promo Autunno")[0]).toMatch(/minuscole/);
    expect(problems("{{1}}, abbiamo una sorpresa per te in negozio")).toEqual([
      expect.stringMatching(/iniziare o finire/),
    ]);
    expect(problems("Ciao {{1}}, il tuo sconto in negozio è {{3}} fino a domenica")).toEqual([
      expect.stringMatching(/senza salti/),
    ]);
    expect(problems("Ciao {{1}}{{2}} oggi abbiamo una promozione speciale per te")).toEqual([
      expect.stringMatching(/attaccate/),
    ]);
    expect(problems("Ciao {nome}, oggi {{1}} promo per tutti i clienti")[0]).toMatch(/scritte male/);
    expect(problems("Ciao {{1}} {{2}} e {{3}}!")).toEqual(
      expect.arrayContaining([expect.stringMatching(/Troppe variabili/)]),
    );
  });
});

describe("explainRejection", () => {
  it("translates Meta's codes and ignores unknown ones", () => {
    expect(explainRejection("INVALID_FORMAT")).toMatch(/Formato non valido/);
    expect(explainRejection("tag content mismatch")).toMatch(/MARKETING/);
    expect(explainRejection("SOMETHING_NEW")).toBeNull();
  });
});
