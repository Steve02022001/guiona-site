module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { codePostal, iris } = req.body || {};

  if (!codePostal || !/^\d{5}$/.test(codePostal)) {
    return res.status(400).json({ error: 'Code postal invalide' });
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
      return res.status(500).json({ error: 'Authentification Salesforce échouée' });
    }

    const { access_token, instance_url } = await tokenRes.json();
    const sfApi = `${instance_url}/services/data/v59.0`;

    const runQuery = async (soql) => {
      const url = `${sfApi}/query/?q=${encodeURIComponent(soql)}`;
      const r = await fetch(url, {
        headers: { Authorization: `Bearer ${access_token}` },
      });
      if (!r.ok) {
        const t = await r.text();
        console.error('SF query error:', t);
        return null;
      }
      return r.json();
    };

    const escape = (s) => String(s).replace(/'/g, "\\'");
    const cp = escape(codePostal);
    const dep = cp.substring(0, 2);
    const fullIris = iris && /^\d{9}$/.test(iris) ? escape(iris) : null;

    const queries = [];
    if (fullIris) {
      queries.push(`SELECT Id, codeMagasin__c, libelleMagasin__c, codePostalAdm__c, IRIS__c FROM Sectorisation__c WHERE IRIS__c = '${fullIris}' AND codeMagasin__c != null LIMIT 1`);
      queries.push(`SELECT Id, codeMagasin__c, libelleMagasin__c, codePostalAdm__c, IRIS__c FROM Sectorisation__c WHERE IRIS__c LIKE '${fullIris.substring(0, 5)}%' AND codeMagasin__c != null LIMIT 1`);
    }
    queries.push(`SELECT Id, codeMagasin__c, libelleMagasin__c, codePostalAdm__c FROM Sectorisation__c WHERE codePostalAdm__c = '${cp}' AND codeMagasin__c != null LIMIT 1`);
    queries.push(`SELECT Id, codeMagasin__c, libelleMagasin__c, codePostalAdm__c FROM Sectorisation__c WHERE codePostalAdm__c LIKE '${cp}%' AND codeMagasin__c != null LIMIT 1`);
    queries.push(`SELECT Id, codeMagasin__c, libelleMagasin__c, codePostalAdm__c FROM Sectorisation__c WHERE codePostalAdm__c LIKE '${dep}%' AND codeMagasin__c != null LIMIT 1`);

    for (const soql of queries) {
      const result = await runQuery(soql);
      if (result && result.records && result.records.length > 0) {
        const rec = result.records[0];
        return res.status(200).json({
          covered: true,
          codeMagasin: rec.codeMagasin__c,
          libelleMagasin: rec.libelleMagasin__c,
          matchedBy: rec.IRIS__c ? 'IRIS' : 'codePostal',
        });
      }
    }

    return res.status(200).json({ covered: false });

  } catch (error) {
    console.error('Server error:', error);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
};
