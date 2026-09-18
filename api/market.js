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

function parseJsonText(text) {
  if (!text) return null;

  let clean = String(text)
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

function textFromGemini(data) {
  const parts =
    data?.candidates?.[0]?.content?.parts || [];

  return parts
    .map(p =>
      typeof p?.text === 'string'
        ? p.text
        : ''
    )
    .join('')
    .trim();
}

async function tavilySearch(apiKey, query, restricted = true) {
  const body = {
    query,
    topic: 'general',
    search_depth: 'basic',
    max_results: 10,
    include_answer: false,
    include_raw_content: false
  };

  if (restricted) {
    body.include_domains = [
      'standvirtual.com',
      'piscapisca.pt',
      'olx.pt',
      'autouncle.pt'
    ];
  }

  const response = await fetch(
    'https://api.tavily.com/search',
    {
      method: 'POST',

      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },

      body: JSON.stringify(body)
    }
  );

  const raw = await response.text();

  let data;

  try {
    data = JSON.parse(raw);
  } catch {
    data = null;
  }

  if (!response.ok) {
    const detail =
      data?.detail ||
      data?.error ||
      raw.slice(0, 400) ||
      `HTTP ${response.status}`;

    throw new Error(
      `Tavily: ${detail}`
    );
  }

  return Array.isArray(data?.results)
    ? data.results
    : [];
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
      searchProvider: 'Tavily',
      aiProvider: 'Google Gemini',
      model: 'gemini-3.6-flash',
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

  const make =
    String(body.make || '').trim();

  const model =
    String(body.model || '').trim();

  const year =
    String(body.year || '').trim();

  const mileage =
    String(body.mileage || '').trim();

  if (
    !make ||
    !model ||
    !year ||
    !mileage
  ) {
    return res.status(400).json({
      error:
        'Marca, modelo, ano e quilometragem são obrigatórios.'
    });
  }

  const tavilyKey =
    process.env.TAVILY_API_KEY;

  const geminiKey =
    process.env.GEMINI_API_KEY;

  if (!tavilyKey) {
    return res.status(500).json({
      error:
        'Tavily não está autenticada. Configure TAVILY_API_KEY no Vercel.'
    });
  }

  if (!geminiKey) {
    return res.status(500).json({
      error:
        'Gemini não está autenticado. Configure GEMINI_API_KEY no Vercel.'
    });
  }

  const vehicle = {
    make,
    model,

    version:
      String(body.version || '').trim(),

    engine:
      String(body.engine || '').trim(),

    fuel:
      String(body.fuel || '').trim(),

    transmission:
      String(
        body.transmission || ''
      ).trim(),

    year,

    mileage,

    power:
      String(body.power || '').trim(),

    notes:
      String(body.notes || '').trim()
  };

  const queryParts = [
    vehicle.make,
    vehicle.model,
    vehicle.version,
    vehicle.engine,
    vehicle.fuel,
    vehicle.transmission,
    vehicle.year,
    `${vehicle.mileage} km`,
    'usado Portugal preço'
  ].filter(Boolean);

  const searchQuery =
    queryParts.join(' ');

  let searchResults = [];

  try {
    /*
     * Primeira pesquisa:
     * principais portais automóveis portugueses.
     */
    searchResults = await tavilySearch(
      tavilyKey,
      searchQuery,
      true
    );

    /*
     * Se houver poucos resultados,
     * faz uma segunda pesquisa aberta.
     */
    if (searchResults.length < 5) {
      const extra =
        await tavilySearch(
          tavilyKey,
          searchQuery,
          false
        );

      const map = new Map();

      for (const item of [
        ...searchResults,
        ...extra
      ]) {
        if (item?.url) {
          map.set(item.url, item);
        }
      }

      searchResults =
        [...map.values()]
          .slice(0, 15);
    }

  } catch (e) {
    return res.status(502).json({
      error:
        e?.message ||
        'Falha na pesquisa Tavily.'
    });
  }

  if (!searchResults.length) {
    return res.status(502).json({
      error:
        'A Tavily não encontrou anúncios comparáveis suficientes.'
    });
  }

  /*
   * Limita o conteúdo enviado ao Gemini.
   * Mantém URL, título e excerto real
   * devolvido pela Tavily.
   */
  const sourcesForAI =
    searchResults
      .slice(0, 15)
      .map((r, index) => ({
        id: index + 1,
        title:
          String(r.title || ''),
        url:
          String(r.url || ''),
        content:
          String(r.content || '')
            .slice(0, 1800),
        score:
          Number(r.score || 0)
      }));

  const prompt = `
És um avaliador profissional de automóveis usados
para um comerciante automóvel em Portugal.

VIATURA A AVALIAR:

${JSON.stringify(vehicle, null, 2)}

A pesquisa web já foi efetuada pela Tavily.

USA APENAS os resultados abaixo.
Não inventes anúncios, preços, quilometragens,
anos ou URLs que não estejam sustentados
pelos resultados fornecidos.

RESULTADOS DA PESQUISA:

${JSON.stringify(sourcesForAI, null, 2)}

OBJETIVO:

Calcular o VALOR DE VENDA A RETALHO
realista da viatura em Portugal.

CRITÉRIOS:

- mesma marca e modelo têm prioridade máxima;
- mesma geração tem prioridade;
- mesma motorização e combustível têm prioridade;
- mesma caixa tem prioridade;
- anos próximos são aceitáveis;
- quilometragem semelhante tem prioridade;
- exclui peças, sinistrados e anúncios inadequados;
- exclui valores claramente fora do padrão;
- evita duplicados;
- considera diferenças de ano e quilometragem;
- marketValue deve representar valor central realista;
- low deve representar o limite inferior plausível;
- high deve representar o limite superior plausível;
- confidence deve ser inteiro de 0 a 100;
- comparablesCount deve contar apenas anúncios realmente úteis;
- summary deve explicar brevemente como chegaste ao valor.

IMPORTANTE:

O preço pedido pelo proprietário, se existir,
NÃO deve determinar o valor de mercado.

Não calcules ainda preço de compra profissional
nem margem MOBIWAY.
Apenas valor de venda a retalho.

Responde APENAS em JSON válido.

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

  let geminiResponse;

  try {
    geminiResponse = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent',
      {
        method: 'POST',

        headers: {
          'Content-Type':
            'application/json',

          'x-goog-api-key':
            geminiKey
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

          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 4096,
            responseMimeType:
              'application/json'
          }
        })
      }
    );

  } catch (e) {
    return res.status(502).json({
      error:
        'Falha de ligação ao Gemini: ' +
        (
          e?.message ||
          'erro desconhecido'
        )
    });
  }

  const geminiRaw =
    await geminiResponse.text();

  let geminiData;

  try {
    geminiData =
      JSON.parse(geminiRaw);
  } catch {
    geminiData = null;
  }

  if (!geminiResponse.ok) {
    const detail =
      geminiData?.error?.message ||
      geminiData?.error?.status ||
      geminiRaw.slice(0, 500) ||
      `HTTP ${geminiResponse.status}`;

    return res.status(502).json({
      error:
        `Gemini: ${detail}`
    });
  }

  const aiText =
    textFromGemini(geminiData);

  const result =
    parseJsonText(aiText);

  if (
    !result ||
    !Number(result.marketValue)
  ) {
    return res.status(502).json({
      error:
        'O Gemini não devolveu um valor de mercado válido.'
    });
  }

  const comparables =
    Array.isArray(result.comparables)
      ? result.comparables
          .slice(0, 12)
          .map(c => ({
            title:
              String(c?.title || ''),

            url:
              String(c?.url || ''),

            price:
              String(c?.price || ''),

            year:
              String(c?.year || ''),

            mileage:
              String(c?.mileage || '')
          }))
      : [];

  /*
   * Fontes reais vindas diretamente
   * da pesquisa Tavily.
   */
  const sources =
    searchResults
      .filter(r => r?.url)
      .slice(0, 12)
      .map(r => ({
        title:
          String(
            r.title ||
            r.url
          ),

        url:
          String(r.url)
      }));

  return res.status(200).json({
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

    summary:
      String(
        result.summary || ''
      ),

    comparables,

    sources,

    searchProvider:
      'Tavily',

    aiProvider:
      'Google Gemini',

    model:
      'gemini-3.6-flash',

    researchedAt:
      new Date().toISOString(),

    currency:
      'EUR'
  });
};
