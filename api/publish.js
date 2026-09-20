'use strict';

const MAX_BODY_BYTES = 18 * 1024 * 1024;
const DEFAULT_EDITOR_URL = 'https://www.amen.pt/';

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-MOBIWAY-Token');
  res.setHeader('Cache-Control', 'no-store');
}

function json(res, status, body) {
  cors(res);
  return res.status(status).json(body);
}

function parseBody(req) {
  if (!req || req.body == null) return {};
  if (typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch { return {}; }
  }
  return {};
}

function cleanString(value, max = 10000) {
  return String(value == null ? '' : value).trim().slice(0, max);
}

function cleanNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function cleanBool(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  if (value === 'true' || value === 1 || value === '1') return true;
  if (value === 'false' || value === 0 || value === '0') return false;
  return fallback;
}

function normalizePhoto(photo, index) {
  const p = photo && typeof photo === 'object' ? photo : {};
  const data = cleanString(p.data, 14 * 1024 * 1024);
  return {
    name: cleanString(p.name || `foto-${index + 1}.jpg`, 160),
    data: /^data:image\/(jpeg|jpg|png|webp);base64,/i.test(data) ? data : '',
    cover: cleanBool(p.cover, index === 0)
  };
}

function normalize(input) {
  const vehicleIn = input.vehicle && typeof input.vehicle === 'object' ? input.vehicle : {};
  return {
    source: cleanString(input.source || 'MOBIWAY Avalia', 80),
    version: cleanNumber(input.version, 1),
    evaluationId: cleanString(input.evaluationId, 160),
    createdAt: cleanString(input.createdAt, 80) || new Date().toISOString(),
    productNumber: cleanString(input.productNumber, 120),
    name: cleanString(input.name, 240),
    price: cleanNumber(input.price),
    currency: cleanString(input.currency || 'EUR', 8).toUpperCase(),
    shortDescription: cleanString(input.shortDescription, 1200),
    description: cleanString(input.description, 24000),
    manufacturer: cleanString(input.manufacturer, 160),
    category: cleanString(input.category || 'Viaturas', 160),
    stocklevel: Math.max(0, Math.round(cleanNumber(input.stocklevel, 1))),
    visible: cleanBool(input.visible, true),
    searchKeywords: Array.isArray(input.searchKeywords)
      ? input.searchKeywords.map(v => cleanString(v, 100)).filter(Boolean).slice(0, 40)
      : [],
    preparationStatus: cleanString(input.preparationStatus, 160),
    vehicle: {
      plate: cleanString(vehicleIn.plate, 32),
      vin: cleanString(vehicleIn.vin, 64),
      year: cleanString(vehicleIn.year, 12),
      month: cleanString(vehicleIn.month, 12),
      km: cleanNumber(vehicleIn.km),
      fuel: cleanString(vehicleIn.fuel, 80),
      engine: cleanString(vehicleIn.engine, 160),
      engineCc: cleanNumber(vehicleIn.engineCc),
      power: cleanNumber(vehicleIn.power),
      co2: cleanNumber(vehicleIn.co2),
      color: cleanString(vehicleIn.color, 80),
      seats: cleanNumber(vehicleIn.seats),
      gearbox: cleanString(vehicleIn.gearbox, 80),
      origin: cleanString(vehicleIn.origin, 120)
    },
    photos: Array.isArray(input.photos)
      ? input.photos.slice(0, 30).map(normalizePhoto).filter(p => p.data)
      : []
  };
}

function validate(listing) {
  const errors = [];
  if (!listing.productNumber) errors.push('productNumber é obrigatório.');
  if (!listing.name) errors.push('name é obrigatório.');
  if (!(listing.price > 0)) errors.push('price tem de ser superior a 0.');
  if (listing.currency !== 'EUR') errors.push('currency deve ser EUR.');
  if (!listing.category) errors.push('category é obrigatória.');
  if (!listing.description && !listing.shortDescription) errors.push('É necessária uma descrição do anúncio.');
  return errors;
}

function authorize(req) {
  const expected = cleanString(process.env.MOBIWAY_PUBLISH_TOKEN, 500);
  if (!expected) return true;
  const header = cleanString(req.headers['x-mobiway-token'] || '', 500);
  const bearer = cleanString(req.headers.authorization || '', 600).replace(/^Bearer\s+/i, '');
  return header === expected || bearer === expected;
}

function epagesConfig() {
  const apiUrl = cleanString(process.env.EPAGES_API_URL, 2000).replace(/\/+$/, '');
  const accessToken = cleanString(process.env.EPAGES_ACCESS_TOKEN, 4000);
  const categoryId = cleanString(process.env.EPAGES_CATEGORY_ID, 500);
  const storefrontUrl = cleanString(process.env.EPAGES_STOREFRONT_URL, 2000).replace(/\/+$/, '');
  return { apiUrl, accessToken, categoryId, storefrontUrl, enabled: !!(apiUrl && accessToken) };
}

async function epagesRequest(cfg, path, options = {}) {
  const headers = {
    Accept: 'application/vnd.epages.v1+json',
    Authorization: `Bearer ${cfg.accessToken}`,
    ...(options.headers || {})
  };
  const response = await fetch(`${cfg.apiUrl}${path}`, {
    ...options,
    headers,
    signal: AbortSignal.timeout(30000)
  });
  const raw = await response.text();
  let data = null;
  try { data = raw ? JSON.parse(raw) : null; } catch { data = null; }
  if (!response.ok) {
    const detail = cleanString(data?.message || data?.error || raw || `HTTP ${response.status}`, 1200);
    throw new Error(`ePages HTTP ${response.status}: ${detail}`);
  }
  return { response, data, raw };
}

