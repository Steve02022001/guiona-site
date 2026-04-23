const MATERIAU_MAP = {
  'fenetre': 'materiauxFenetre__c',
  'porte-fenetre': 'materiauxPorteFenetre__c',
  'baie-vitree': 'materiauxCoulissant__c',
};

const QUANTITE_MAP = {
  'fenetre': 'quantiteFenetre__c',
  'porte-fenetre': 'quantitePorteFenetre__c',
  'baie-vitree': 'quantiteCoulissant__c',
};

function parseQuantite(q) {
  if (!q) return null;
  if (q === '10 et plus') return 10;
  const n = parseInt(q, 10);
  return isNaN(n) ? null : n;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const {
    civilite, situation, habitat,
    prenom, nom, email, telephone,
    adresse, codePostal, ville, message,
    produits,
  } = req.body;

  if (!prenom || !nom || !email || !telephone) {
    return res.status(400).json({ error: 'Champs obligatoires manquants' });
  }

  try {
    const tokenRes = await fetch(`${process.env.SF_LOGIN_URL}/services/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: process.env.SF_CLIENT_ID,
        client_secret: process.env.SF_CLIENT_SECRET,
      }),
    });

    if (!tokenRes.ok) {
      const errText = await tokenRes.text();
      console.error('SF auth error:', errText);
      return res.status(500).json({ error: 'Authentification Salesforce échouée', details: errText });
    }

    const { access_token, instance_url } = await tokenRes.json();
    const sfApi = `${instance_url}/services/data/v59.0`;

    const civiliteMap = { madame: 'Mme.', monsieur: 'M.' };
    const habitatMap = { pavillon: 'Pavillon', appartement: 'Appartement' };

    const importPayload = {
      nomCompte__c: nom,
      prenomCompte__c: prenom,
      civiliteCompte__c: civiliteMap[civilite] || '',
      emailCompte__c: email,
      telephoneMobileCompte__c: telephone,
      adresseGeolocalisation__c: adresse || '',
      codePostalCompte__c: codePostal || '',
      villeCompte__c: ville || '',
      nomFichierSource__c: 'formulaire_site_kpark.fr',
      source__c: '44 - Formulaire site KparK',
      callSource__c: '44 - Formulaire site KparK',
    };

    if (habitat && habitatMap[habitat]) {
      importPayload.typeHabitation__c = habitatMap[habitat];
    }

    const list = Array.isArray(produits) ? produits : [];
    for (const item of list) {
      const type = item?.type;
      const qty = parseQuantite(item?.quantite);
      const mat = item?.materiau;
      if (type && qty !== null && QUANTITE_MAP[type]) {
        importPayload[QUANTITE_MAP[type]] = qty;
      }
      if (type && mat && MATERIAU_MAP[type]) {
        importPayload[MATERIAU_MAP[type]] = mat;
      }
    }

    const descLines = [];
    if (situation) descLines.push(`Situation: ${situation}`);
    if (message) descLines.push(message);
    if (descLines.length) importPayload.description__c = descLines.join('\n');

    const importRes = await fetch(`${sfApi}/sobjects/Import__c`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(importPayload),
    });

    const importResult = await importRes.json();

    if (Array.isArray(importResult) || !importResult.success) {
      console.error('Import creation error:', JSON.stringify(importResult));
      return res.status(500).json({ error: 'Erreur création import', details: importResult });
    }

    return res.status(200).json({
      success: true,
      importId: importResult.id,
    });

  } catch (error) {
    console.error('Server error:', error);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
};
