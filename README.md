# Pharmacie

Inventaire de la pharmacie familiale (Belgique) : PWA installable sur Android/iOS et utilisable sur PC.

**App :** https://pythdom.github.io/Pharmacie/

- **Scan** du DataMatrix GS1 des boîtes (GTIN + **date de péremption** + lot + n° de série), des codes EAN et CNK. Sinon, photo ou saisie du code.
- **Inventaire** avec alertes « bientôt périmé » / « périmé », emplacement, notes, lien vers la notice.
- **Boîte vide** (bouton ou scan en mode « Boîte vide ») : la boîte est retirée de l'inventaire et peut être ajoutée au **refill**.
- **Refill** : liste de rachat, partageable. Scanner une nouvelle boîte la retire automatiquement de la liste.
- Fonctionne **hors ligne** (service worker).

## Données

- Médicaments : export public **SAM v2** (AFMPS / eHealth), converti en `data/meds.json` (GTIN, CNK, nom, conditionnement, ATC, notice, prescription) et `data/para.json` (parapharmacie par CNK) par `scripts/build_db.py`. Mis à jour chaque lundi par la GitHub Action `update-db.yml`, qu'on peut aussi lancer à la main.
- Produits absents de SAM (certains produits sans ordonnance avec EAN) : recherche dans Open Products / Beauty / Food Facts. Sinon, on nomme le produit et l'app mémorise l'association code → produit pour les scans suivants.

## Inventaire et synchronisation

L'inventaire est enregistré sur l'appareil (localStorage). Il est aussi synchronisé dans le dépôt **privé** `PythDom/Pharmacie-data` (`data/inventory.json`) via l'API GitHub :

1. Créez un jeton *fine-grained* sur https://github.com/settings/personal-access-tokens/new
   - Repository access : *Only select repositories* → `Pharmacie-data`
   - Permissions : *Contents* → **Read and write**
2. Dans l'app : **Réglages** → collez le jeton → Enregistrer. Faites de même sur chaque appareil.

Chaque enregistrement porte un `updatedAt` : les modifications de plusieurs appareils sont fusionnées enregistrement par enregistrement (le plus récent gagne), et les suppressions sont conservées comme marqueurs. La synchronisation ne s'exécute que sur `pythdom.github.io` : aucun test local ne peut écrire dans le dépôt.

## Développement

```
python -m http.server 8791
python scripts/build_db.py sam.zip data <version>
```

Après une modification de l'app, incrémenter `VERSION` dans `sw.js` pour que les appareils installés récupèrent la nouvelle version.
