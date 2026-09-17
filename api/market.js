function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');
}

function parseBody(req) {
  if (!req.body) return {};
  if (typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;
  const raw = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : String(req.body);
  const type = String(req.headers['content-type'] || '').toLowerCase();

  try {
    if (type.includes('application/json')) return JSON.parse(raw || '{}');
    return Object.fromEntries(new URLSearchParams(raw));
  } catch {
    return {};
  }
}

function textFromResponse(data) {
  let out = '';

  for (const item of data?.output || []) {
    if (item?.type !== 'message') continue;

    for (const part of item.content || []) {
      if (part?.type === 'output_text' && typeof part.text === 'string') {
        out += part.text;
      }
    }
  }

  return out.trim();
}

function sourcesFromResponse(data) {
  const map = new Map();

  for (const item of data?.output || []) {
    if (item?.type === 'web_search_call') {
      for (const s of item?.action?.sources || []) {
        if (s?.url) {
          map.set(s.url, {
            title: s.title || s.url,
            url: s.url
          });
        }
      }
    }

    if (item?.type === 'message') {
      for (const part of item.content || []) {
        for (const a of part?.annotations || []) {
          if (a?.type === 'url_citation' && a?.url) {
            map.set(a.url, {
              title: a.title || a.url,
              url: a.url
            });
          }
        }
      }
    }
  }

  return [...map.values()].slice(0, 12);
}

module.exports = async function handler(req, res) {
  cors(res);

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method === 'GET') {
    return res.status(200).json({
      ok: true,
      service: 'MOBIWAY Avalia Market API',
      route: '/api/market',
      time: new Date().toISOString()
    });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({
      error: 'Método não permitido.'
    });
  }

  const body = parseBody(req);

  const make = String(body.make || '').trim();
  const model = String(body.model || '').trim();
  const year = String(body.year || '').trim();
  const mileage = String(body.mileage || '').trim();

  if (!make || !model || !year || !mileage) {
    return res.status(400).json({
      error: 'Marca, modelo, ano e quilometragem são obrigatórios.'
    });
  }

  const token =
    process.env.AI_GATEWAY_API_KEY ||
    process.env.VERCEL_OIDC_TOKEN;

  if (!token) {
    return res.status(500).json({
      error: 'AI Gateway não está autenticado. Configure AI_GATEWAY_API_KEY no Vercel.'
    });
  }

  const vehicle = {
    make,
    model,
    version: String(body.version || '').trim(),
    engine: String(body.engine || '').trim(),
    fuel: String(body.fuel || '').trim(),
    transmission: String(body.transmission || '').trim(),
    year,
    mileage,
    power: String(body.power || '').trim(),
    notes: String(body.notes || '').trim()
  };

  const prompt = `
És um avaliador profissional de automóveis usados para um comerciante em Portugal.

Pesquisa anúncios ATUAIS no mercado português para uma viatura comparável a esta:

${JSON.stringify(vehicle, null, 2)}

Objetivo:
Estimar o VALOR DE VENDA A RETALHO realista em Portugal.

Regras:
- pesquisa prioritariamente anúncios portugueses atuais;
- privilegia mesma marca, modelo, geração, motor, combustível e caixa;
- compara anos e quilometragens semelhantes;
- elimina anúncios fora do padrão e duplicados;
- devolve valor central, mínimo, máximo e confiança;
- indica número de anúncios comparáveis;
- explica resumidamente os ajustamentos;
- inclui URLs dos anúncios quando disponíveis.

Responde APENAS em JSON válido neste formato:

{
  "marketValue": 0,
  "low": 0,
  "high": 0,
  "confidence": 0,
  "comparablesCount": 0,
  "summary": "",
  "comparables": [
    {
      "title": "",
      "url": "",
      "price": "",
      "year": "",
      "mileage": ""
    }
  ]
}
`;

  let gateway;

  try {
    gateway = await fetch(
      'https://ai-gateway.vercel.sh/v1/responses',
      {
        method: 'POST',

        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },

        body: JSON.stringify({
                    model: 'openai/gpt-5.6-sol',
          input: prompt,

          tools: [
            {
              type: 'web_search_preview',
              search_context_size: 'high',
              user_location: {
                type: 'approximate',
                country: 'PT'
              }
            }
          ]
        })
      }
    );

  } catch (e) {
    return res.status(502).json({
      error:
        'Falha de ligação ao AI Gateway: ' +
        (e?.message || 'erro desconhecido')
    });
  }

  const raw = await gateway.text();

  let data;

  try {
    data = JSON.parse(raw);
  } catch {
    data = null;
  }

  if (!gateway.ok) {
    const detail =
      data?.error?.message ||
      data?.error ||
      raw.slice(0, 500) ||
      `HTTP ${gateway.status}`;

    return res.status(502).json({
      error: `AI Gateway: ${detail}`
    });
  }

  const text = textFromResponse(data);

  if (!text) {
    return res.status(502).json({
      error: 'A IA não devolveu uma avaliação utilizável.'
    });
  }

  let result;

  try {
    result = JSON.parse(text);

  } catch {

    const match = text.match(/\{[\s\S]*\}/);

    try {
      result = match
        ? JSON.parse(match[0])
        : null;

    } catch {
      result = null;
    }
  }

  if (!result || !Number(result.marketValue)) {
    return res.status(502).json({
      error: 'A resposta da IA não contém um valor de mercado válido.'
    });
  }

  return res.status(200).json({
    ...result,

    marketValue:
      Math.round(Number(result.marketValue)),

    low:
      Math.round(
        Number(result.low || result.marketValue)
      ),

    high:
      Math.round(
        Number(result.high || result.marketValue)
      ),

    confidence:
      Math.max(
        0,
        Math.min(
          100,
          Math.round(Number(result.confidence || 0))
        )
      ),

    comparablesCount:
      Math.max(
        0,
        Math.round(
          Number(result.comparablesCount || 0)
        )
      ),

    sources:
      sourcesFromResponse(data),

    researchedAt:
      new Date().toISOString(),

    currency:
      'EUR'
  });
};
