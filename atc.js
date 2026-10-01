/* Résumé « à quoi ça sert » à partir du code ATC (classification anatomique, thérapeutique et chimique).
 * Textes rédigés pour l'app : indicatifs, par classe thérapeutique — la notice fait foi.
 * Recherche du plus précis au plus général : niveau 4 (5 car.), niveau 3 (4 car.), niveau 2 (3 car.).
 */
"use strict";

const ATC_FR = {
  // A — Système digestif et métabolisme
  A01: "Bouche et dents",
  A02: "Acidité gastrique, reflux, ulcère",
  A02A: "Brûlures d'estomac (antiacide)",
  A02BA: "Reflux, ulcère (anti-H2)",
  A02BC: "Reflux, brûlures d'estomac, ulcère (inhibiteur de la pompe à protons)",
  A03: "Troubles digestifs fonctionnels (spasmes, ballonnements)",
  A03A: "Spasmes et douleurs digestives",
  A03F: "Nausées, digestion lente (prokinétique)",
  A04: "Nausées et vomissements",
  A05: "Foie et vésicule biliaire",
  A06: "Constipation (laxatif)",
  A07: "Diarrhée, infections ou inflammations intestinales",
  A07B: "Diarrhée (adsorbant)",
  A07C: "Diarrhée : réhydratation orale",
  A07D: "Diarrhée (ralentisseur du transit)",
  A07E: "Inflammation chronique de l'intestin",
  A07F: "Flore intestinale (probiotique)",
  A08: "Obésité",
  A09: "Digestion (enzymes digestives)",
  A10: "Diabète",
  A10A: "Diabète (insuline)",
  A10B: "Diabète (antidiabétique)",
  A11: "Vitamines",
  A11CC: "Vitamine D (os, carence)",
  A12: "Compléments minéraux (calcium, potassium, magnésium…)",
  A13: "Fortifiant",
  A14: "Anabolisant",
  A16: "Maladies métaboliques rares",

  // B — Sang
  B01: "Prévention des caillots sanguins",
  B01AA: "Anticoagulant (prévention des caillots)",
  B01AB: "Anticoagulant (héparine)",
  B01AC: "Prévention des caillots (antiagrégant plaquettaire)",
  B01AE: "Anticoagulant (prévention des caillots)",
  B01AF: "Anticoagulant (prévention des caillots)",
  B02: "Saignements (antihémorragique)",
  B03: "Anémie (fer, vitamine B12, acide folique)",
  B05: "Solutés de perfusion",
  B06: "Autres traitements du sang",

  // C — Cœur et vaisseaux
  C01: "Cœur (insuffisance cardiaque, arythmie, angine de poitrine)",
  C01D: "Angine de poitrine (vasodilatateur)",
  C02: "Hypertension artérielle",
  C03: "Diurétique (tension, œdèmes, insuffisance cardiaque)",
  C04: "Circulation périphérique",
  C05: "Hémorroïdes, varices, fragilité des vaisseaux",
  C05A: "Hémorroïdes (usage local)",
  C07: "Bêtabloquant (tension, cœur, arythmie)",
  C08: "Hypertension, angine de poitrine (inhibiteur calcique)",
  C09: "Hypertension, insuffisance cardiaque",
  C10: "Cholestérol, lipides sanguins",
  C10AA: "Cholestérol (statine)",

  // D — Peau
  D01: "Mycoses de la peau et des ongles",
  D02: "Peau sèche, protection de la peau",
  D03: "Plaies, cicatrisation",
  D04: "Démangeaisons, piqûres d'insectes",
  D05: "Psoriasis",
  D06: "Infections de la peau (usage local)",
  D07: "Eczéma, inflammation de la peau (corticoïde local)",
  D08: "Désinfection des plaies (antiseptique)",
  D09: "Pansement médicamenteux",
  D10: "Acné",
  D11: "Autres affections de la peau (cheveux, verrues…)",

  // G — Système génito-urinaire et hormones sexuelles
  G01: "Infections gynécologiques",
  G02: "Gynécologie (autres)",
  G03: "Hormones sexuelles",
  G03A: "Contraception hormonale",
  G03C: "Ménopause (œstrogène)",
  G04: "Voies urinaires",
  G04BD: "Vessie hyperactive, incontinence",
  G04BE: "Troubles de l'érection",
  G04C: "Hypertrophie bénigne de la prostate (troubles urinaires)",

  // H — Hormones (hors hormones sexuelles)
  H01: "Hormones hypophysaires",
  H02: "Corticoïde (inflammation, allergie sévère)",
  H03: "Thyroïde",
  H03A: "Hypothyroïdie (hormone thyroïdienne)",
  H03B: "Hyperthyroïdie",
  H04: "Hypoglycémie sévère",
  H05: "Équilibre du calcium",

  // J — Infections
  J01: "Infection bactérienne (antibiotique)",
  J02: "Infection à champignons (antifongique)",
  J04: "Tuberculose",
  J05: "Infection virale (antiviral)",
  J06: "Immunoglobulines, sérums",
  J07: "Vaccin",

  // L — Cancer et immunité
  L01: "Cancer (anticancéreux)",
  L02: "Cancer (traitement hormonal)",
  L03: "Stimulation du système immunitaire",
  L04: "Maladies auto-immunes, greffes (immunosuppresseur)",

  // M — Muscles, articulations, os
  M01: "Douleur et inflammation (anti-inflammatoire)",
  M01A: "Douleur, inflammation, fièvre (anti-inflammatoire non stéroïdien)",
  M02: "Douleurs musculaires et articulaires (usage local)",
  M03: "Contractures musculaires (relaxant)",
  M04: "Goutte",
  M05: "Ostéoporose, os",
  M09: "Articulations, muscles (autres)",

  // N — Système nerveux
  N01: "Anesthésie",
  N01B: "Anesthésie locale",
  N02: "Douleur, fièvre, migraine",
  N02A: "Douleurs fortes (opioïde)",
  N02B: "Douleur et fièvre",
  N02C: "Migraine",
  N03: "Épilepsie",
  N04: "Maladie de Parkinson",
  N05: "Anxiété, sommeil, troubles psychiatriques",
  N05A: "Troubles psychotiques, bipolarité (antipsychotique)",
  N05B: "Anxiété",
  N05C: "Insomnie (somnifère)",
  N06: "Dépression, attention, mémoire",
  N06A: "Dépression (antidépresseur)",
  N06B: "TDAH, somnolence (stimulant)",
  N06D: "Démence, maladie d'Alzheimer",
  N07: "Système nerveux (dépendances, vertiges…)",
  N07B: "Dépendance (tabac, alcool, opioïdes)",
  N07C: "Vertiges",

  // P — Parasites
  P01: "Parasites (paludisme, amibes…)",
  P02: "Vers intestinaux (vermifuge)",
  P03: "Poux, gale, insectes",

  // R — Système respiratoire
  R01: "Nez bouché, rhinite",
  R01AA: "Nez bouché (décongestionnant nasal)",
  R01AB: "Nez bouché (décongestionnant nasal)",
  R01AC: "Rhinite allergique (spray nasal)",
  R01AD: "Rhinite allergique, nez bouché chronique (corticoïde nasal)",
  R01B: "Nez bouché (décongestionnant oral)",
  R02: "Mal de gorge",
  R03: "Asthme et BPCO",
  R03AC: "Asthme, BPCO (bronchodilatateur)",
  R03AK: "Asthme, BPCO (traitement de fond combiné)",
  R03AL: "BPCO, asthme (bronchodilatateurs combinés)",
  R03BA: "Asthme, BPCO (corticoïde inhalé, traitement de fond)",
  R03BB: "BPCO, asthme (bronchodilatateur)",
  R03DC: "Asthme (antileucotriène)",
  R05: "Toux et rhume",
  R05C: "Toux grasse (expectorant, mucolytique)",
  R05D: "Toux sèche (antitussif)",
  R05X: "Rhume (associations)",
  R06: "Allergies (antihistaminique)",
  R07: "Système respiratoire (autres)",

  // S — Organes des sens
  S01: "Yeux",
  S01A: "Infection de l'œil",
  S01B: "Inflammation de l'œil",
  S01E: "Glaucome",
  S01G: "Allergie, irritation de l'œil",
  S01X: "Yeux secs, autres",
  S02: "Oreilles",
  S03: "Yeux et oreilles",

  // V — Divers
  V01: "Allergie (désensibilisation)",
  V03: "Antidote, divers",
  V04: "Test de diagnostic",
  V06: "Nutrition",
  V07: "Produit non thérapeutique",
  V08: "Produit de contraste (imagerie)",
  V09: "Diagnostic (médecine nucléaire)",
  V10: "Médecine nucléaire (traitement)",
};

/** Texte « Utilisé pour » le plus précis disponible pour un code ATC (ou ""). */
function atcSummary(atc) {
  if (!atc) return "";
  for (const len of [5, 4, 3]) {
    const t = ATC_FR[atc.slice(0, len)];
    if (t) return t;
  }
  return "";
}
