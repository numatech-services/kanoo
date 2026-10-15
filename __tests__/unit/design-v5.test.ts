import { detectIntent, bestClient, keywords } from "@/lib/home-assistant";

describe("Assistant du tableau de bord", () => {
  it("reconnaît les questions courantes", () => {
    expect(detectIntent("Quelles factures sont en retard ?")).toBe("overdue");
    expect(detectIntent("Résume mes brouillons")).toBe("drafts");
    expect(detectIntent("Combien me doit l'Université de Tahoua ?")).toBe("client_due");
    expect(detectIntent("Combien reste à encaisser ?")).toBe("receivables");
    expect(detectIntent("Quel est mon solde de trésorerie ?")).toBe("treasury");
    expect(detectIntent("Quel est mon chiffre d'affaires ?")).toBe("revenue");
    expect(detectIntent("Qu'avons-nous encaissé ce mois ?")).toBe("collected");
    expect(detectIntent("Bonjour")).toBe("help");
  });
  it("retrouve le client par une partie de son nom, accents et casse ignorés", () => {
    const clients = [{ name: "Université Djibo Hamani de Tahoua" }, { name: "Swiss Umef University of Niger" }];
    expect(bestClient("Combien me doit TAHOUA ?", clients)?.name).toBe("Université Djibo Hamani de Tahoua");
    expect(bestClient("combien me doit umef", clients)?.name).toBe("Swiss Umef University of Niger");
    expect(bestClient("Combien me doit Zinder ?", clients)).toBeNull();
    expect(keywords("Combien me doit l'Université ?")).toEqual([]);
  });
});
