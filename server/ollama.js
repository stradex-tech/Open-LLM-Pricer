function getEnv(name, fallback) {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : fallback;
}

function withTimeout(ms) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), ms);
  return { signal: ac.signal, cancel: () => clearTimeout(t) };
}

function money(n) {
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100) / 100;
}

function formatUsd(n) {
  if (!Number.isFinite(n)) return "N/A";
  if (n === 0) return "No Price Found";
  return `$${n.toFixed(2)}`;
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function extractJsonObject(text) {
  // Best-effort: find the first {...} block.
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  return safeJsonParse(text.slice(start, end + 1));
}

function firstSentence(text) {
  const s = String(text || "").replace(/\s+/g, " ").trim();
  if (!s) return "";
  // Split on sentence-ending punctuation. Keep it simple and predictable.
  const m = s.match(/^(.+?[.!?])(\s|$)/);
  return (m ? m[1] : s).trim();
}

function clampToSentences(text, maxSentences) {
  const s = String(text || "").replace(/\s+/g, " ").trim();
  if (!s) return "";
  const parts = s.match(/[^.!?]+[.!?]?/g) || [s];
  return parts
    .map((p) => p.trim())
    .filter(Boolean)
    .slice(0, maxSentences)
    .join(" ")
    .trim();
}

function normalizeField(v, maxLen) {
  const s = String(v || "").replace(/\s+/g, " ").trim();
  if (!s) return "";
  const one = firstSentence(s);
  const out = one || s;
  return out.length > maxLen ? out.slice(0, maxLen) : out;
}

function normalizeImageBase64(imageBase64) {
  // Accept "data:image/jpeg;base64,..." or raw base64.
  const comma = imageBase64.indexOf(",");
  if (imageBase64.startsWith("data:") && comma !== -1) {
    return imageBase64.slice(comma + 1);
  }
  return imageBase64;
}

function normalizeHint(v, maxLen) {
  const s = String(v || "").replace(/\s+/g, " ").trim();
  if (!s) return "";
  return s.length > maxLen ? s.slice(0, maxLen) : s;
}

function includesLoose(haystack, needle) {
  const h = String(haystack || "").toLowerCase();
  const n = String(needle || "").toLowerCase().trim();
  if (!h || !n) return false;
  return h.includes(n);
}

function enforceHintConsistency({ object, brand, itemModel, sku }) {
  const hasAny = Boolean(brand || itemModel || sku);
  if (!hasAny) return { object, adjusted: false };

  const matches =
    includesLoose(object, brand) || includesLoose(object, itemModel) || includesLoose(object, sku);

  if (matches) return { object, adjusted: false };

  const parts = [];
  if (brand) parts.push(brand);
  if (itemModel) parts.push(itemModel);
  const base = parts.join(" ").trim() || brand || itemModel || sku;
  const withSku = sku ? `${base} (SKU ${sku})` : base;
  return { object: firstSentence(withSku) || withSku, adjusted: true };
}

function clampUsdMax(v, max) {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.min(n, max);
}

async function ollamaChat({ model, baseUrl, messages }) {
  const url = `${baseUrl.replace(/\/+$/, "")}/api/chat`;
  const timeoutMs = Number(process.env.OLLAMA_TIMEOUT_MS ?? 25_000);
  const { signal, cancel } = withTimeout(Number.isFinite(timeoutMs) ? timeoutMs : 25_000);
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages,
        stream: false
      }),
      signal
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(`Ollama error ${resp.status}: ${text || resp.statusText}`);
    }
    return await resp.json();
  } finally {
    cancel();
  }
}

async function ollamaTags({ baseUrl }) {
  const url = `${baseUrl.replace(/\/+$/, "")}/api/tags`;
  const timeoutMs = Number(process.env.OLLAMA_TAGS_TIMEOUT_MS ?? 5_000);
  const { signal, cancel } = withTimeout(Number.isFinite(timeoutMs) ? timeoutMs : 5_000);
  try {
    const resp = await fetch(url, { method: "GET", signal });
    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(`Ollama tags error ${resp.status}: ${text || resp.statusText}`);
    }
    return await resp.json();
  } finally {
    cancel();
  }
}

