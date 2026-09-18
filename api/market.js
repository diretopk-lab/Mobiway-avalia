function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');
}

function parseBody(req) {
  if (!req.body) return {};

  if (
    typeof req.body === 'object' &&
    !Buffer.isBuffer(req.body)
  ) {
    return req.body;
  }

  const raw = Buffer.isBuffer(req.body)
    ? req.body.toString('utf8')
    : String(req.body);

  const type = String(
    req.headers['content-type'] || ''
  ).toLowerCase();

  try {
    if (type.includes('application/json')) {
      return JSON.parse(raw || '{}');
    }

    return Object.fromEntries(
      new URLSearchParams(raw)
    );
  } catch {
    return {};
  }
}

function textFromGemini(data) {
  const parts =
    data?.candidates?.[0]?.content?.parts || [];

  return parts
    .map(part =>
      typeof part?.text === 'string'
        ? part.text
        : ''
    )
    .join('')
    .trim();
}

function sourcesFromGemini(data) {
  const chunks =
    data?.candidates?.[0]
      ?.groundingMetadata
      ?.groundingChunks || [];

  const map = new Map();

  for (const chunk of chunks) {
    const web = chunk?.web;

    if (web?.uri) {
      map.set(web.uri, {
        title: web.title || web.uri,
        url: web.uri
      });
    }
  }

  return [...map.values()].slice(0, 12);
}

function parseJsonText(text) {
  if (!text) return null;

  let clean = String(text).trim();

  clean = clean
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```$/i, '')
    .trim();

  try {
    return JSON.parse(clean);
  } catch {}

  const match = clean.match(/\{[\s\S]*\}/);

  if (!match) return null;

  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
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
      provider: 'Google Gemini',
      model: 'gemini-2.5-flash',
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
      error:
        'Marca, modelo, ano e quilometragem são obrigatórios.'
    });
  }

  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return res.status(500).json({
      error:
        'Gemini não está autenticado. Configure GEMINI_API_KEY no Vercel.'
    });
  }

  const vehicle = {
    make,
    model,
    version: String(body.version || '').trim(),
    engine: String(body.engine || '').trim(),
    fuel: String(body.fuel || '').trim(),
    transmission: String(
      body.transmission || ''
    ).trim(),
    year,
    mileage,
    power: String(body.power || '').trim(),
    notes: String(body.notes || '').trim()
  };

  const prompt = `
És um avaliador profissional de automóveis usados
para um comerciante automóvel em Portugal.

Usa a Pesquisa Google para encontrar anúncios ATUAIS
em Portugal de viaturas comparáveis à seguinte:

${JSON.stringify(vehicle, null, 2)}

OBJETIVO:

Estimar o VALOR DE VENDA A RETALHO realista em Portugal.

Não calcular valor de retoma.
Não calcular valor de compra profissional.

REGRAS:

- pesquisa anúncios atuais em Portugal;
- privilegia Standvirtual, PiscaPisca, OLX Autos,
  AutoUncle, concessionários e outros sites portugueses;
- privilegia mesma marca, modelo e geração;
- privilegia mesma motorização;
- privilegia mesmo combustível;
- privilegia mesma caixa de velocidades;
- compara anos próximos;
- compara quilometragens próximas;
- elimina anúncios duplicados;
- elimina anúncios manifestamente fora do mercado;
- elimina viaturas sinistradas;
- elimina viaturas para peças;
- elimina anúncios claramente não comparáveis;
- não inventes anúncios;
- não inventes URLs;
- se não conseguires confirmar um URL,
  coloca uma string vazia;
- marketValue representa o preço de venda
  a retalho estimado;
- low e high representam uma faixa de mercado
  realista;
- confidence deve ser um número inteiro entre 0 e 100;
- comparablesCount deve representar o número de
  anúncios úteis efetivamente considerados;
- summary deve explicar resumidamente os principais
  ajustamentos efetuados.

Responde APENAS com JSON válido.

Não uses markdown.
Não uses blocos de código.
Não escrevas texto antes ou depois do JSON.

Formato obrigatório:

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

  let response;

  try {
    response = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',
      {
        method: 'POST',

        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey
        },

        body: JSON.stringify({
          contents: [
            {
              role: 'user',
              parts: [
                {
                  text: prompt
                }
              ]
            }
          ],

          tools: [
            {
              google_search: {}
            }
          ],

          generationConfig: {
            temperature: 0.2,
            maxOutputTokens: 4096
          }
        })
      }
    );

  } catch (e) {
    return res.status(502).json({
      error:
        'Falha de ligação ao Gemini: ' +
        (e?.message || 'erro desconhecido')
    });
  }

  const raw = await response.text();

  let data;

  try {
    data = JSON.parse(raw);
  } catch {
    data = null;
  }

  if (!response.ok) {
    const detail =
      data?.error?.message ||
      data?.error?.status ||
      raw.slice(0, 500) ||
      `HTTP ${response.status}`;

    return res.status(502).json({
      error: `Gemini: ${detail}`
    });
  }

  const text = textFromGemini(data);

  const result = parseJsonText(text);

  if (
    !result ||
    !Number(result.marketValue)
  ) {
    return res.status(502).json({
      error:
        'A resposta do Gemini não contém um valor de mercado válido.'
    });
  }

  const sources =
    sourcesFromGemini(data);

  const comparables =
    Array.isArray(result.comparables)
      ? result.comparables
          .slice(0, 12)
          .map(c => ({
            title: String(
              c?.title || ''
            ),

            url: String(
              c?.url || ''
            ),

            price: String(
              c?.price || ''
            ),

            year: String(
              c?.year || ''
            ),

            mileage: String(
              c?.mileage || ''
            )
          }))
      : [];

  return res.status(200).json({
    ...result,

    marketValue:
      Math.round(
        Number(result.marketValue)
      ),

    low:
      Math.round(
        Number(
          result.low ||
          result.marketValue
        )
      ),

    high:
      Math.round(
        Number(
          result.high ||
          result.marketValue
        )
      ),

    confidence:
      Math.max(
        0,
        Math.min(
          100,
          Math.round(
            Number(
              result.confidence || 0
            )
          )
        )
      ),

    comparablesCount:
      Math.max(
        0,
        Math.round(
          Number(
            result.comparablesCount ||
            comparables.length ||
            0
          )
        )
      ),

    comparables,

    sources,

    provider:
      'Google Gemini',

    model:
      'gemini-2.5-flash',

    researchedAt:
      new Date().toISOString(),

    currency:
      'EUR'
  });
};
