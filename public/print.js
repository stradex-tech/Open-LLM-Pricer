function $(id) {
  return document.getElementById(id);
}

function setText(id, value) {
  const el = $(id);
  if (!el) return;
  el.textContent = String(value || "");
}

function addMetaRow(container, key, value) {
  const v = String(value || "").trim();
  if (!v) return;

  const row = document.createElement("div");
  row.className = "printMetaRow";

  const kEl = document.createElement("span");
  kEl.className = "printK";
  kEl.textContent = key;

  const vEl = document.createElement("span");
  vEl.className = "printV";
  vEl.textContent = v;

  row.appendChild(kEl);
  row.appendChild(document.createTextNode(" "));
  row.appendChild(vEl);
  container.appendChild(row);
}

function fmtDate(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n)) return "";
  try {
    return new Date(n).toLocaleString();
  } catch {
    return String(new Date(n));
  }
}

function main() {
  const qs = new URLSearchParams(location.search);
  const object = qs.get("object") || "Item";
  const tier = qs.get("tier") || "Price";
  const price = qs.get("price") || "N/A";
  const brand = qs.get("brand") || "";
  const model = qs.get("model") || "";
  const sku = qs.get("sku") || "";
  const ts = qs.get("ts") || "";

  setText("obj", object);
  setText("tier", tier);
  setText("price", price);
  setText("ts", fmtDate(ts));

  const meta = $("meta");
  if (meta) {
    meta.textContent = "";
    addMetaRow(meta, "Brand", brand);
    addMetaRow(meta, "Model", model);
    addMetaRow(meta, "SKU", sku);
    if (!meta.childNodes.length) meta.classList.add("hidden");
  }

  // Trigger print from a user-initiated popup window.
  window.addEventListener("load", () => {
    setTimeout(() => {
      try {
        window.focus();
      } catch {}
      try {
        window.print();
      } catch (e) {
        const note = $("note");
        if (note) note.textContent = "Print dialog blocked by browser settings.";
      }
    }, 50);
  });

  window.addEventListener("afterprint", () => {
    try {
      window.close();
    } catch {}
  });
}

main();