async function findProductBySku(cfg, sku) {
  const { data } = await epagesRequest(cfg, '/products/find', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ productNumber: sku })
  });
  const items = Array.isArray(data?.items) ? data.items : [];
  return items[0] || null;
}

function productCreateBody(listing) {
  return {
    productNumber: listing.productNumber,
    name: listing.name,
    shortDescription: listing.shortDescription,
    description: listing.description,
    manufacturer: listing.manufacturer || undefined,
    price: listing.price,
    searchKeywords: listing.searchKeywords,
    visible: listing.visible
  };
}

function productPatchBody(listing) {
  const fields = [
    ['/productNumber', listing.productNumber],
    ['/name', listing.name],
    ['/shortDescription', listing.shortDescription],
    ['/description', listing.description],
    ['/manufacturer', listing.manufacturer],
    ['/searchKeywords', listing.searchKeywords],
    ['/priceInfo/price/amount', listing.price],
    ['/visible', listing.visible]
  ];
  return fields.map(([path, value]) => ({ op: 'add', path, value }));
}

function dataUrlToBlob(dataUrl) {
  const match = String(dataUrl).match(/^data:(image\/(?:jpeg|jpg|png|webp));base64,(.+)$/i);
  if (!match) return null;
  const mime = match[1].toLowerCase() === 'image/jpg' ? 'image/jpeg' : match[1].toLowerCase();
  const buffer = Buffer.from(match[2], 'base64');
  return { mime, buffer };
}

async function uploadPhoto(cfg, productId, photo, index) {
  const decoded = dataUrlToBlob(photo.data);
  if (!decoded || !decoded.buffer.length) return null;
  const form = new FormData();
  form.append('file', new Blob([decoded.buffer], { type: decoded.mime }), photo.name || `foto-${index + 1}.jpg`);
  const response = await fetch(`${cfg.apiUrl}/products/${encodeURIComponent(productId)}/slideshow`, {
    method: 'POST',
    headers: {
      Accept: 'application/vnd.epages.v1+json',
      Authorization: `Bearer ${cfg.accessToken}`
    },
    body: form,
    signal: AbortSignal.timeout(30000)
  });
  const raw = await response.text();
  if (!response.ok) throw new Error(`ePages imagem HTTP ${response.status}: ${cleanString(raw, 700)}`);
  try { return raw ? JSON.parse(raw) : null; } catch { return null; }
}

async function assignCategory(cfg, productId) {
  if (!cfg.categoryId) return;
  const body = new URLSearchParams();
  body.append('categoryId', cfg.categoryId);
  body.append('productId', productId);
  await epagesRequest(cfg, '/product-category-assignments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString()
  });
}

async function publishToEpages(listing) {
  const cfg = epagesConfig();
  if (!cfg.enabled) return null;

  const existing = await findProductBySku(cfg, listing.productNumber);
  let product;
  let created = false;

  if (existing?.productId) {
    const { data } = await epagesRequest(cfg, `/products/${encodeURIComponent(existing.productId)}?locale=pt_PT&currency=EUR`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json-patch+json' },
      body: JSON.stringify(productPatchBody(listing))
    });
    product = data || existing;
  } else {
    const { data } = await epagesRequest(cfg, '/products?locale=pt_PT&currency=EUR', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(productCreateBody(listing))
    });
    product = data || {};
    created = true;
  }

  const productId = cleanString(product.productId || existing?.productId, 500);
  if (!productId) throw new Error('ePages não devolveu productId.');

  await assignCategory(cfg, productId);

  if (created && listing.photos.length) {
    for (let i = 0; i < listing.photos.length; i++) {
      await uploadPhoto(cfg, productId, listing.photos[i], i);
    }
  }

  const productUrl = cleanString(product.sfUrl || existing?.sfUrl || '', 2000)
    || (cfg.storefrontUrl ? `${cfg.storefrontUrl}/p/${encodeURIComponent(listing.productNumber)}` : '');

  return { productId, productUrl, created };
}

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();

  const cfg = epagesConfig();

  if (req.method === 'GET') {
    return json(res, 200, {
      ok: true,
      service: 'MOBIWAY Publisher API',
      route: '/api/publish',
      mode: cfg.enabled ? 'epages-direct' : 'shopbuilder-import',
      accepts: 'application/json',
      time: new Date().toISOString()
    });
  }

  if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'Método não permitido.' });
  if (!authorize(req)) return json(res, 401, { ok: false, error: 'Publisher não autorizado.' });

  const contentLength = cleanNumber(req.headers['content-length']);
  if (contentLength > MAX_BODY_BYTES) return json(res, 413, { ok: false, error: 'O anúncio excede o limite do Publisher.' });

  const listing = normalize(parseBody(req));
  const errors = validate(listing);
  if (errors.length) return json(res, 400, { ok: false, error: errors.join(' '), errors });

  try {
    const published = await publishToEpages(listing);
    if (published) {
      return json(res, 200, {
        ok: true,
        published: true,
        provider: 'ePages',
        productId: published.productId,
        productUrl: published.productUrl,
        productNumber: listing.productNumber,
        created: published.created,
        publishedAt: new Date().toISOString()
      });
    }

    return json(res, 503, {
      ok: false,
      code: 'EPAGES_NOT_CONFIGURED',
      requiresImport: true,
      productNumber: listing.productNumber,
      editorUrl: cleanString(process.env.SHOPBUILDER_EDITOR_URL || DEFAULT_EDITOR_URL, 2000),
      error: 'Publisher instalado, mas a ligação ePages da loja ainda não está configurada.'
    });
  } catch (e) {
    return json(res, 502, {
      ok: false,
      code: 'EPAGES_PUBLISH_FAILED',
      error: cleanString(e?.message || 'Falha na publicação ePages.', 1200)
    });
  }
};
