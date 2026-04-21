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

    const [accRtRes, oppRtRes] = await Promise.all([
      fetch(`${sfApi}/query?q=${encodeURIComponent("SELECT Id FROM RecordType WHERE SObjectType='Account' AND IsPersonType=true LIMIT 1")}`, {
        headers: { Authorization: `Bearer ${access_token}` },
      }),
      fetch(`${sfApi}/query?q=${encodeURIComponent("SELECT Id FROM RecordType WHERE SObjectType='Opportunity' AND Name='Projet' LIMIT 1")}`, {
        headers: { Authorization: `Bearer ${access_token}` },
      }),
    ]);

    const accRtData = await accRtRes.json();
    const oppRtData = await oppRtRes.json();
    const personAccountRtId = accRtData.records?.[0]?.Id;
    const projetRtId = oppRtData.records?.[0]?.Id;

    if (!personAccountRtId) {
      console.error('Person Account RecordType not found');
      return res.status(500).json({ error: 'Configuration Salesforce incomplète (RecordType Account)' });
    }

    const products = Array.isArray(ouvertures) ? ouvertures : [];
    const civiliteMap = { madame: 'Mme.', monsieur: 'M.' };

    const accountPayload = {
      RecordTypeId: personAccountRtId,
      LastName: nom,
      FirstName: prenom,
      Salutation: civiliteMap[civilite] || '',
      PersonEmail: email,
      PersonMobilePhone: telephone,
      BillingStreet: adresse || '',
    };

    const accRes = await fetch(`${sfApi}/sobjects/Account`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(accountPayload),
    });

    const accResult = await accRes.json();

    if (Array.isArray(accResult) || !accResult.success) {
      console.error('Account creation error:', JSON.stringify(accResult));
      return res.status(500).json({ error: 'Erreur création compte', details: accResult });
    }

    const now = new Date();
    const datePrefix = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
    const closeDate = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    const chantierPayload = {
      Name: `CHA_${datePrefix}_${prenom}_${nom}`,
      Proprietaire__c: accResult.id,
    };

    const chaRes = await fetch(`${sfApi}/sobjects/Chantier__c`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(chantierPayload),
    });

    const chaResult = await chaRes.json();

    if (Array.isArray(chaResult) || !chaResult.success) {
      console.error('Chantier creation error:', JSON.stringify(chaResult));
      return res.status(500).json({ error: 'Erreur création chantier', details: chaResult });
    }

    const oppPayload = {
      AccountId: accResult.id,
      chantier__c: chaResult.id,
      Name: `PRJ_${datePrefix}_${prenom}_${nom}`,
      StageName: 'Analyse',
      CloseDate: closeDate.toISOString().split('T')[0],
      Description: [
        products.length ? `Ouvertures: ${products.join(', ')}` : '',
        message ? `Message: ${message}` : '',
      ].filter(Boolean).join('\n'),
    };

    if (projetRtId) {
      oppPayload.RecordTypeId = projetRtId;
    }

    const oppRes = await fetch(`${sfApi}/sobjects/Opportunity`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(oppPayload),
    });

    const oppResult = await oppRes.json();

    if (Array.isArray(oppResult) || !oppResult.success) {
      console.error('Opportunity creation error:', JSON.stringify(oppResult));
      return res.status(500).json({ error: 'Erreur création projet', details: oppResult });
    }

    return res.status(200).json({
      success: true,
      accountId: accResult.id,
      opportunityId: oppResult.id,
    });

  } catch (error) {
    console.error('Server error:', error);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
};
