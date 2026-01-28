async function loadRules() {
  const msg = document.getElementById("rulesMsg");
  if (msg) msg.textContent = "";
  const data = await api("GET", "/api/admin/rules");
  const maxPrice = document.getElementById("maxPrice");
  const retentionDays = document.getElementById("priceMemoryRetentionDays");
  const extraRules = document.getElementById("extraRules");
  const tierRough = document.getElementById("tierRoughPct");
  const tierGood = document.getElementById("tierGoodPct");
  const tierBest = document.getElementById("tierBestPct");
  const tierNew = document.getElementById("tierNewPct");
  if (maxPrice) maxPrice.value = data?.rules?.max_price_without_hints ?? 20;
  if (retentionDays) retentionDays.value = data?.rules?.price_memory_retention_days ?? 7;
  if (extraRules) extraRules.value = data?.rules?.prompt_extra_rules ?? "";
  if (tierRough) tierRough.value = data?.rules?.tier_rough_pct ?? 50;
  if (tierGood) tierGood.value = data?.rules?.tier_good_pct ?? 75;
  if (tierBest) tierBest.value = data?.rules?.tier_best_pct ?? 100;
  if (tierNew) tierNew.value = data?.rules?.tier_new_pct ?? 100;
}

document.getElementById("saveRules")?.addEventListener("click", async () => {
  const msg = document.getElementById("rulesMsg");
  if (msg) msg.textContent = "Saving...";
  try {
    const maxPrice = document.getElementById("maxPrice")?.value;
    const priceMemoryRetentionDays = document.getElementById("priceMemoryRetentionDays")?.value;
    const extra = document.getElementById("extraRules")?.value;
    const tierRoughPct = document.getElementById("tierRoughPct")?.value;
    const tierGoodPct = document.getElementById("tierGoodPct")?.value;
    const tierBestPct = document.getElementById("tierBestPct")?.value;
    const tierNewPct = document.getElementById("tierNewPct")?.value;
    await api("PUT", "/api/admin/rules", {
      max_price_without_hints: maxPrice,
      price_memory_retention_days: priceMemoryRetentionDays,
      prompt_extra_rules: extra,
      tier_rough_pct: tierRoughPct,
      tier_good_pct: tierGoodPct,
      tier_best_pct: tierBestPct,
      tier_new_pct: tierNewPct
    });
    if (msg) msg.textContent = "Saved.";
    await loadRules();
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (msg) msg.textContent = `Error: ${message}`;
  }
});

(async () => {
  try {
    await ensureCsrfToken();
  } catch {
    // ignore; will error on first write request
  }
  await ensureAdmin();
  await loadRules();
})().catch(() => (location.href = "/login"));