function computeTiers({ usedPriceUsd, newPriceUsd, tierPcts } = {}) {
  const used = money(usedPriceUsd);
  const soldNew = money(newPriceUsd);

  const p = tierPcts || {};
  const roughPct = Number.isFinite(Number(p.roughPct)) ? Number(p.roughPct) : 50;
  const goodPct = Number.isFinite(Number(p.goodPct)) ? Number(p.goodPct) : 75;
  const bestPct = Number.isFinite(Number(p.bestPct)) ? Number(p.bestPct) : 100;
  const newPct = Number.isFinite(Number(p.newPct)) ? Number(p.newPct) : 100;

  const rough = Number.isFinite(used) ? money(used * (roughPct / 100)) : null;
  const good = Number.isFinite(used) ? money(used * (goodPct / 100)) : null;
  const best = Number.isFinite(used) ? money(used * (bestPct / 100)) : null;
  const n = Number.isFinite(soldNew) ? soldNew * (newPct / 100) : NaN;
  const soldNewAdj = Number.isFinite(n) ? money(n) : null;

  return {
    rough,
    good,
    best,
    new: soldNewAdj
  };
}

async function ollamaProbe() {
  const baseUrl = getEnv("OLLAMA_BASE_URL", "http://host.docker.internal:11434");
  const model = getEnv("OLLAMA_MODEL", "ministral-3:8b");
  const tags = await ollamaTags({ baseUrl });
  const models = Array.isArray(tags?.models) ? tags.models : [];
  const available = models.map((m) => m?.name).filter(Boolean);
  return { baseUrl, model, available_models: available };
}

