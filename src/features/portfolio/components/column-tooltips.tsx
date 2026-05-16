// Bulles d'information vulgarisées par colonne (hover sur l'icône ⓘ
// dans les en-têtes de table). Si tu changes une formule en code, mets à
// jour la bulle correspondante ici aussi.
//
// Conventions : ReactNode (peut contenir <strong>, <br />, <span muted>).
// Garde le ton vulgarisé — chaque tooltip lu seul doit suffire à comprendre.

import * as React from "react";

const muted = (children: React.ReactNode) => (
  <span className="text-muted-foreground">{children}</span>
);

export const POSITION_TOOLTIPS: Record<string, React.ReactNode> = {
  instrument: "Nom court de l'instrument + ISIN (ou ticker pour cryptos) et devise native.",
  support:
    "Enveloppe fiscale : CTO (compte-titres ordinaire, PFU 30 %), PEA (5 ans = exo IR, PS 17,2 %), PEA-PME, AV (assurance-vie), CRYPTO (art. 150 VH bis CGI).",
  type: "Classe d'actif : Action, ETF, Fonds, Obligation, Cash, Crypto.",
  operateur:
    "Courtier où la transaction a été passée. Le PRU est calculé séparément par broker (CUMP par compte-titres pour conformité fiscale).",
  qty:
    "Nombre d'unités détenues actuellement. Actions/ETF : nombre de titres. Obligations : face value en devise native. Cryptos : quantité (jusqu'à 8 décimales). Cash : solde dans la devise.",
  pru: (
    <>
      <strong>Prix de Revient Unitaire</strong> — prix moyen pondéré d'acquisition, frais d'achat
      capitalisés. Méthode CUMP fongible conforme art. 150-0 D, 3 CGI.
      <br />
      {muted("Formule : Σ (qty × prix + commissions) / Σ qty. Diminue proportionnellement à chaque vente.")}
    </>
  ),
  pruGross: (
    <>
      PRU sans les frais d'achat capitalisés (vue pédagogique).
      <br />
      {muted("Formule : Σ (qty × prix) / Σ qty.")}
    </>
  ),
  currentPrice:
    "Prix unitaire converti en EUR au taux de change du jour, depuis le dernier rafraîchissement. Source : EODHD (actions/ETF/obligations) ou CoinGecko (cryptos). Cliquable pour saisir manuellement (utile si la cotation auto est cassée).",
  currentPriceNative:
    "Prix unitaire dans la devise native de l'instrument (USD pour Apple, GBP pour les ETF LSE…). Permet de comparer directement avec ce qu'affiche le broker, sans biais lié au taux de change.",
  listing:
    "Place de cotation (MIC ISO 10383) + devise utilisées pour récupérer le cours. Cliquer pour verrouiller manuellement une place spécifique (utile quand un ISIN est coté sur plusieurs marchés).",
  invested: (
    <>
      Capital actuellement engagé sur cette ligne, en EUR.
      <br />
      {muted("Formule : quantité × PRU. Diminue proportionnellement quand tu vends.")}
    </>
  ),
  valuation: (
    <>
      Valeur de marché actuelle de la position en EUR.
      <br />
      {muted("Formule : quantité × cours actuel × taux de change.")}
    </>
  ),
  dividendsAttributed:
    "Total des dividendes (actions/ETF), coupons (obligations) ou intérêts (cash) attribués à la portion encore détenue, en EUR. Quand tu vends, la part vendue emporte sa quote-part historique.",
  divYieldAnnualized: (
    <>
      Rendement annualisé issu des seuls dividendes reçus (= <strong>yield on cost</strong>).
      Comparable directement à un livret ou un CAT.
      <br />
      {muted("Formule : (Σ divs reçus / années de détention) / capital investi.")}
    </>
  ),
  holdingFees:
    "Droits de garde + commissions récurrentes attribués à cette ligne (typiquement 0,036 %/an sur les positions hors Euronext en CTO Bourse Direct). N'impactent PAS le PRU CUMP mais peuvent diminuer le PnL via le toggle « Net des frais ».",
  pnl: (
    <>
      Plus-value latente <strong>capital seul</strong> (sans dividendes), en EUR.
      <br />
      {muted("Formule : Valorisation − Investi.")}
    </>
  ),
  pnlTotal: (
    <>
      Plus-value latente <strong>incluant les dividendes</strong> reçus.
      <br />
      {muted("Formule : Valorisation + Dividendes − Investi.")}
    </>
  ),
  pnlPct: (
    <>
      PnL en pourcentage du capital investi.
      <br />
      {muted("Formule : PnL / Investi. Bascule entre vue capital seul et avec dividendes selon les toggles du haut.")}
    </>
  ),
  pnlAnnualized: (
    <>
      <strong>MWR (Money-Weighted Return)</strong> = TRI annualisé sur les vrais flux de
      trésorerie (achats, ventes, divs, frais). Méthode Newton-Raphson + bisection fallback.
      Comparable à un taux d'épargne, un CAT ou un ETF monde.
    </>
  ),
  held: "Temps écoulé depuis le premier achat de cette position.",
};

