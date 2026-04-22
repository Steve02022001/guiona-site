# Documentation technique — POC Guiona
**Formulaire de devis connecté à Salesforce avec qualification DQE**

---

## 1. Vue d'ensemble

Ce site est un POC (preuve de concept) pour KparK / Guiona. Il reproduit le comportement du formulaire de demande de devis de **kpark.fr** avec un site de démonstration indépendant appelé **Guiona**.

Quand un visiteur remplit le formulaire, 3 choses se passent automatiquement en arrière-plan :

1. **Les données saisies sont vérifiées par DQE** (email existe ? numéro valide ? adresse réelle ?)
2. **La sectorisation Salesforce est consultée** pour savoir si un magasin couvre la zone du client
3. **Une fiche contact `Import__c` est créée dans Salesforce** → déclenche les automations qui créent Compte + Chantier + Projet

---

## 2. Architecture en un coup d'œil

```
┌────────────┐           ┌─────────────────┐           ┌────────────┐
│ Navigateur │ ────────▶ │ Vercel (backend)│ ────────▶ │    DQE     │
│ (le client)│ ◀──────── │   api/*.js      │ ◀──────── │ Software   │
└────────────┘           └────────┬────────┘           └────────────┘
                                  │
                                  │
                                  ▼
                         ┌─────────────────┐
                         │   Salesforce    │
                         │   (Kube3)       │
                         └─────────────────┘
```

**3 acteurs en présence :**
- **Navigateur** : le formulaire `devis.html` que le visiteur voit.
- **Vercel** : notre serveur intermédiaire (fonctions `api/*.js`). Il masque les clés secrètes et orchestre les appels.
- **DQE & Salesforce** : services externes.

**Pourquoi un serveur intermédiaire ?** Parce que les clés DQE et Salesforce doivent rester **secrètes**. Si on les mettait dans le navigateur, n'importe qui pourrait les copier (via F12).

---

## 3. Les fichiers clés

| Fichier | Rôle |
|---|---|
| `devis.html` | Formulaire en 2 étapes (HTML/CSS/JS vanilla) |
| `api/devis.js` | Création de la fiche Import__c dans Salesforce |
| `api/dqe.js` | Proxy Vercel vers l'API DQE (masque la licence) |
| `api/check-sectorisation.js` | Vérifie si Guiona couvre la zone via Salesforce |

---

## 4. Le formulaire en 2 étapes

### Étape 1 — Votre projet
- **Produit(s)** : fenêtre / porte-fenêtre / baie vitrée (multi-sélection)
- **Situation** : propriétaire / locataire
- **Habitat** : pavillon / appartement
- **Civilité** : madame / monsieur
- **Coordonnées** : nom, prénom, code postal, ville, adresse (facultative), téléphone, email

### Étape 2 — Détails du projet
Pour chaque produit choisi, on demande :
- **Type d'ouverture** (par ex : 2 vantaux, 1 vantail…)
- **Quantité** (1 à 10 et plus)
- **Matériau** (PVC, Bois, Aluminium, Mixte)

---

## 5. Le cœur du système : la validation DQE

DQE Software est un prestataire spécialisé dans la **qualification de données**. KparK a un contrat avec eux. Nous utilisons 3 endpoints :

### 5.1 Validation email — `DQEEMAILLOOKUP`
Exemple :
```
GET /DQEEMAILLOOKUP/?Email=test@exemple.fr&Licence=XXX
```
Réponse :
```json
{
  "1": {
    "eMail": "test@exemple.fr",
    "IdError": "00",
    "Redressement": 0
  }
}
```
- `IdError = "00"` → email valide
- Sinon → on bloque l'envoi avec un message clair

### 5.2 Validation téléphone — `TEL`
Exemple :
```
GET /TEL/?Tel=0612345678&Licence=XXX
```
Réponse :
```json
{
  "1": {
    "Tel": "0612345678",
    "Operator": "SFR",
    "Type": "MOBILE",
    "Geolocation": "METROPOLE"
  }
}
```
En plus de valider, DQE nous dit l'opérateur et si c'est un mobile ou un fixe.

### 5.3 Normalisation adresse — `RNVP` (la plus importante)
C'est cet appel qui nous donne le **code IRIS** (la clé pour la sectorisation fine).

```
GET /RNVP/?Adresse=27 RUE RIEUSSEC 78220 VIROFLAY&Pays=FRA&Instance=0&Licence=XXX
```
Réponse :
```json
{
  "1": {
    "Adresse": "27 RUE RIEUSSEC",
    "CodePostal": "78220",
    "Localite": "VIROFLAY",
    "Latitude": "48.80001",
    "Longitude": "2.171338",
    "IDLocalite": "78686",
    "iris": "0107",
    "DQELibErreur": "OK",
    "DQECodeErreur": "0"
  }
}
```

