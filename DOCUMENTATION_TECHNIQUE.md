# Documentation technique — Intégration Salesforce du formulaire de devis

## 1. Vue d'ensemble

Le formulaire de devis du site Guiona (`devis.html`) est connecté au CRM Salesforce (sandbox Kube3) via une API serverless hébergée sur Vercel. Quand un visiteur remplit le formulaire, les données sont envoyées à Salesforce dans l'objet **Import__c** (appelé "Fiche contact" dans l'interface SF). Les automations Salesforce se chargent ensuite de créer le Compte, le Chantier et le Projet.

### Architecture

```
┌──────────────┐     POST /api/devis      ┌──────────────────┐     API REST SF     ┌─────────────────┐
│  Formulaire  │ ─────────────────────────▶│  Vercel Serverless│ ──────────────────▶│   Salesforce     │
│  devis.html  │                           │  api/devis.js     │                    │   Import__c      │
└──────────────┘                           └──────────────────┘                    └────────┬────────┘
                                                                                           │
                                                                                    Automations SF
                                                                                           │
                                                                              ┌────────────┼────────────┐
                                                                              ▼            ▼            ▼
                                                                           Compte      Chantier      Projet
```

---

## 2. Fichiers concernés

| Fichier | Rôle |
|---------|------|
| `devis.html` | Formulaire front-end en 3 étapes |
| `api/devis.js` | Fonction serverless Vercel (backend) |
| `technologie-pvc.html` | Lien CTA header corrigé vers `devis.html` |
| `inspirations.html` | Lien CTA header corrigé vers `devis.html` |

---

## 3. Formulaire front-end (`devis.html`)

### 3.1 Les 3 étapes du formulaire

| Étape | Contenu |
|-------|---------|
| 1 — Type d'ouverture | Multi-sélection : Fenêtre, Porte-fenêtre, Baie vitrée |
| 2 — Situation | Choix unique : Propriétaire, Locataire, Promoteur, Entreprise |
| 3 — Coordonnées | Civilité, Prénom, Nom, Téléphone, Email, Adresse, Code postal, Ville, Message |

### 3.2 Autocomplete adresse

L'API gouvernementale `api-adresse.data.gouv.fr` est utilisée pour l'autocomplétion :

- L'utilisateur tape une adresse dans le champ "Adresse du projet"
- Après 3 caractères, une recherche est déclenchée (avec un délai de 300ms)
- Quand l'utilisateur sélectionne une suggestion :
  - Le champ **Adresse** reçoit le nom de rue (`f.properties.name`)
  - Le champ **Code postal** se remplit automatiquement (`f.properties.postcode`)
  - Le champ **Ville** se remplit automatiquement (`f.properties.city`)