export const REALIZATION_TOOLTIPS: Record<string, React.ReactNode> = {
  saleDate: "Date à laquelle la vente (ou la liquidation) a eu lieu.",
  instrument: "Instrument vendu + ISIN. Plusieurs lignes possibles pour le même instrument si tu as fait plusieurs ventes.",
  support: "Enveloppe fiscale du compte-titres au moment de la vente (CTO, PEA, AV…).",
  type: "Classe d'actif au moment de la vente.",
  operateur: "Courtier sur lequel la vente a eu lieu.",
  qtySold: "Nombre d'unités vendues sur cette opération.",
  pruAtSale: (
    <>
      Prix de revient moyen (PRU CUMP) au moment de la vente, en EUR.
      <br />
      {muted("Sert de référence pour calculer la plus-value réalisée.")}
    </>
  ),
  salePrice: (
    <>
      Prix unitaire moyen de vente, en EUR.
      <br />
      {muted("Formule : encaissé net (avant frais) / quantité vendue.")}
    </>
  ),
  currentPrice:
    "Cours actuel de l'instrument en EUR, à titre indicatif — permet de voir si tu as vendu au-dessus / en-dessous du cours actuel.",
  spread: (
    <>
      Différence entre le cours actuel et le prix de vente, en pourcentage.
      <br />
      {muted("Positif = tu aurais mieux fait d'attendre ; négatif = bien joué de vendre.")}
    </>
  ),
  saleNet: (
    <>
      Encaissé net (proceeds), en EUR, après commissions de vente.
      <br />
      {muted("Formule : prix unitaire × quantité − commissions.")}
    </>
  ),
  dividends: "Quote-part de dividendes attribuée à la portion vendue, accumulée pendant la détention.",
  holdingFees:
    "Quote-part des frais de détention récurrents (droits de garde) attribuée à la portion vendue.",
  realizedTotal: (
    <>
      <strong>Plus-value réalisée</strong> sur la vente, en EUR. Bascule entre capital seul et
      avec dividendes selon les toggles.
      <br />
      {muted("Formule capital : encaissé net − coût d'acquisition (PRU × qty). Avec divs : + dividendes attribués.")}
    </>
  ),
  xirr: (
    <>
      TRI annualisé de la portion vendue, sur les flux réels (achats, divs reçus, vente).
      Méthode Newton-Raphson + bisection. Comparable à un placement alternatif sur la même durée.
    </>
  ),
};

export const MOVEMENT_TOOLTIPS: Record<string, React.ReactNode> = {
  date: "Date d'exécution de l'opération.",
  instrument:
    "Instrument concerné. Pour les mouvements cash (dépôt, retrait, intérêt, taxe, frais), peut afficher la description brute.",
  support: "Enveloppe fiscale du compte-titres (CTO, PEA, AV, CRYPTO).",
  type: (
    <>
      Type de mouvement : <strong>Achat</strong>, <strong>Vente</strong>,{" "}
      <strong>Coupon</strong> (dividende ou intérêt obligataire), <strong>Intérêts</strong> cash,{" "}
      <strong>Frais</strong>, <strong>Taxe</strong> (withholding), <strong>Dépôt</strong>,{" "}
      <strong>Retrait</strong>.
    </>
  ),
  quantite:
    "Nombre d'unités impliquées dans le mouvement (titres, parts, face value bond, qty crypto). Vide pour les flux purement cash.",
  prix: "Prix unitaire en EUR au moment de l'opération. Vide pour les flux cash.",
  valeur: (
    <>
      Montant brut de l'opération, en EUR (avant frais).
      <br />
      {muted("Formule : quantité × prix unitaire (pour buy/sell) ou montant cash direct.")}
    </>
  ),
  frais:
    "Commission broker + taxes éventuelles sur cette opération. Pour les buys, ces frais sont capitalisés dans le PRU CUMP.",
  pays: "Pays de l'instrument déduit du préfixe ISIN (US, FR, IE, DE, etc.).",
  operateur: "Courtier sur lequel le mouvement a été passé.",
};
