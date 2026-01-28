const video = document.getElementById("video");
const canvas = document.getElementById("canvas");
const snap = document.getElementById("snap");
const output = document.getElementById("output");
const statusEl = document.getElementById("status");
const capturePreview = document.getElementById("capturePreview");
const previewImg = document.getElementById("previewImg");
const brandEl = document.getElementById("brand");
const itemModelEl = document.getElementById("itemModel");
const skuEl = document.getElementById("sku");
const clearBtn = document.getElementById("clearBtn");
const bypassMemoryBtn = document.getElementById("bypassMemoryBtn");
const logoutBtn = document.getElementById("logout");

let lastResult = null;
let lastHints = { brand: "", itemModel: "", sku: "" };
let csrfToken = "";
let bypassMemoryOnce = false;

async function ensureCsrfToken() {
  if (csrfToken) return csrfToken;
  const r = await fetch("/api/csrf", { method: "GET" });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data?.error || `Failed to fetch CSRF token (${r.status})`);
  csrfToken = String(data?.csrfToken || "");
  if (!csrfToken) throw new Error("Missing CSRF token");
  return csrfToken;
}

async function ensureLoggedIn() {
  const r = await fetch("/api/auth/me");
  if (r.ok) return true;
  // If no admin yet, send to setup; otherwise login.
  try {
    const st = await fetch("/api/setup/status").then((x) => x.json().catch(() => ({})));
    if (!st?.admin_exists) location.href = "/setup";
    else location.href = "/login";
  } catch {
    location.href = "/login";
  }
  return false;
}

function isEditableOrInteractiveTarget(el) {
  if (!el || !(el instanceof Element)) return false;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || tag === "BUTTON") return true;
  if (el.isContentEditable) return true;
  return false;
}

function setStatus(text) {
  statusEl.textContent = text;
  const t = String(text || "").toLowerCase();
  let state = "ready";
  if (t.includes("asking") || t.includes("captur") || t.includes("request") || t.includes("working")) state = "loading";
  if (t === "done") state = "done";
  if (t.includes("error") || t.includes("blocked") || t.includes("unsupported")) state = "error";
  statusEl.dataset.state = state;
}

function clearOutput() {
  output.innerHTML = `<div class="outputEmpty">Take a picture to get a price.<span class="outputHint">Tip: Add Brand/Model/SKU hints if the item is hard to identify.</span></div>`;
  setStatus("Ready");
  lastResult = null;
}

clearBtn?.addEventListener("click", () => {
  clearOutput();
});

bypassMemoryBtn?.addEventListener("click", () => {
  bypassMemoryOnce = true;
  setStatus("Bypass memory enabled (next scan)");
});

// Spacebar shortcut to take a picture (except when typing in inputs).
window.addEventListener("keydown", (e) => {
  if (e.code !== "Space" || e.repeat) return;
  if (isEditableOrInteractiveTarget(e.target)) return;
  if (snap?.disabled) return;
  e.preventDefault(); // prevent page scroll
  snap.click();
});

// QoL: double-click/tap the live camera to take a picture.
function bindDoubleClickCapture(el) {
  if (!el) return;
  el.addEventListener("dblclick", (e) => {
    if (snap?.disabled) return;
    e.preventDefault();
    snap.click();
  });
}
bindDoubleClickCapture(video);
bindDoubleClickCapture(document.querySelector(".videoFrame"));

function setBusy(isBusy) {
  snap.disabled = isBusy;
  if (clearBtn) clearBtn.disabled = isBusy;
}

async function initCamera() {
  setStatus("Requesting camera...");
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: "environment" },
    audio: false
  });
  video.srcObject = stream;
  await new Promise((resolve) => {
    video.onloadedmetadata = () => resolve();
  });
  setStatus("Ready");
}

function captureJpegDataUrl() {
  const w = video.videoWidth || 1280;
  const h = video.videoHeight || 720;

  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(video, 0, 0, w, h);

  // 0.85 is a good tradeoff for size/quality.
  return canvas.toDataURL("image/jpeg", 0.85);
}

