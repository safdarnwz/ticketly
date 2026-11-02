/* Sales Action Center – front end (vanilla JS + Chart.js).
   The token is sent once to this server for the fetch and cleared from the page; it is never stored. */
(() => {
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
  let mode = "api", charts = [], pollTimer = null, D = null, JOB = null;

  // ---------------- formatting
  const inr = (v) => v == null || isNaN(v) ? "–" : (v < 0 ? "-₹" : "₹") + Math.abs(Math.round(v)).toLocaleString("en-IN");
  const lakh = (v) => { if (v == null || isNaN(v)) return "–"; const a = Math.abs(v), s = v < 0 ? "-" : "";
    return a >= 1e7 ? `${s}₹${(a / 1e7).toFixed(2)} Cr` : a >= 1e5 ? `${s}₹${(a / 1e5).toFixed(2)} L` : a >= 1e3 ? `${s}₹${(a / 1e3).toFixed(1)}k` : `${s}₹${Math.round(a)}`; };
  const num = (v, d = 0) => v == null || isNaN(v) ? "–" : Number(v).toLocaleString("en-IN", { maximumFractionDigits: d, minimumFractionDigits: d });
  const pct = (v) => v == null || isNaN(v) ? "–" : (v * 100).toFixed(1) + "%";
  const sgn = (v) => v == null || isNaN(v) ? "–" : (v > 0 ? "+" : "") + (v * 100).toFixed(1) + "%";
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const day = (d) => d ? new Date(d + "T00:00:00").toLocaleDateString("en-GB", { day: "2-digit", month: "short" }) : "–";
  const sum = (a, k) => a.reduce((s, r) => s + (Number(r[k]) || 0), 0);
  function toast(t) { const el = $("#toast"); el.textContent = t; el.classList.remove("hidden"); setTimeout(() => el.classList.add("hidden"), 2200); }

  // ---------------- views
  function show(view) {
    ["run", "history", "dash"].forEach((v) => $("#view-" + v).classList.toggle("hidden", v !== view));
    if (view === "history") loadHistory();
  }
  $$(".topbar .link").forEach((b) => b.onclick = () => show(b.dataset.view));

  // ---------------- form
  $$(".form-card .tab").forEach((t) => t.onclick = () => {
    mode = t.dataset.mode;
    $$(".form-card .tab").forEach((x) => x.classList.toggle("active", x === t));
    $$(".mode-api").forEach((e) => e.classList.toggle("hidden", mode !== "api"));
    $(".mode-upload").classList.toggle("hidden", mode !== "upload");
  });
  $("#toggle-token").onclick = () => { const t = $("#token"); t.classList.toggle("show"); $("#toggle-token").textContent = t.classList.contains("show") ? "Hide" : "Show"; };
  $("#token").addEventListener("input", () => {
    const raw = $("#token").value.trim().replace(/^Bearer\s+/i, ""), info = $("#token-info");
    try {
      const p = JSON.parse(atob(raw.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
      const exp = new Date(p.exp * 1000), left = (exp - new Date()) / 36e5;
      info.innerHTML = left > 0 ? `Token valid till <b>${exp.toLocaleString()}</b> (${left.toFixed(1)} h left)`
        : `<span class="pill red">Expired</span> ${exp.toLocaleString()} – log in to SalesDiary again and copy a fresh token.`;
    } catch { info.textContent = raw ? "Could not read this token – paste the full value." : ""; }
  });
  function setRange(kind) {
    const t = new Date(); let s, e;
    if (kind === "mtd") { s = new Date(t.getFullYear(), t.getMonth(), 1); e = t; }
    if (kind === "yesterday") { s = new Date(t); s.setDate(t.getDate() - 1); e = s; }
    if (kind === "last7") { e = new Date(t); e.setDate(t.getDate() - 1); s = new Date(e); s.setDate(e.getDate() - 6); }
    if (kind === "lastmonth") { s = new Date(t.getFullYear(), t.getMonth() - 1, 1); e = new Date(t.getFullYear(), t.getMonth(), 0); }
    const f = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    $("#start").value = f(s); $("#end").value = f(e);
  }
  $$(".chip").forEach((c) => c.onclick = () => setRange(c.dataset.range));
  setRange("mtd");
  async function masterInfo() {
    const r = await fetch("/api/master").then((x) => x.json()).catch(() => ({}));
    $("#master-saved").textContent = r.saved ? `Saved master in use: ${r.name}` : "";
    $("#forget-master").classList.toggle("hidden", !r.saved);
  }
  $("#forget-master").onclick = async () => { await fetch("/api/master", { method: "DELETE" }); masterInfo(); };
  masterInfo();
  $("#run-form").onsubmit = async (ev) => {
    ev.preventDefault();
    $("#form-error").classList.add("hidden");
    const s = $("#start").value, e = $("#end").value;
    if (!s || !e) return fail("Pick start and end dates.");
    if (e < s) return fail("End date is before start date.");
    const fd = new FormData();
    fd.append("start_date", s); fd.append("end_date", e);
    if ($("#master").files[0]) fd.append("master", $("#master").files[0]);
    fd.append("save_master", $("#save-master").checked ? "true" : "false");
    let url = "/api/jobs";
    if (mode === "api") {
      const tok = $("#token").value.trim();
      if (tok.length < 20) return fail("Paste the SalesDiary token first.");
      fd.append("token", tok); fd.append("compare", $("#compare").checked ? "true" : "false");
    } else {
      const files = $("#json-files").files;
      if (!files.length) return fail("Choose at least one JSON file.");
      Array.from(files).forEach((f) => fd.append("files", f));
      Array.from($("#prev-files").files).forEach((f) => fd.append("prev_files", f));
      url = "/api/jobs/upload";
    }
    $("#go").disabled = true; $("#progress").classList.remove("hidden");
    try {
      const r = await fetch(url, { method: "POST", body: fd }); const j = await r.json();
      if (!r.ok) throw new Error(j.detail || "Request failed");
      $("#token").value = ""; $("#token-info").textContent = "";
      poll(j.job_id);
    } catch (x) { fail(x.message); }
  };
  function fail(msg) { const e = $("#form-error"); e.textContent = msg; e.classList.remove("hidden"); $("#go").disabled = false; $("#progress").classList.add("hidden"); }
  const STAGE = { queued: 3, fetch: 35, clean: 70, report: 90, done: 100 };
  function poll(id) {
    clearInterval(pollTimer);
    pollTimer = setInterval(async () => {
      const j = await fetch(`/api/jobs/${id}`).then((x) => x.json()).catch(() => null); if (!j) return;
      $("#progress-text").textContent = j.message || j.stage; $("#bar-fill").style.width = (STAGE[j.stage] || 10) + "%";
      if (j.stage === "done") { clearInterval(pollTimer); $("#go").disabled = false; $("#progress").classList.add("hidden"); openDash(id); }
      if (j.stage === "error") { clearInterval(pollTimer); fail(j.error || j.message); }
    }, 1200);
  }
  async function loadHistory() {
    const list = await fetch("/api/jobs").then((x) => x.json());
    $("#history-body").innerHTML = list.map((j) => `<tr><td>${esc(j.id)}</td><td>${esc(j.start)} → ${esc(j.end)}</td><td>${esc(j.source)}</td>
      <td class="num">${num(j.rows)}</td><td><span class="pill ${j.stage === "done" ? "green" : j.stage === "error" ? "red" : "amber"}">${esc(j.stage)}</span></td>
      <td>${j.stage === "done" ? `<button class="ghost tiny" data-open="${esc(j.id)}">Open</button> <a class="ghost tiny" href="/api/jobs/${esc(j.id)}/excel">Excel</a>` : esc(j.error || "")}</td></tr>`).join("");
    $$("[data-open]").forEach((b) => b.onclick = () => openDash(b.dataset.open));
  }

  // ---------------- dashboard
  async function openDash(id) {
    D = await fetch(`/api/jobs/${id}/dashboard`).then((x) => x.json()); JOB = id;
    show("dash"); location.hash = "job=" + id;
    const m = D.meta, t = D.totals;
    $("#dash-sub").textContent = `${m.start} → ${m.end} · data till ${day(t.last_day)}` + (D.has_prev ? ` · compared with LMTD ${m.lmtd_start} → ${m.lmtd_end}` : " · no LMTD comparison") + ` · generated ${m.generated}`;
    const warn = (m.warnings || []).join(" ");
    $("#dash-warn").textContent = warn; $("#dash-warn").classList.toggle("hidden", !warn);
    $("#dl-excel").href = `/api/jobs/${id}/excel`; $("#dl-csv").href = `/api/jobs/${id}/csv`;
    const ok = D.checks.every((c) => c.result === "OK"); const b = $("#checks-badge");
    b.className = "badge " + (ok ? "green" : "red"); b.textContent = ok ? "✔ Totals reconciled" : "⚠ Control checks need review";
    // filter options
    const channels = [...new Set(D.kae.map((r) => r.channel))].sort();
    $("#f-channel").innerHTML = `<option value="">All</option>` + channels.map((c) => `<option>${esc(c)}</option>`).join("");
    fillKae(); fillSup();
    ["#f-channel", "#f-kae", "#f-sup"].forEach((s) => $(s).onchange = () => { if (s === "#f-channel") { fillKae(); fillSup(); } if (s === "#f-kae") fillSup(); render(); });
    $("#f-reset").onclick = () => { $("#f-channel").value = ""; fillKae(); $("#f-kae").value = ""; fillSup(); $("#f-sup").value = ""; render(); };
    render();
  }
  function fillKae() {
    const ch = $("#f-channel").value, cur = $("#f-kae").value;
    const k = [...new Set(D.kae.filter((r) => !ch || r.channel === ch).map((r) => r.kae))].sort();
    $("#f-kae").innerHTML = `<option value="">All</option>` + k.map((x) => `<option ${x === cur ? "selected" : ""}>${esc(x)}</option>`).join("");
  }
  function fillSup() {
    const ch = $("#f-channel").value, k = $("#f-kae").value, cur = $("#f-sup").value;
    const s = [...new Set(D.supervisor.filter((r) => (!ch || r.channel === ch) && (!k || r.kae === k)).map((r) => r.supervisor))].sort();
    $("#f-sup").innerHTML = `<option value="">All</option>` + s.map((x) => `<option ${x === cur ? "selected" : ""}>${esc(x)}</option>`).join("");
  }
  const F = () => ({ ch: $("#f-channel").value, kae: $("#f-kae").value, sup: $("#f-sup").value });
  const filt = (rows, f) => (rows || []).filter((r) => (!f.ch || !("channel" in r) || r.channel === f.ch) && (!f.kae || !("kae" in r) || r.kae === f.kae) && (!f.sup || !("supervisor" in r) || r.supervisor === f.sup));

  function view(f) {
    const v = {};
    for (const k of ["kae", "supervisor", "promoters", "not_punched", "no_sale", "drops", "never_punched", "outlets", "outlet_drops", "sku_gaps", "suspicious"]) v[k] = filt(D[k], f);
    if (f.sup) v.kae = v.kae.filter((r) => v.supervisor.some((s) => s.kae === r.kae));
    v.active = v.promoters.filter((r) => r.active_days > 0);
    v.sale = sum(v.promoters, "sale"); v.lmtd = D.has_prev ? sum(v.promoters, "lmtd") : null;
    return v;
  }

  function render() {
    const f = F(), v = view(f), t = D.totals, filtered = f.ch || f.kae || f.sup;
    $("#f-note").textContent = filtered ? `Showing ${[f.ch, f.kae, f.sup].filter(Boolean).join(" › ")}` : "";
    const punched = v.active.filter((r) => r.sale_last_day > 0).length;
    const dropRs = sum(v.drops, D.has_prev ? "change" : "change7");
    const gapRs = sum(v.sku_gaps, "opportunity");
    const g = v.lmtd ? v.sale / v.lmtd - 1 : null;
    const target = sum(v.kae, "target"), exp = D.runrate.expected_pct;
    const tiles = [
      ["Sale", lakh(v.sale), D.has_prev ? `<span class="${g < 0 ? "neg" : "pos"}">${sgn(g)}</span> vs LMTD ${lakh(v.lmtd)}` : `${num(sum(v.kae, "outlets"))} outlets`, g < -0.05 ? "red" : g < 0 ? "amber" : "green", "scorecard"],
      [`Punched on ${day(t.last_day)}`, `${punched} / ${v.active.length}`, `${pct(v.active.length ? punched / v.active.length : null)} of active promoters`, punched / Math.max(v.active.length, 1) < 0.85 ? "red" : "green", "notpunched"],
      ["Not punched", num(v.not_punched.length), `≈${lakh(v.not_punched.reduce((s, r) => s + r.sale / Math.max(r.active_days, 1), 0))} daily sale missing`, v.not_punched.length ? "red" : "green", "notpunched"],
      [`No sale 3+ days`, num(v.no_sale.length), v.never_punched.length ? `+ ${v.never_punched.length} never punched (roster)` : "check attendance / stock", v.no_sale.length ? "red" : "green", "nosale"],
      ["Declining promoters", num(v.drops.length), `${lakh(dropRs)} ${D.has_prev ? "vs LMTD" : "last 7 vs prev 7 days"}`, v.drops.length ? "amber" : "green", "decline"],
      ["SKU gap opportunity", lakh(gapRs), `${num(v.sku_gaps.length)} outlets missing focus SKUs`, gapRs ? "amber" : "green", "gaps"],
      ["Entries to verify", num(v.suspicious.length), "spikes, duplicates, below MRP", v.suspicious.length ? "amber" : "green", "verify"],
    ];
    if (target) tiles.splice(1, 0, ["Target achievement", pct(v.sale / target), exp ? `expected ${pct(exp)} · target ${lakh(target)}` : `target ${lakh(target)}`, exp && v.sale / target < exp * 0.8 ? "red" : exp && v.sale / target < exp ? "amber" : "green", "scorecard"]);
    $("#kpis").innerHTML = tiles.map(([l, val, sub, lvl, tab]) => `<div class="kpi ${lvl}" data-go="${tab}"><div class="l">${l}</div><div class="v">${val}</div><div class="s">${sub}</div></div>`).join("");
    $$(".kpi[data-go]").forEach((k) => k.onclick = () => switchTab(k.dataset.go));

    const tabs = [["actions", "Action Center"], ["notpunched", `Not punched (${v.not_punched.length})`], ["nosale", `No sale 3+ days (${v.no_sale.length})`],
      ...(D.never_punched && D.never_punched.length ? [["never", `Never punched (${v.never_punched.length})`]] : []),
      ["decline", `Decline (${v.drops.length + v.outlet_drops.length})`], ["gaps", `SKU gaps (${v.sku_gaps.length})`], ["verify", `Verify (${v.suspicious.length})`],
      ["scorecard", "Scorecards"], ["brand", "Brand mix"], ["trend", "Trend"], ["checks", "Data checks"]];
    const active = ($("#dash-tabs .tab.active") || {}).dataset?.tab || "actions";
    $("#dash-tabs").innerHTML = tabs.map(([k, l]) => `<button class="tab ${k === active ? "active" : ""}" data-tab="${k}">${l}</button>`).join("");
    $("#panes").innerHTML = tabs.map(([k]) => `<div class="tabpane ${k === active ? "" : "hidden"}" id="pane-${k}"></div>`).join("");
    $$("#dash-tabs .tab").forEach((b) => b.onclick = () => switchTab(b.dataset.tab));

    // Action Center
    const acts = filtered ? clientActions(v, f) : D.actions;
    $("#pane-actions").innerHTML = `<div class="card"><h3>What to do today${filtered ? " – " + esc([f.kae, f.sup].filter(Boolean).join(" › ") || f.ch) : ""}</h3>
      <div class="acts">${acts.length ? acts.map((a) => `<div class="act ${a.level}" data-go="${a.tab}"><div class="area">${esc(a.area)}</div><div class="txt">${esc(a.text)}</div></div>`).join("") : "<p>No open actions – all good.</p>"}</div></div>
      <div class="charts"><div class="card chart-card"><h3>${D.has_prev ? "Change vs LMTD by KAE" : "Sale by KAE"}</h3><canvas id="c-kae"></canvas></div>
      <div class="card chart-card"><h3>${D.has_prev ? "Cumulative sale vs LMTD" : "Daily sale"}</h3><canvas id="c-cum"></canvas></div></div>
      <div id="t-kae-mini"></div>`;
    $$("#pane-actions .act").forEach((a) => a.onclick = () => switchTab(mapTab(a.dataset.go)));
    table("#t-kae-mini", v.kae, C.score("kae", "KAE / ASM"), "KAE scorecard", { rag: true });

    const P = C.prom;
    table("#pane-notpunched", v.not_punched.slice().sort((a, b) => b.sale - a.sale), P, `Did not punch on ${day(t.last_day)} – call their supervisors`, { copy: true });
    table("#pane-nosale", v.no_sale, P, `No sale for 3 or more days`, { copy: true });
    if ($("#pane-never")) table("#pane-never", v.never_punched, C.never, "Active in roster but no sale punched this period", { copy: true });
    $("#pane-decline").innerHTML = "<div id='t-pd'></div><div id='t-od'></div>";
    table("#t-pd", v.drops, D.has_prev ? C.drop : C.drop7, `Promoters down 20%+ ${D.has_prev ? "vs LMTD" : "(last 7 vs previous 7 days)"} – worst first`, { copy: true });
    if (D.has_prev) table("#t-od", v.outlet_drops, C.odrop, "Outlets down 20%+ vs LMTD (incl. no sale this period)", { copy: true });
    $("#pane-gaps").innerHTML = "<div id='t-g'></div><div id='t-fs'></div>";
    table("#t-g", v.sku_gaps, C.gaps, "Outlets missing focus SKUs (biggest opportunity first)", { copy: true });
    table("#t-fs", D.focus_skus, C.focus, "Focus SKUs (sold in 40%+ of outlets of the channel)");
    table("#pane-verify", v.suspicious, C.sus, "Entries to verify before reporting", { copy: true });
    $("#pane-scorecard").innerHTML = "<div id='t-k'></div><div id='t-s'></div>";
    table("#t-k", v.kae, C.score("kae", "KAE / ASM"), "KAE scorecard", { rag: true });
    table("#t-s", v.supervisor, [["supervisor", "Supervisor"], ["kae", "KAE"], ...C.score("kae", "").slice(1)], "Supervisor scorecard", { rag: true });
    brandPane(f); trendPane();
    $("#pane-checks").innerHTML = "<div id='t-c'></div><div id='t-q'></div><div id='t-og'></div>";
    table("#t-c", D.checks, C.checks, "Control checks – every table ties back to the raw data", { search: false, totals: false });
    table("#t-q", D.quality, C.quality, "Data quality (a line can have several issues, rows are not added)", { totals: false });
    table("#t-og", D.order_gaps, C.ogaps, "Orders whose lines do not add up to the order total");
    drawCharts(v);
  }
  const mapTab = (t) => ({ actions: "notpunched", outlets: "gaps", checks: "verify" }[t] || t);
  function switchTab(name) {
    $$("#dash-tabs .tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === name));
    $$(".tabpane").forEach((p) => p.classList.toggle("hidden", p.id !== "pane-" + name));
    window.scrollTo({ top: $("#dash-tabs").offsetTop - 10, behavior: "smooth" });
  }

  // actions for a filtered view (same rules as the server)
  function names(rows, n, fmt) { const s = rows.slice(0, n).map(fmt).join(", "); return rows.length > n ? `${s} +${rows.length - n} more` : s; }
  function clientActions(v, f) {
    const out = [], t = D.totals;
    if (D.has_prev && v.lmtd) {
      const g = v.sale / v.lmtd - 1, key = f.kae ? "supervisor" : "kae", sc = (f.kae ? v.supervisor : v.kae).slice().sort((a, b) => a.change - b.change);
      const down = sc.filter((r) => r.change < 0).slice(0, 3);
      out.push({ level: g < -0.05 ? "red" : g < 0 ? "amber" : "green", area: "Sale vs LMTD", tab: "scorecard",
        text: `Sale ${lakh(v.sale)} vs LMTD ${lakh(v.lmtd)} (${sgn(g)}, ${lakh(v.sale - v.lmtd)}).` + (down.length ? ` Biggest fall: ${down.map((r) => `${r[key]} ${lakh(r.change)}`).join("; ")}.` : "") });
    }
    if (v.not_punched.length) out.push({ level: "red", area: "Punching", tab: "notpunched",
      text: `${v.not_punched.length} of ${v.active.length} promoters did not punch on ${day(t.last_day)}: ${names(v.not_punched.slice().sort((a, b) => b.sale - a.sale), 4, (r) => `${r.emp_name} (${r.main_outlet})`)} → call supervisor.` });
    if (v.no_sale.length) out.push({ level: "red", area: "Inactive promoters", tab: "nosale",
      text: `${v.no_sale.length} promoters with no sale for 3+ days: ${names(v.no_sale, 4, (r) => `${r.emp_name} (last ${day(r.last_sale)})`)} → check attendance / stock.` });
    if (v.never_punched.length) out.push({ level: "red", area: "Roster", tab: "never", text: `${v.never_punched.length} roster promoters have not punched any sale: ${names(v.never_punched, 4, (r) => r.emp_name)}.` });
    if (v.drops.length) { const k = D.has_prev ? "change" : "change7"; out.push({ level: "amber", area: "Promoter decline", tab: "decline",
      text: `${v.drops.length} promoters down 20%+ (${lakh(sum(v.drops, k))}): ${names(v.drops, 3, (r) => `${r.emp_name} ${lakh(r[k])}`)} → review with supervisor.` }); }
    if (v.outlet_drops.length) out.push({ level: "amber", area: "Outlet decline", tab: "decline",
      text: `${v.outlet_drops.length} outlets down 20%+ (${lakh(sum(v.outlet_drops, "change"))}): ${names(v.outlet_drops, 3, (r) => `${r.cust_name} ${lakh(r.change)}`)}.` });
    if (v.sku_gaps.length) out.push({ level: "amber", area: "SKU gaps", tab: "gaps",
      text: `${v.sku_gaps.length} outlets miss focus SKUs, ≈${lakh(sum(v.sku_gaps, "opportunity"))} opportunity. Biggest: ${names(v.sku_gaps, 3, (r) => `${r.cust_name} (${r.missing_count} SKUs, ${lakh(r.opportunity)})`)}.` });
    if (v.suspicious.length) out.push({ level: "amber", area: "Data check", tab: "verify", text: `${v.suspicious.length} entries to verify: ${names(v.suspicious, 3, (r) => `${r.type} – ${r.emp_name}`)}.` });
    return out;
  }

  // ---------------- charts
  function drawCharts(v) {
    charts.forEach((c) => c.destroy()); charts = []; if (!window.Chart) return;
    const teal = "#0f7b8a", navy = "#1f3864", red = "#c0392b", green = "#1e8449";
    const ks = v.kae.slice().sort((a, b) => (D.has_prev ? a.change - b.change : b.sale - a.sale));
    const kv = ks.map((r) => D.has_prev ? r.change : r.sale);
    charts.push(new Chart($("#c-kae"), { type: "bar", data: { labels: ks.map((r) => r.kae), datasets: [{ data: kv, backgroundColor: kv.map((x) => D.has_prev ? (x < 0 ? red : green) : teal) }] },
      options: { indexAxis: "y", maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => lakh(c.raw) } } }, scales: { x: { ticks: { callback: (x) => lakh(x) } } } } }));
    const dly = D.daily;
    const ds = D.has_prev ? [{ label: "This period (cumulative)", data: dly.map((r) => r.cum_sale), borderColor: teal, backgroundColor: teal, tension: .25 },
      { label: "LMTD (cumulative)", data: dly.map((r) => r.cum_lmtd), borderColor: "#999", borderDash: [6, 4], tension: .25 }]
      : [{ label: "Sale", data: dly.map((r) => r.sale), borderColor: teal, backgroundColor: teal }];
    charts.push(new Chart($("#c-cum"), { type: "line", data: { labels: dly.map((r) => day(r.date)), datasets: ds },
      options: { maintainAspectRatio: false, plugins: { tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${lakh(c.raw)}` } } }, scales: { y: { ticks: { callback: (x) => lakh(x) } } } } }));
    if ($("#c-brand")) {
      const b = D.brand.slice(0, 12);
      charts.push(new Chart($("#c-brand"), { type: "bar", data: { labels: b.map((r) => r.brand), datasets: [{ label: "This period", data: b.map((r) => r.sale), backgroundColor: teal },
        ...(D.has_prev ? [{ label: "LMTD", data: b.map((r) => r.lmtd), backgroundColor: "#c9d3e3" }] : [])] },
        options: { maintainAspectRatio: false, plugins: { tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${lakh(c.raw)}` } } }, scales: { y: { ticks: { callback: (x) => lakh(x) } } } } }));
    }
    if ($("#c-daily")) {
      charts.push(new Chart($("#c-daily"), { type: "bar", data: { labels: dly.map((r) => day(r.date)), datasets: [
        { type: "bar", label: "Sale", data: dly.map((r) => r.sale), backgroundColor: teal, yAxisID: "y" },
        ...(D.has_prev ? [{ type: "line", label: "LMTD same day", data: dly.map((r) => r.lmtd), borderColor: "#999", borderDash: [5, 4], yAxisID: "y" }] : []),
        { type: "line", label: "Promoters punching", data: dly.map((r) => r.promoters), borderColor: navy, yAxisID: "y1", tension: .3 }] },
        options: { maintainAspectRatio: false, scales: { y: { ticks: { callback: (x) => lakh(x) } }, y1: { position: "right", grid: { display: false } } } } }));
    }
  }
  function brandPane(f) {
    const idx = D.brand_index.filter((r) => !f.kae || r.kae === f.kae);
    const brands = Object.keys(D.brand_index[0] || {}).filter((k) => k !== "kae");
    const cell = (x) => x == null ? "<td></td>" : `<td class="num heat" style="background:${x < 0.6 ? "#f8cbad" : x < 0.9 ? "#fde9d9" : x > 1.3 ? "#c6efce" : "#fff"}">${x.toFixed(2)}</td>`;
    $("#pane-brand").innerHTML = `<div class="card chart-card wide"><h3>Brand sale ${D.has_prev ? "vs LMTD" : ""}</h3><canvas id="c-brand"></canvas></div>
      <div id="t-b"></div>
      <div class="card"><h3>Brand mix index by KAE <small>(KAE brand share ÷ company brand share · below 0.60 = under-selling)</small></h3>
      <div class="table-wrap"><table class="data"><thead><tr><th>KAE</th>${brands.map((b) => `<th>${esc(b)}</th>`).join("")}</tr></thead>
      <tbody>${idx.map((r) => `<tr><td>${esc(r.kae)}</td>${brands.map((b) => cell(r[b])).join("")}</tr>`).join("")}</tbody></table></div></div>`;
    table("#t-b", D.brand, C.brand, "Brands");
  }
  function trendPane() {
    $("#pane-trend").innerHTML = `<div class="card chart-card wide"><h3>Daily sale${D.has_prev ? " vs LMTD (same day number)" : ""} and promoters punching</h3><canvas id="c-daily"></canvas></div><div id="t-d"></div>`;
    table("#t-d", D.daily, C.daily, "Daily");
  }

  // ---------------- tables
  const R = (k, l, f) => [k, l, f];
  const C = {
    score: (k, l) => [R(k, l), R("channel", "Ch"), R("rag", "RAG", "pill"), R("sale", "Sale", "inr"), R("lmtd", "LMTD", "inr"), R("change", "Change", "inrs"),
      R("growth", "Growth", "sgn"), R("target", "Target", "inr"), R("ach_pct", "Ach %", "pct"), R("promoters", "Promoters", "num"), R("punched_last_day", "Punched last day", "num"),
      R("not_punched", "Not punched", "warn"), R("no_sale_3d", "No sale 3d+", "warn"), R("dropping_promoters", "Declining", "warn"), R("punch_discipline", "Punch %", "pct"),
      R("rs_per_promoter_day", "₹/promoter-day", "inr"), R("sku_gaps", "SKU gaps", "num"), R("gap_opportunity", "Gap ₹", "inr"), R("suspicious", "To verify", "warn")],
    prom: [R("emp_name", "Promoter"), R("emp_code", "Code"), R("main_outlet", "Outlet"), R("supervisor", "Supervisor"), R("kae", "KAE"), R("sale", "Sale", "inr"),
      R("lmtd", "LMTD", "inr"), R("growth", "Growth", "sgn"), R("active_days", "Active days", "num"), R("rs_per_active_day", "₹/day", "inr"), R("last_sale", "Last sale", "date"), R("days_since_last_sale", "Days since", "num")],
    never: [R("emp_name", "Promoter"), R("emp_code", "Code"), R("cust_code", "Store"), R("account", "Account"), R("supervisor", "Supervisor"), R("kae", "KAE"), R("status", "Status")],
    drop: [R("emp_name", "Promoter"), R("main_outlet", "Outlet"), R("supervisor", "Supervisor"), R("kae", "KAE"), R("sale", "Sale", "inr"), R("lmtd", "LMTD", "inr"),
      R("change", "Change", "inrs"), R("growth", "Growth", "sgn"), R("active_days", "Active days", "num"), R("status", "Status", "pill")],
    drop7: [R("emp_name", "Promoter"), R("main_outlet", "Outlet"), R("supervisor", "Supervisor"), R("kae", "KAE"), R("last7", "Last 7 days", "inr"), R("prev7", "Previous 7", "inr"), R("change7", "Change", "inrs")],
    odrop: [R("cust_name", "Outlet"), R("cust_code", "Code"), R("account", "Account"), R("promoter", "Promoter"), R("supervisor", "Supervisor"), R("kae", "KAE"),
      R("sale", "Sale", "inr"), R("lmtd", "LMTD", "inr"), R("change", "Change", "inrs"), R("growth", "Growth", "sgn")],
    gaps: [R("cust_name", "Outlet"), R("account", "Account"), R("promoter", "Promoter"), R("supervisor", "Supervisor"), R("kae", "KAE"), R("missing_count", "Missing", "num"),
      R("opportunity", "Opportunity", "inr"), R("missing_skus", "Missing focus SKUs", "wrap"), R("sale", "Current sale", "inr")],
    focus: [R("channel", "Ch"), R("prd_name", "SKU"), R("brand", "Brand"), R("outlets_selling", "Outlets selling", "num"), R("outlets_missing", "Outlets missing", "num"),
      R("penetration", "Penetration", "pct"), R("median_sale_per_outlet", "Typical ₹/outlet", "inr"), R("opportunity", "Opportunity", "inr")],
    sus: [R("type", "Check", "pill"), R("date", "Date", "date"), R("emp_name", "Promoter"), R("supervisor", "Supervisor"), R("kae", "KAE"), R("cust_name", "Outlet"), R("detail", "Detail", "wrap"), R("amount", "Amount", "inr")],
    brand: [R("brand", "Brand"), R("sale", "Sale", "inr"), R("lmtd", "LMTD", "inr"), R("change", "Change", "inrs"), R("growth", "Growth", "sgn"), R("share", "Share", "pct")],
    daily: [R("date", "Date", "date"), R("sale", "Sale", "inr"), R("lmtd", "LMTD same day", "inr"), R("promoters", "Promoters", "num"), R("outlets", "Outlets", "num")],
    checks: [R("check", "Check"), R("expected", "Expected", "num"), R("actual", "Actual", "num"), R("result", "Result", "pill")],
    quality: [R("issue", "Issue"), R("lines", "Lines", "num"), R("orders", "Orders", "num"), R("amount", "Amount", "inr")],
    ogaps: [R("order_ref", "Order"), R("order_date", "Date", "date"), R("emp_name", "Promoter"), R("cust_name", "Outlet"), R("lines_received", "Lines", "num"),
      R("lines_sum", "Lines ₹", "inr"), R("order_total", "Order ₹", "inr"), R("gap", "Gap", "inrs")],
  };
  const SUMMABLE = new Set(["sale", "lmtd", "change", "target", "opportunity", "gap_opportunity", "amount", "promoters", "punched_last_day", "not_punched",
    "no_sale_3d", "dropping_promoters", "sku_gaps", "suspicious", "missing_count", "last7", "prev7", "change7", "gap", "lines"]);
  function cell(v, f) {
    if (f === "inr") return inr(v); if (f === "inrs") return `<span class="${v < 0 ? "neg" : v > 0 ? "pos" : ""}">${inr(v)}</span>`;
    if (f === "num") return num(v); if (f === "pct") return pct(v); if (f === "sgn") return `<span class="${v < 0 ? "neg" : "pos"}">${sgn(v)}</span>`;
    if (f === "date") return day(v); if (f === "warn") return v ? `<span class="warnnum">${num(v)}</span>` : "–";
    if (f === "pill") return v ? `<span class="pill ${esc(String(v).split(" ")[0])}">${esc(v)}</span>` : "";
    if (f === "wrap") return `<span class="wrap">${esc(v)}</span>`;
    return esc(v);
  }
  function table(sel, rows, cols, title, o = {}) {
    const opt = Object.assign({ search: true, totals: true, copy: false, rag: false }, o);
    const host = $(sel); if (!host) return; rows = rows || [];
    cols = cols.filter(([k]) => rows.some((r) => r[k] != null && r[k] !== "") || ["sale"].includes(k));
    host.innerHTML = `<div class="card"><div class="table-tools"><h3>${esc(title)} <small>(${rows.length})</small></h3><div class="tt-right">
      ${opt.copy && rows.length ? `<button class="ghost tiny" data-copy>Copy for WhatsApp</button>` : ""}${rows.length ? `<button class="ghost tiny" data-csv>CSV</button>` : ""}
      ${opt.search && rows.length > 8 ? `<input type="search" placeholder="Search…">` : ""}</div></div>
      ${rows.length ? `<div class="table-wrap"><table class="data"><thead><tr>${cols.map((c, i) => `<th data-i="${i}">${esc(c[1])}</th>`).join("")}</tr></thead><tbody></tbody><tfoot></tfoot></table></div>` : `<p class="empty">Nothing here – good.</p>`}</div>`;
    if (!rows.length) return;
    let view = rows.slice(), sortI = -1, asc = false;
    const render = () => {
      host.querySelector("tbody").innerHTML = view.slice(0, 3000).map((r) => "<tr>" + cols.map(([k, , f]) => `<td class="${["inr", "inrs", "num", "pct", "sgn", "warn"].includes(f) ? "num" : ""}">${cell(r[k], f)}</td>`).join("") + "</tr>").join("");
      host.querySelector("tfoot").innerHTML = opt.totals ? "<tr>" + cols.map(([k, , f], i) => i === 0 ? "<td>Total</td>" : SUMMABLE.has(k) ? `<td class="num">${cell(sum(view, k), f === "warn" ? "num" : f)}</td>`
        : k === "growth" && cols.some((c) => c[0] === "lmtd") ? `<td class="num">${cell(sum(view, "lmtd") ? sum(view, "sale") / sum(view, "lmtd") - 1 : null, "sgn")}</td>` : "<td></td>").join("") + "</tr>" : "";
    };
    $$("th", host).forEach((th) => th.onclick = () => {
      const i = +th.dataset.i; asc = sortI === i ? !asc : false; sortI = i; const k = cols[i][0];
      view.sort((a, b) => { const x = a[k], y = b[k]; const r = (typeof x === "number" || typeof y === "number") ? (x ?? -Infinity) - (y ?? -Infinity) : String(x ?? "").localeCompare(String(y ?? "")); return asc ? r : -r; });
      render();
    });
    const inp = $("input[type=search]", host);
    if (inp) inp.oninput = () => { const q = inp.value.toLowerCase(); view = rows.filter((r) => cols.some(([k]) => String(r[k] ?? "").toLowerCase().includes(q))); render(); };
    const plain = (r, k, f) => f === "inr" || f === "inrs" ? inr(r[k]) : f === "pct" ? pct(r[k]) : f === "sgn" ? sgn(r[k]) : f === "date" ? day(r[k]) : (r[k] ?? "");
    const cp = $("[data-copy]", host);
    if (cp) cp.onclick = async () => {
      const lines = view.slice(0, 60).map((r, i) => `${i + 1}. ` + cols.slice(0, 6).map(([k, , f]) => plain(r, k, f)).filter((x) => x !== "" && x !== "–").join(" | "));
      const txt = `*${title}*\n${lines.join("\n")}${view.length > 60 ? `\n…and ${view.length - 60} more` : ""}`;
      try { await navigator.clipboard.writeText(txt); toast("Copied – paste in WhatsApp"); } catch { prompt("Copy this text:", txt); }
    };
    const cv = $("[data-csv]", host);
    if (cv) cv.onclick = () => {
      const q = (s) => `"${String(s ?? "").replace(/"/g, '""')}"`;
      const csv = [cols.map((c) => q(c[1])).join(","), ...view.map((r) => cols.map(([k]) => q(r[k])).join(","))].join("\n");
      const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv" })); a.download = title.replace(/[^\w]+/g, "_").slice(0, 60) + ".csv"; a.click();
    };
    render();
  }

  const m = location.hash.match(/job=([\w-]+)/); if (m) openDash(m[1]);
})();
