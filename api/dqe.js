const ENDPOINT_MAP = {
  address: () => process.env.DQE_ENDPOINT_ADDRESS,
  email: () => process.env.DQE_ENDPOINT_EMAIL,
  phone: () => process.env.DQE_ENDPOINT_TEL,
  cp: () => 'CP',
  adr: () => 'ADR',
};

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const input = req.method === 'GET' ? req.query : (req.body || {});
  const { type, ...dqeParams } = input;

  const endpointResolver = ENDPOINT_MAP[type];
  if (!endpointResolver) {
    return res.status(400).json({ error: 'Parameter "type" doit être address | email | phone | cp | adr' });
  }
  const endpoint = endpointResolver();
  if (!endpoint) {
    return res.status(500).json({ error: `Endpoint DQE non configuré pour type=${type}` });
  }

  const baseUrl = process.env.DQE_URL || process.env.URL_DQE;
  const licence = process.env.DQE_LICENCE;
  if (!baseUrl || !licence) {
    return res.status(500).json({ error: 'Configuration DQE manquante (DQE_URL / DQE_LICENCE)' });
  }

  const url = new URL(`${baseUrl.replace(/\/$/, '')}/${endpoint}/`);
  Object.entries(dqeParams).forEach(([k, v]) => {
    if (v === undefined || v === null || v === '') return;
    url.searchParams.set(k, Array.isArray(v) ? v.join(',') : String(v));
  });
  url.searchParams.set('Licence', licence);

  try {
    const r = await fetch(url.toString(), { method: 'GET' });
    const text = await r.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }
    return res.status(r.status).json(data);
  } catch (err) {
    console.error('DQE proxy error:', err);
    return res.status(502).json({ error: 'Erreur appel DQE', details: String(err) });
  }
};