async function sendToServer({ imageBase64, brand, itemModel, sku, bypassPriceMemory }) {
  const token = await ensureCsrfToken();
  const resp = await fetch("/api/price", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-CSRF-Token": token },
    body: JSON.stringify({
      imageBase64,
      brand,
      itemModel,
      sku,
      bypassPriceMemory: Boolean(bypassPriceMemory)
    })
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    const msg = data?.error || `Request failed (${resp.status})`;
    throw new Error(msg);
  }
  return data;
}

function fmtUsd(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return "N/A";
  if (n === 0) return "No Price Found";
  return `$${n.toFixed(2)}`;
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

function safeExternalUrl(url) {
  // Prevent clickable javascript:/data: URLs coming from search results.
  const u = String(url || "").trim();
  if (!u) return "";
  try {
    const parsed = new URL(u, location.origin);
    const proto = String(parsed.protocol || "").toLowerCase();
    if (proto === "http:" || proto === "https:") return parsed.toString();
    return "";
  } catch {
    return "";
  }
}

function getTierLabel(tierKey) {
  const k = String(tierKey || "").toLowerCase();
  if (k === "rough") return "Rough";
  if (k === "good") return "Good";
  if (k === "best") return "Best";
  if (k === "new") return "New";
  return "Price";
}

function openPrintLabelWindow({ object, tierKey, priceText, hints }) {
  const labelTier = getTierLabel(tierKey);
  const params = new URLSearchParams();
  params.set("object", String(object || "Item"));
  params.set("tier", String(labelTier));
  params.set("price", String(priceText || "N/A"));
  params.set("brand", String(hints?.brand || "").trim());
  params.set("model", String(hints?.itemModel || "").trim());
  params.set("sku", String(hints?.sku || "").trim());
  params.set("ts", String(Date.now()));

  const url = `/print.html?${params.toString()}`;
  const w = window.open(url, "_blank", "popup,width=520,height=420");
  if (!w) {
    alert("Popup blocked. Allow popups for this site to print labels.");
    return;
  }
}

function renderResult(result) {
  const object = String(result?.object || "").trim() || "Item";
  const brand = String(result?.brand || "").trim();
  const model = String(result?.model || "").trim();
  const topLabel = [brand, model].filter(Boolean).join(" ").trim() || object;
  const confidenceRaw = String(result?.confidence || "").toLowerCase();
  const confidence =
    confidenceRaw === "high" || confidenceRaw === "medium" || confidenceRaw === "low" ? confidenceRaw : "low";
  const tiers = result?.tiers || {};
  const suggestions = Array.isArray(result?.suggestions) ? result.suggestions.filter(Boolean) : [];
  const suggestionText = clampToSentences(
    suggestions.length ? suggestions.join(" ") : "Show brand/model text, labels, and serial/model numbers.",
    2
  );

  const confClass = confidence === "high" ? "confHigh" : confidence === "medium" ? "confMedium" : "confLow";
  const confLabel = confidence === "high" ? "High confidence" : confidence === "medium" ? "Medium confidence" : "Unknown";

  output.innerHTML = `
    <div class="outputCard">
      <div class="outputTitle">Brand / Model</div>
      <div class="objectRow">
        <div class="outputObject">${escapeHtml(topLabel)}</div>
        <div class="confBadge ${confClass}">${escapeHtml(confLabel)}</div>
      </div>

      <div class="priceGrid">
        <div class="priceCell priceCellPrintable" role="button" tabindex="0" data-tier="rough" title="Click to print a price label" aria-label="Print price label: Rough">
          <div class="priceLabel">Rough</div>
          <div class="priceValue">${escapeHtml(fmtUsd(tiers.rough))}</div>
        </div>
        <div class="priceCell priceCellPrintable" role="button" tabindex="0" data-tier="good" title="Click to print a price label" aria-label="Print price label: Good">
          <div class="priceLabel">Good</div>
          <div class="priceValue">${escapeHtml(fmtUsd(tiers.good))}</div>
        </div>
        <div class="priceCell priceCellPrintable" role="button" tabindex="0" data-tier="best" title="Click to print a price label" aria-label="Print price label: Best">
          <div class="priceLabel">Best</div>
          <div class="priceValue">${escapeHtml(fmtUsd(tiers.best))}</div>
        </div>
        <div class="priceCell priceCellPrintable" role="button" tabindex="0" data-tier="new" title="Click to print a price label" aria-label="Print price label: New">
          <div class="priceLabel">New</div>
          <div class="priceValue">${escapeHtml(fmtUsd(tiers.new))}</div>
        </div>
      </div>

      <div class="suggestions">
        <div class="suggestionsTitle">Description</div>
        <div class="suggestionsText">${escapeHtml(object)}</div>
      </div>

      <div class="sources">
        <div class="suggestionsTitle">Suggestions</div>
        <div class="sourcesText">${escapeHtml(String(suggestionText))}</div>
      </div>
    </div>
  `;
}

function renderError(message) {
  output.innerHTML = `
    <div class="outputCard outputError">
      <div class="outputTitle">Error</div>
      <div class="suggestionsText">${escapeHtml(String(message || "Unknown error"))}</div>
    </div>
  `;
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttr(s) {
  // Minimal safe attribute escaping for href.
  return escapeHtml(String(s)).replaceAll("`", "&#096;");
}

function handlePriceCellPrint(cell) {
  if (!cell) return;
  if (!lastResult) return;
  const tierKey = cell.getAttribute("data-tier");
  const n = Number(lastResult?.tiers?.[tierKey]);
  const priceText = fmtUsd(n);
  openPrintLabelWindow({
    object: lastResult?.object || "Item",
    tierKey,
    priceText,
    hints: lastHints
  });
}

// Click/keyboard support for printing labels from prices.
output?.addEventListener("click", (e) => {
  const target = e.target;
  if (isEditableOrInteractiveTarget(target)) return;
  // Allow links in Sources to behave normally.
  if (target instanceof Element && target.closest("a")) return;
  const cell = target instanceof Element ? target.closest(".priceCellPrintable") : null;
  if (!cell) return;
  handlePriceCellPrint(cell);
});

output?.addEventListener("keydown", (e) => {
  if (e.key !== "Enter" && e.key !== " ") return;
  const target = e.target;
  const cell = target instanceof Element ? target.closest(".priceCellPrintable") : null;
  if (!cell) return;
  e.preventDefault();
  handlePriceCellPrint(cell);
});

snap.addEventListener("click", async () => {
  try {
    setBusy(true);
    setStatus("Capturing...");
    output.innerHTML = `<div class="outputEmpty">Working...<span class="outputHint">Sending image to Ollama.</span></div>`;

    const dataUrl = captureJpegDataUrl();
    if (previewImg && capturePreview) {
      previewImg.src = dataUrl;
      capturePreview.classList.remove("hidden");
    }

    const brand = brandEl?.value?.trim() || "";
    const itemModel = itemModelEl?.value?.trim() || "";
    const sku = skuEl?.value?.trim() || "";
    lastHints = { brand, itemModel, sku };

    const bypassPriceMemory = bypassMemoryOnce;
    bypassMemoryOnce = false; // one-shot

    setStatus("Asking Ollama...");
    const result = await sendToServer({ imageBase64: dataUrl, brand, itemModel, sku, bypassPriceMemory });

    lastResult = result;
    renderResult(result);
    setStatus("Done");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    renderError(message);
    setStatus("Error");
  } finally {
    setBusy(false);
  }
});

(async () => {
  const ok = await ensureLoggedIn();
  if (!ok) return;
  try {
    await ensureCsrfToken();
  } catch {
    // Ignore; will error when attempting the first POST.
  }
})();

(logoutBtn || null)?.addEventListener("click", async () => {
  try {
    const token = await ensureCsrfToken();
    await fetch("/api/auth/logout", { method: "POST", headers: { "X-CSRF-Token": token } }).catch(() => {});
  } catch {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
  } finally {
    location.href = "/login";
  }
});

(async () => {
  try {
    if (!navigator.mediaDevices?.getUserMedia) {
      renderError("This browser does not support getUserMedia().");
      setStatus("Unsupported");
      setBusy(true);
      return;
    }
    await initCamera();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    renderError(`Camera error: ${message}\n\nTip: Use HTTPS or http://localhost for camera permissions.`);
    setStatus("Camera blocked");
    setBusy(true);
  }
})();