async function priceFromImage({ imageBase64, hints }) {
  const baseUrl = getEnv("OLLAMA_BASE_URL", "http://host.docker.internal:11434");
  const model = getEnv("OLLAMA_MODEL", "ministral-3:8b");

  const { getRules } = require("./db");
  const rules = getRules();
  const maxPriceWithoutHints = Number.isFinite(Number(rules?.max_price_without_hints))
    ? Number(rules.max_price_without_hints)
    : 20;
  const tierPcts = {
    roughPct: rules?.tier_rough_pct,
    goodPct: rules?.tier_good_pct,
    bestPct: rules?.tier_best_pct,
    newPct: rules?.tier_new_pct
  };
  const promptExtraRules = typeof rules?.prompt_extra_rules === "string" ? rules.prompt_extra_rules.trim() : "";
  const extraRulesBlock = promptExtraRules ? `\n\nAdmin rules:\n${promptExtraRules}` : "";

  const image = normalizeImageBase64(imageBase64);
  if (!image || image.length < 128) {
    throw new Error("Invalid image data (empty/too small)");
  }

  // Backwards-compatible: accept `make` as an alias for brand.
  const brand = normalizeHint(hints?.brand || hints?.make, 80);
  const itemModel = normalizeHint(hints?.itemModel, 120);
  const sku = normalizeHint(hints?.sku, 120);
  const hasHints = Boolean(brand || itemModel || sku);
  const hintsBlock = hasHints
    ? [
        "",
        "User-provided hints (may be wrong; use image as truth):",
        ...(brand ? [`- brand: ${brand}`] : []),
        ...(itemModel ? [`- model: ${itemModel}`] : []),
        ...(sku ? [`- sku: ${sku}`] : [])
      ].join("\n")
    : "";

  const prompt = [
    "You are a pricing assistant.",
    "Given the image, identify the object as specifically as possible (brand/model if visible).",
    "You MUST make a best-guess; do NOT answer 'unknown' or 'can't tell'.",
    "The object description must be ONE sentence max.",
    "Also extract brand and model as separate fields. If unknown, return an empty string for that field (do not invent).",
    "Then estimate typical used online SOLD prices in USD for:",
    "- used_price_usd: working used item in average condition",
    "- new_price_usd: sold as new/sealed (or closest equivalent)",
    "If uncertain, make a best-guess and explain briefly.",
    hintsBlock,
    "",
    "Hint consistency rule:",
    "- If the user provided brand/model/sku hints, your object field MUST remain consistent with them (do not identify a completely different item).",
    "- If the image contradicts the hints, still include the hinted brand/model/sku in the object field and note the mismatch briefly in suggestions.",
    "",
    "Pricing safety rule:",
    `- You may ONLY return prices above ${maxPriceWithoutHints} USD if (a) the user provided brand/model/sku hints OR (b) you can clearly see identifying text/labels/model number in the image.`,
    `- Otherwise, keep used_price_usd and new_price_usd at or below ${maxPriceWithoutHints}.`,
    "",
    "Also include brief suggestions to better identify the item (angles, labels, model numbers to look for).",
    "Keep suggestions very short: each suggestion should be at most TWO sentences.",
    "",
    "Return ONLY valid JSON with this schema:",
    "{",
    '  "object": "string",',
    '  "brand": "string",',
    '  "model": "string",',
    '  "used_price_usd": number,',
    '  "new_price_usd": number,',
    '  "confidence": "low|medium|high",',
    '  "identifiers_seen": boolean,',
    '  "suggestions": ["string", "..."]',
    "}"
  ].join("\n") + extraRulesBlock;

  const data = await ollamaChat({
    model,
    baseUrl,
    messages: [
      {
        role: "user",
        content: prompt,
        images: [image]
      }
    ]
  });

  const text = data?.message?.content || "";
  const parsed = safeJsonParse(text) || extractJsonObject(text);

  const objectRaw = typeof parsed?.object === "string" ? parsed.object : "";
  const objectFromModel = firstSentence(objectRaw) || firstSentence(text) || "Likely a consumer item";
  const { object, adjusted: objectAdjusted } = enforceHintConsistency({
    object: objectFromModel,
    brand,
    itemModel,
    sku
  });

  // Model-provided brand/model (kept separate from user hints for price memory keying).
  const brandFromModel = typeof parsed?.brand === "string" ? normalizeField(parsed.brand, 80) : "";
  const modelFromModel = typeof parsed?.model === "string" ? normalizeField(parsed.model, 120) : "";

  const used = Number(parsed?.used_price_usd);
  const soldNew = Number(parsed?.new_price_usd);
  const confidence =
    parsed?.confidence === "low" || parsed?.confidence === "medium" || parsed?.confidence === "high"
      ? parsed.confidence
      : "low";
  const identifiersSeen = Boolean(parsed?.identifiers_seen);
  const suggestions = Array.isArray(parsed?.suggestions)
    ? parsed.suggestions
        .filter((s) => typeof s === "string")
        .map((s) => clampToSentences(s, 2))
        .filter(Boolean)
        .slice(0, 6)
    : [];

  const usedFromFinal = used;
  const newFromFinal = soldNew;

  const hintNote = objectAdjusted
    ? "Output object was aligned to your Brand/Model/SKU hints; double-check the photo matches those hints."
    : "";

  // Enforce: only allow above the cap if hints OR identifiers are clearly visible.
  const allowAboveCap = hasHints || identifiersSeen;
  const usedEnforced = allowAboveCap
    ? Number.isFinite(usedFromFinal)
      ? usedFromFinal
      : null
    : clampUsdMax(usedFromFinal, maxPriceWithoutHints);
  const newEnforced = allowAboveCap
    ? Number.isFinite(newFromFinal)
      ? newFromFinal
      : null
    : clampUsdMax(newFromFinal, maxPriceWithoutHints);
  const priceCapped =
    !allowAboveCap &&
    ((Number.isFinite(usedFromFinal) && usedFromFinal > maxPriceWithoutHints) ||
      (Number.isFinite(newFromFinal) && newFromFinal > maxPriceWithoutHints));

  const tiers = computeTiers({
    usedPriceUsd: Number.isFinite(usedEnforced) ? usedEnforced : NaN,
    newPriceUsd: Number.isFinite(newEnforced) ? newEnforced : NaN,
    tierPcts
  });

  const capNote = priceCapped
    ? `Prices are capped at $${maxPriceWithoutHints} until brand/model/SKU is provided or a clear model/label is visible.`
    : "";
  const suggestionsWithNotes = [hintNote, capNote, ...suggestions].filter(Boolean);

  const suggestionsText = clampToSentences(suggestionsWithNotes.slice(0, 3).join(" "), 2);
  const formatted = [
    `Object: ${object}`,
    "",
    `Rough: ${formatUsd(tiers.rough)}`,
    `Good:  ${formatUsd(tiers.good)}`,
    `Best:  ${formatUsd(tiers.best)}`,
    `New:   ${formatUsd(tiers.new)}`,
    "",
    `Suggestions: ${suggestionsText || "Try showing brand/model text, labels, and serial/model numbers."}`
  ].join("\n");

  return {
    object,
    brand: brandFromModel,
    model: modelFromModel,
    confidence,
    identifiers_seen: identifiersSeen,
    hint_consistency_enforced: objectAdjusted,
    price_cap_active: priceCapped,
    price_sources: { type: "local", sources: [] },
    used_price_usd: usedEnforced,
    new_price_usd: newEnforced,
    tiers: {
      rough: tiers.rough,
      good: tiers.good,
      best: tiers.best,
      new: tiers.new
    },
    suggestions: suggestionsWithNotes,
    formatted
  };
}

module.exports = { priceFromImage, ollamaProbe };

