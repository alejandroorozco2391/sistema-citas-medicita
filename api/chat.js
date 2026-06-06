export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.ANTHROPIC_API_KEY;

  console.log('apiKey present:', !!apiKey);
  console.log('apiKey length:', apiKey?.length);
  console.log('body type:', typeof req.body);
  console.log('body:', JSON.stringify(req.body));

  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });

  try {
    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: typeof req.body === 'string' ? req.body : JSON.stringify(req.body),
    });

    console.log('upstream status:', upstream.status);
    const data = await upstream.json();
    res.status(upstream.status).json(data);
  } catch (err) {
    console.error('fetch error:', err.message);
    res.status(502).json({ error: err.message });
  }
}