- Les champs Code postal et Ville sont en **lecture seule** (remplis uniquement par l'autocomplete)

### 3.3 Données envoyées au backend

```javascript
{
  civilite: 'monsieur' | 'madame' | '',
  prenom: 'Jean',
  nom: 'Dupont',
  email: 'jean@exemple.fr',
  telephone: '0612345678',
  adresse: '27 rue de Rieussec',
  codePostal: '78220',
  ville: 'Viroflay',
  message: 'Texte libre...',
  ouvertures: ['fenetre', 'porte-fenetre']  // tableau de valeurs
}
```

### 3.4 Validation côté client

Champs obligatoires validés avant envoi :
- **Prénom** : minimum 2 caractères
- **Nom** : minimum 2 caractères
- **Téléphone** : format valide (8+ chiffres)
- **Email** : format email valide
- **Ouverture** : au moins un type sélectionné (étape 1)

---

## 4. Backend (`api/devis.js`)

### 4.1 Authentification Salesforce

Le backend utilise le flux **OAuth 2.0 Client Credentials** :

```
POST {SF_LOGIN_URL}/services/oauth2/token
  grant_type=client_credentials
  client_id={SF_CLIENT_ID}
  client_secret={SF_CLIENT_SECRET}
```

Cela renvoie un `access_token` et une `instance_url` utilisés pour les appels API REST.

### 4.2 Variables d'environnement (Vercel)

| Variable | Description | Exemple |
|----------|-------------|---------|
| `SF_LOGIN_URL` | URL de login du sandbox | `https://kpark--kube3.sandbox.my.salesforce.com` |
| `SF_CLIENT_ID` | Client ID de l'External Client App SF | *(secret)* |
| `SF_CLIENT_SECRET` | Client Secret de l'External Client App SF | *(secret)* |

Ces variables sont configurées dans **Vercel → Settings → Environment Variables**.

### 4.3 Mapping formulaire → Salesforce

L'objet Salesforce cible est **`Import__c`** (étiquette : "Fiche contact (interne, externe)").

| Champ formulaire | Champ SF (Import__c) | Type SF | Valeur |
|-----------------|----------------------|---------|--------|
| Nom | `nomCompte__c` | Texte(80) | Saisie utilisateur |
| Prénom | `prenomCompte__c` | Texte(40) | Saisie utilisateur |
| Civilité | `civiliteCompte__c` | Liste de sélection | `Mme.` ou `M.` |
| Email | `emailCompte__c` | E-mail | Saisie utilisateur |
| Téléphone | `telephoneMobileCompte__c` | Téléphone | Saisie utilisateur |
| Adresse | `adresseGeolocalisation__c` | Texte(255) | Nom de rue (autocomplete) |
| Code postal | `codePostalCompte__c` | Texte(20) | Autocomplete |
| Ville | `villeCompte__c` | Texte(40) | Autocomplete |
| *(fixe)* | `nomFichierSource__c` | Texte(255) | `formulaire_site_kpark.fr` |
| *(fixe)* | `source__c` | Liste de sélection | `44 - Formulaire site KparK` |
| *(fixe)* | `Source_web__c` | Texte(255) | `44 - Formulaire site KparK` |
| Message | `Description__c` | *(à confirmer)* | Saisie utilisateur |

### 4.4 Mapping des ouvertures → champs quantité

| Valeur formulaire | Champ SF (Import__c) | Valeur |
|-------------------|----------------------|--------|
| `fenetre` | `quantiteFenetre__c` | `1` |
| `porte-fenetre` | `quantitePorteFenetre__c` | `1` |
| `baie-vitree` | `quantiteCoulissant__c` | `1` |

### 4.5 Flux d'exécution

```
1. Réception POST /api/devis
2. Validation des champs obligatoires (prenom, nom, email, telephone)
3. Authentification OAuth vers Salesforce
4. Construction du payload Import__c
5. POST vers /services/data/v59.0/sobjects/Import__c
6. Si succès → réponse 200 { success: true, importId: "..." }
7. Si erreur → réponse 500 avec détails de l'erreur SF
```

### 4.6 Gestion des erreurs

| Code HTTP | Cas |
|-----------|-----|
| `405` | Méthode autre que POST |
| `400` | Champs obligatoires manquants |
| `500` | Erreur auth SF / Erreur création Import / Erreur serveur |

Les erreurs Salesforce sont loguées dans la console Vercel (`console.error`) et renvoyées dans le champ `details` de la réponse JSON pour faciliter le debug.

---

## 5. Côté Salesforce — Ce qui se passe après

Quand un enregistrement `Import__c` est créé via l'API :

1. **Les automations Salesforce** (triggers/flows) prennent le relais
2. Elles créent automatiquement :
   - Un **Compte** (Person Account) avec les infos du client
   - Un **Chantier** lié au compte
   - Un **Projet** (Opportunity) lié au compte et au chantier

> **Important** : La sectorisation doit être configurée correctement côté Salesforce pour que le chantier soit rattaché à une entité commerciale et une entité de service.

---

## 6. Configuration Salesforce requise

### 6.1 External Client App

Une application externe a été créée dans Salesforce (Setup → External Client Apps) avec :
- **Client Credentials Flow** activé
- Un **Run As User** configuré (utilisateur d'intégration)
- Les **OAuth Scopes** nécessaires (`api`, `refresh_token`)

### 6.2 Permissions du Run As User

L'utilisateur d'intégration doit avoir :
- Accès en **lecture/écriture** sur l'objet `Import__c`
- Accès aux champs listés dans le mapping (section 4.3)
- Profil ou Permission Set avec les droits API activés

---

## 7. Déploiement

Le site est hébergé sur **Vercel** et se déploie automatiquement depuis la branche `main` du repo GitHub `Steve02022001/guiona-site`.

### Workflow de déploiement

```
1. Modification du code sur une branche feature
2. Push vers GitHub
3. Création d'une Pull Request vers main
4. Merge de la PR
5. Vercel détecte le push sur main et déploie automatiquement (~1 min)
```

### Structure des fichiers

```
guiona-site/
├── api/
│   └── devis.js          ← Fonction serverless (auto-déployée par Vercel)
├── devis.html             ← Formulaire de devis
├── index.html             ← Page d'accueil
├── technologie-pvc.html   ← Page technologie (CTA header corrigé)
├── inspirations.html      ← Page inspirations (CTA header corrigé)
└── ...
```

---

## 8. Points d'attention / À faire

- [ ] **Sectorisation** : Configurer la sectorisation SF pour que les chantiers soient rattachés aux bonnes entités
- [ ] **Champ Description__c** : Vérifier que ce champ existe sur Import__c (sinon trouver le bon nom API)
- [ ] **Valeurs picklist civilité** : Vérifier que `Mme.` et `M.` sont des valeurs valides dans la picklist `civiliteCompte__c`
- [ ] **Valeur picklist source** : Vérifier que `44 - Formulaire site KparK` est une valeur valide dans la picklist `source__c`
- [ ] **Mapping baie vitrée** : Confirmer que `quantiteCoulissant__c` est le bon champ pour "Baie vitrée"
- [ ] **Suppression des comptes test** : Nettoyer les comptes de test créés pendant le développement
