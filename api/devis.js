module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { civilite, prenom, nom, email, telephone, adresse, message, ouvertures } = req.body;

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

    const products = Array.isArray(ouvertures) ? ouvertures : [];
    const civiliteMap = { madame: 'Mme.', monsieur: 'M.' };

    const importPayload = {
      nomCompte__c: nom,
      prenomCompte__c: prenom,
      civiliteCompte__c: civiliteMap[civilite] || '',
      emailCompte__c: email,
      telephoneMobileCompte__c: telephone,
      adresseGeolocalisation__c: adresse || '',
      nomFichierSource__c: 'formulaire_site_kpark.fr',
      source__c: '44 - Formulaire site KparK',
      Source_web__c: '44 - Formulaire site KparK',
    };

    if (products.includes('fenetre')) importPayload.quantiteFenetre__c = 1;
    if (products.includes('porte-fenetre')) importPayload.quantitePorteFenetre__c = 1;
    if (products.includes('baie-vitree')) importPayload.quantiteCoulissant__c = 1;

    if (message) importPayload.Description__c = message;

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