**Construction de l'IRIS complet** : on concatène `IDLocalite` + `iris` = **786860107** (9 chiffres).

---

## 6. Le proxy DQE — comment on cache la licence

Le code de `api/dqe.js` (version simplifiée) :

```javascript
const ENDPOINT_MAP = {
  address: () => process.env.DQE_ENDPOINT_ADDRESS, // RNVP
  email: () => process.env.DQE_ENDPOINT_EMAIL,     // DQEEMAILLOOKUP
  phone: () => process.env.DQE_ENDPOINT_TEL,       // TEL
  cp: () => 'CP',
  adr: () => 'ADR',
};

module.exports = async function handler(req, res) {
  const { type, ...dqeParams } = req.query;
  const endpoint = ENDPOINT_MAP[type]();

  const url = new URL(`${process.env.DQE_URL}/${endpoint}/`);
  Object.entries(dqeParams).forEach(([k, v]) => url.searchParams.set(k, v));
  url.searchParams.set('Licence', process.env.DQE_LICENCE);

  const r = await fetch(url.toString());
  const data = await r.json();
  return res.status(r.status).json(data);
};
```

### Schéma de la sécurité

```
 ❌ Mauvaise pratique :
 Navigateur ─────fetch(DQE, Licence=XXX)─────▶ DQE
   (la clé est visible dans F12 → n'importe qui peut la copier)

 ✅ Ce qu'on a fait :
 Navigateur ──fetch(/api/dqe)──▶ Vercel ──+ Licence──▶ DQE
                                (clé cachée ici)
```

---

## 7. La sectorisation Salesforce

### 7.1 La table `Sectorisation__c`
- **49 003 enregistrements** dans le sandbox Kube3
- Chaque ligne = une zone géographique + le magasin responsable

| Champ | Type | Exemple |
|---|---|---|
| `IRIS__c` | Texte(15), indexé | `786860107` |
| `codePostalAdm__c` | Texte(50), indexé | `78220` |
| `codeMagasin__c` | Texte(20) | `MAG0057` |
| `libelleMagasin__c` | Texte(100) | `PARIS LA FAYETTE` |

### 7.2 Les 5 requêtes progressives

Quand on cherche le magasin qui couvre l'adresse du client, on lance jusqu'à 5 requêtes SOQL dans l'ordre de précision décroissante :

1. **IRIS exact (9 chiffres)** → le plus précis
2. **IRIS commune (5 premiers chiffres + LIKE)** → au niveau commune
3. **Code postal exact** → au niveau code postal
4. **Code postal préfixe (LIKE)** → codes postaux commençant par…
5. **Département (2 premiers chiffres)** → le plus large

Dès qu'une requête renvoie un résultat avec un `codeMagasin__c`, on s'arrête.

### 7.3 Le code de `api/check-sectorisation.js` (extrait clé)

```javascript
const queries = [];
if (fullIris) {
  queries.push(`SELECT ... WHERE IRIS__c = '${fullIris}' LIMIT 1`);
  queries.push(`SELECT ... WHERE IRIS__c LIKE '${fullIris.substring(0, 5)}%' LIMIT 1`);
}
queries.push(`SELECT ... WHERE codePostalAdm__c = '${cp}' LIMIT 1`);
queries.push(`SELECT ... WHERE codePostalAdm__c LIKE '${cp}%' LIMIT 1`);
queries.push(`SELECT ... WHERE codePostalAdm__c LIKE '${dep}%' LIMIT 1`);

for (const soql of queries) {
  const result = await runQuery(soql);
  if (result.records.length > 0) {
    return { covered: true, codeMagasin: result.records[0].codeMagasin__c };
  }
}
return { covered: false };
```

---

## 8. Flux complet — séquence détaillée

```
┌─────────┐   ┌────────────┐   ┌─────┐    ┌───────────┐
│Visiteur │   │ devis.html │   │ DQE │    │Salesforce │
└────┬────┘   └─────┬──────┘   └──┬──┘    └─────┬─────┘
     │              │             │              │
     │ Remplit      │             │              │
     │──────────────▶             │              │
     │              │             │              │
     │ Clic         │             │              │
     │ "Suivant"    │             │              │
     │──────────────▶             │              │
     │              │             │              │
     │              │ POST email  │              │
     │              │─────────────▶              │
     │              │ POST phone  │              │
     │              │─────────────▶              │
     │              │ POST RNVP   │              │
     │              │─────────────▶              │
     │              │◀──IRIS─────│              │
     │              │             │              │
     │              │ Check sectorisation        │
     │              │─────────────────────────────▶
     │              │◀──────codeMagasin──────────│
     │              │             │              │
     │◀── Étape 2 ──│             │              │
     │              │             │              │
     │ Remplit      │             │              │
     │──────────────▶             │              │
     │ Clic         │             │              │
     │ "Envoyer"    │             │              │
     │──────────────▶             │              │
     │              │ POST devis  │              │
     │              │────────────────────────────▶
     │              │             │  [Automations SF]
     │              │             │  Création :
     │              │             │  - Compte
     │              │             │  - Chantier
     │              │             │  - Projet
     │              │◀───success─────────────────│
     │◀──"merci"────│             │              │
```

---

## 9. Mapping des champs formulaire → Salesforce `Import__c`

| Champ formulaire | Champ SF | Type |
|---|---|---|
| Nom | `nomCompte__c` | Texte(80) |
| Prénom | `prenomCompte__c` | Texte(40) |
| Civilité | `civiliteCompte__c` | Picklist (M. / Mme.) |
| Email | `emailCompte__c` | E-mail |
| Téléphone | `telephoneMobileCompte__c` | Téléphone |
| Code postal | `codePostalCompte__c` | Texte(20) |
| Ville | `villeCompte__c` | Texte(40) |
| Adresse | `adresseGeolocalisation__c` | Texte(255) |
| Habitat | `typeHabitation__c` | Picklist |
| Produit Fenêtre × N | `quantiteFenetre__c` + `materiauxFenetre__c` | Nombre + Picklist |
| Produit Porte-fenêtre × N | `quantitePorteFenetre__c` + `materiauxPorteFenetre__c` | Nombre + Picklist |
| Produit Baie vitrée × N | `quantiteCoulissant__c` + `materiauxCoulissant__c` | Nombre + Picklist |
| Situation + Message | `Description__c` | Texte long |
| *(fixe)* | `nomFichierSource__c` = `formulaire_site_kpark.fr` | |
| *(fixe)* | `source__c` = `44 - Formulaire site KparK` | |
| *(fixe)* | `callSource__c` = `44 - Formulaire site KparK` | |

---

## 10. Variables d'environnement Vercel

Tout est configuré dans **Vercel → Settings → Environment Variables** (et non dans le code, pour des raisons de sécurité).

| Variable | Usage |
|---|---|
| `SF_LOGIN_URL` | URL du sandbox Salesforce |
| `SF_CLIENT_ID` | Client ID de l'application OAuth SF |
| `SF_CLIENT_SECRET` | Client Secret OAuth SF |
| `DQE_URL` (ou `URL_DQE`) | `https://prod3.dqe-software.com` |
| `DQE_LICENCE` | Clé API DQE |
| `DQE_ENDPOINT_EMAIL` | `DQEEMAILLOOKUP` |
| `DQE_ENDPOINT_TEL` | `TEL` |
| `DQE_ENDPOINT_ADDRESS` | `RNVP` |

---

## 11. Gestion des erreurs côté utilisateur

Quand une validation échoue, le bouton "Étape suivante" est temporairement désactivé et le formulaire affiche un message contextualisé :

| Problème détecté | Message affiché | Endroit |
|---|---|---|
| Email invalide ou inexistant | *"Email invalide ou inexistant, merci de vérifier."* | Sous le champ email |
| Téléphone invalide | *"Numéro de téléphone invalide."* | Sous le champ téléphone |
| CP non couvert par Guiona | *"Désolé, Guiona n'est pas encore présent dans votre secteur."* | Sous le champ CP |
| Erreur réseau | *"Erreur réseau, veuillez réessayer."* | Sous le champ CP |

---

## 12. Ce qui a changé par rapport à la version initiale

| Avant | Après |
|---|---|
| Formulaire en 3 étapes | **2 étapes** (aligné kpark.fr) |
| Autocomplete adresse gouv.fr uniquement | + **validation DQE** (email, tel, adresse) |
| Sectorisation par code postal uniquement | **Sectorisation par IRIS** avec fallback CP (5 requêtes progressives) |
| Adresse, CP, Ville tous obligatoires | **Adresse facultative**, CP + Ville saisissables directement |
| Pas de qualification des données | Toutes les données sont qualifiées **avant** envoi en SF |

---

## 13. Déploiement

- **Hébergement** : Vercel (plan Hobby)
- **Repo GitHub** : `Steve02022001/guiona-site`
- **Branche principale** : `main`
- **Déploiement automatique** : à chaque push sur `main`, Vercel redéploie en ~1 min

---

## 14. Points d'attention / À venir

- [ ] Remplacer l'autocomplete adresse gouv.fr par l'autocomplete DQE (`/CP/` + `/ADR/`) pour une UX 100% alignée kpark.fr
- [ ] Gérer les "demandes non couvertes" (stocker dans un objet dédié pour relance quand Guiona s'étend)
- [ ] Remplacer la licence DQE par une clé dédiée Guiona (pour ne pas utiliser celle de kpark.fr en prod)
- [ ] Whitelister les IPs Vercel chez DQE si passage en prod volumétrique
- [ ] Mettre en place un monitoring des erreurs (Sentry ou équivalent)
