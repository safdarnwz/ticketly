/* SalesDiary Reports – front end (vanilla JS + Chart.js). The token never leaves this browser except in the one
   POST to this server, and the server never stores it. */
(() => {
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));
  let mode = "api", charts = [], pollTimer = null;

  // ---------- formatting
  const inr = (v) => v == null ? "–" : (v < 0 ? "-₹" : "₹") + Math.abs(Math.round(v)).toLocaleString("en-IN");
  const num = (v, d = 0) => v == null ? "–" : Number(v).toLocaleString("en-IN", { maximumFractionDigits: d, minimumFractionDigits: d });
  const pct = (v) => v == null ? "–" : (v * 100).toFixed(1) + "%";
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const iso = (d) => d.toISOString().slice(0, 10);

  // ---------- views
  function show(view) {
    ["run", "history", "dash"].forEach((v) => $("#view-" + v).classList.toggle("hidden", v !== view));
    if (view === "history") loadHistory();
  }
  $$(".topbar .link").forEach((b) => b.onclick = () => show(b.dataset.view));

  // ---------- form
  $$(".form-card .tab").forEach((t) => t.onclick = () => {
    mode = t.dataset.mode;
    $$(".form-card .tab").forEach((x) => x.classList.toggle("active", x === t));
    $(".mode-api").classList.toggle("hidden", mode !== "api");
    $(".mode-upload").classList.toggle("hidden", mode !== "upload");
  });
  $("#toggle-token").onclick = () => {
    const t = $("#token"); t.classList.toggle("show");
    $("#toggle-token").textContent = t.classList.contains("show") ? "Hide" : "Show";
  };
  // decode JWT expiry locally (no network) so the user knows before starting
  $("#token").addEventListener("input", () => {
    const raw = $("#token").value.trim().replace(/^Bearer\s+/i, "");
    const info = $("#token-info");
    try {
      const p = JSON.parse(atob(raw.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
      const exp = new Date(p.exp * 1000), left = (exp - new Date()) / 36e5;
      const who = p.data ? `${p.data.profile || ""} · instance ${p.data.instance || ""}` : "";
      info.innerHTML = left > 0
        ? `Token valid until <b>${exp.toLocaleString()}</b> (${left.toFixed(1)} h left) ${esc(who)}`
        : `<span class="pill bad">Expired</span> on ${exp.toLocaleString()} – log in to SalesDiary again and copy a new token.`;
    } catch { info.textContent = raw ? "Could not read token – make sure you pasted the whole value." : ""; }
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
    const err = $("#form-error"); err.classList.add("hidden");
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
      fd.append("token", tok);
    } else {
      const files = $("#json-files").files;
      if (!files.length) return fail("Choose at least one JSON file.");
      Array.from(files).forEach((f) => fd.append("files", f));
      url = "/api/jobs/upload";
    }
    $("#go").disabled = true; $("#progress").classList.remove("hidden");
    try {
      const r = await fetch(url, { method: "POST", body: fd });
      const j = await r.json();
      if (!r.ok) throw new Error(j.detail || "Request failed");
      $("#token").value = ""; $("#token-info").textContent = "";   // do not keep the token on screen
      poll(j.job_id);
    } catch (x) { fail(x.message); }
  };
  function fail(msg) {
    const err = $("#form-error"); err.textContent = msg; err.classList.remove("hidden");
    $("#go").disabled = false; $("#progress").classList.add("hidden");
  }
  const STAGE_PCT = { queued: 3, fetch: 30, clean: 70, report: 90, done: 100 };
  function poll(id) {
    clearInterval(pollTimer);
    pollTimer = setInterval(async () => {
      const j = await fetch(`/api/jobs/${id}`).then((x) => x.json()).catch(() => null);
      if (!j) return;
      $("#progress-text").textContent = j.message || j.stage;
      $("#bar-fill").style.width = (STAGE_PCT[j.stage] || 10) + "%";
      if (j.stage === "done") { clearInterval(pollTimer); $("#go").disabled = false; $("#progress").classList.add("hidden"); openDash(id); }
      if (j.stage === "error") { clearInterval(pollTimer); fail(j.error || j.message); }
    }, 1200);
  }

  // ---------- history
  async function loadHistory() {
    const list = await fetch("/api/jobs").then((x) => x.json());
    $("#history-body").innerHTML = list.map((j) => `<tr><td>${esc(j.id)}</td><td>${esc(j.start)} → ${esc(j.end)}</td><td>${esc(j.source)}</td>
      <td class="num">${num(j.rows)}</td><td><span class="pill ${j.stage === "done" ? "ok" : j.stage === "error" ? "bad" : "warn"}">${esc(j.stage)}</span></td>
      <td>${j.stage === "done" ? `<button class="ghost tiny" data-open="${esc(j.id)}">Open</button> <a class="ghost tiny" href="/api/jobs/${esc(j.id)}/excel">Excel</a>` : esc(j.error || "")}</td></tr>`).join("");
    $$("[data-open]").forEach((b) => b.onclick = () => openDash(b.dataset.open));
  }

  // ---------- dashboard
  async function openDash(id) {
    const d = await fetch(`/api/jobs/${id}/dashboard`).then((x) => x.json());
    show("dash");
    const m = d.meta, k = d.kpi;
    $("#dash-sub").textContent = `${m.start} → ${m.end} · generated ${m.generated} · ${num(m.rows)} source rows` + (m.master ? " · master applied" : "");
    $("#dl-excel").href = `/api/jobs/${id}/excel`; $("#dl-csv").href = `/api/jobs/${id}/csv`;
    const okAll = d.checks.every((c) => c.result === "OK");
    const badge = $("#checks-badge"); badge.className = "badge " + (okAll ? "ok" : "bad");
    badge.textContent = okAll ? "✔ Control checks: ALL OK" : "⚠ Control checks need review";
    const tiles = [["Sale", inr(k.sales)], ["Orders", num(k.orders)], ["Lines", num(k.lines)], ["Qty", num(k.qty)],
      ["Promoters", num(k.promoters)], ["Outlets", num(k.outlets)], ["SKUs", num(k.skus)], ["Avg order", inr(k.sales / Math.max(k.orders, 1))],
      ["Lines / order", num(k.lines / Math.max(k.orders, 1), 1)], ["Days with sale", num(k.days_with_sale)]];
    if (d.runrate.projected) tiles.push(["Projected month", inr(d.runrate.projected)]);
    $("#kpis").innerHTML = tiles.map(([l, v]) => `<div class="kpi"><div class="l">${l}</div><div class="v">${v}</div></div>`).join("");
    $("#insights").innerHTML = d.insights.map((t) => `<li>${esc(t)}</li>`).join("");
    drawCharts(d);
    const C = COLS;
    table("#pane-kae", d.kae, C.team("kae", "KAE / Team"), "KAE / Team summary");
    table("#pane-supervisor", d.supervisor, [["supervisor", "Supervisor"], ...C.team("kae", "KAE / Team").slice(1)], "Supervisor summary");
    table("#pane-promoter", d.promoter, C.promoter, "Promoters");
    table("#pane-outlet", d.outlet, C.outlet, "Outlets");
    $("#pane-sku").innerHTML = "<div id='t-brand'></div><div id='t-sku'></div><div id='t-acc'></div><div id='t-state'></div>";
    table("#t-brand", d.brand, C.brand, "Brands"); table("#t-sku", d.sku, C.sku, "SKUs");
    table("#t-acc", d.account, C.account, "Accounts"); table("#t-state", d.state, C.state, "States");
    const hasT = d.target_kae && d.target_kae.length;
    $("#tab-target").classList.toggle("hidden", !hasT);
    if (hasT) {
      $("#pane-target").innerHTML = "<div id='t-tk'></div><div id='t-ns'></div>";
      table("#t-tk", d.target_kae, C.target, "Target vs Achievement (by master KAE)");
      table("#t-ns", d.stores_no_sale, C.nosale, "Stores in master with no sale");
    }
    $("#pane-quality").innerHTML = "<div id='t-q'></div><div id='t-og'></div>";
    table("#t-q", d.quality, C.quality, "Data quality issues (a line can have several issues, so rows are not added up)", true, false);
    table("#t-og", d.order_gaps, C.gaps, "Orders whose lines do not add up to the order total");
    table("#pane-checks", d.checks, C.checks, "Control checks (every total tied back to the clean data)", false, false);
    switchTab("overview");
  }
  $$("#dash-tabs .tab").forEach((t) => t.onclick = () => switchTab(t.dataset.tab));
  function switchTab(name) {
    $$("#dash-tabs .tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === name));
    $$(".tabpane").forEach((p) => p.classList.toggle("hidden", p.id !== "pane-" + name));
  }

  function drawCharts(d) {
    charts.forEach((c) => c.destroy()); charts = [];
    if (!window.Chart) return;
    const teal = "#0f7b8a", navy = "#1f3864";
    const palette = ["#0f7b8a", "#1f3864", "#5b9bd5", "#ed7d31", "#a5a5a5", "#ffc000", "#70ad47", "#9e480e", "#264478", "#636363"];
    charts.push(new Chart($("#c-daily"), { type: "bar", data: { labels: d.daily.map((x) => x.order_date.slice(5)),
      datasets: [{ type: "bar", label: "Sale", data: d.daily.map((x) => x.sales), backgroundColor: teal, yAxisID: "y" },
                 { type: "line", label: "Active promoters", data: d.daily.map((x) => x.promoters), borderColor: navy, yAxisID: "y1", tension: .3 }] },
      options: { maintainAspectRatio: false, scales: { y: { ticks: { callback: (v) => "₹" + (v / 1000).toFixed(0) + "k" } }, y1: { position: "right", grid: { display: false } } } } }));
    const top = (arr, key, n) => arr.slice(0, n);
    const b = top(d.brand, "brand", 10);
    charts.push(new Chart($("#c-brand"), { type: "doughnut", data: { labels: b.map((x) => x.brand), datasets: [{ data: b.map((x) => x.sales), backgroundColor: palette }] },
      options: { maintainAspectRatio: false, plugins: { legend: { position: "right" } } } }));
    const accAgg = {}; d.account.forEach((x) => accAgg[x.account] = (accAgg[x.account] || 0) + x.sales);
    const acc = Object.entries(accAgg).sort((a, b) => b[1] - a[1]).slice(0, 10);
    charts.push(new Chart($("#c-account"), { type: "bar", data: { labels: acc.map((x) => x[0]), datasets: [{ data: acc.map((x) => x[1]), backgroundColor: navy }] },
      options: { indexAxis: "y", maintainAspectRatio: false, plugins: { legend: { display: false } } } }));
    const ka = d.kae.slice(0, 15);
    charts.push(new Chart($("#c-kae"), { type: "bar", data: { labels: ka.map((x) => x.kae), datasets: [{ label: "Sale", data: ka.map((x) => x.sales), backgroundColor: teal }] },
      options: { maintainAspectRatio: false, plugins: { legend: { display: false } } } }));
  }

  // ---------- generic sortable / searchable table with totals
  const R = (k, l, f) => [k, l, f];
  const COLS = {
    team: (k, l) => [R(k, l), R("channel", "Channel"), R("rank", "Rank", "num"), R("sales", "Sale", "inr"), R("share", "Share", "pct"),
      R("orders", "Orders", "num"), R("lines", "Lines", "num"), R("qty", "Qty", "num"), R("promoters", "Promoters", "num"),
      R("outlets", "Outlets", "num"), R("avg_active_days", "Avg active days", "num1"), R("sales_per_promoter", "₹/promoter", "inr"),
      R("sales_per_promoter_day", "₹/promoter-day", "inr"), R("aov", "Avg order", "inr")],
    promoter: [R("emp_code", "Emp code"), R("emp_name", "Name"), R("supervisor", "Supervisor"), R("kae", "KAE / Team"), R("channel", "Channel"),
      R("status", "Status", "pill"), R("sales", "Sale", "inr"), R("orders", "Orders", "num"), R("active_days", "Active days", "num"),
      R("avg_per_active_day", "₹/active day", "inr"), R("outlets", "Outlets", "num"), R("outlet_codes", "Outlet codes"),
      R("last_sale", "Last sale"), R("days_since_last_sale", "Days since", "num")],
    outlet: [R("cust_code", "Code"), R("cust_name", "Outlet"), R("account", "Account"), R("account_source", "Mapped by"), R("channel", "Channel"),
      R("state", "State"), R("kae", "KAE / Team"), R("status", "Status", "pill"), R("sales", "Sale", "inr"), R("orders", "Orders", "num"),
      R("skus", "SKUs", "num"), R("promoters", "Promoters", "num"), R("days_with_sale", "Days with sale", "num"), R("last_sale", "Last sale")],
    brand: [R("brand", "Brand"), R("sales", "Sale", "inr"), R("share", "Share", "pct"), R("orders", "Orders", "num"), R("qty", "Qty", "num"),
      R("outlets", "Outlets", "num"), R("promoters", "Promoters", "num"), R("aov", "Avg order", "inr")],
    sku: [R("prd_code", "Code"), R("prd_name", "SKU"), R("brand", "Brand"), R("categ", "Category"), R("mrp", "MRP", "inr"), R("sales", "Sale", "inr"),
      R("share", "Share", "pct"), R("qty", "Qty", "num"), R("outlets", "Outlets", "num")],
    account: [R("account", "Account"), R("channel", "Channel"), R("sales", "Sale", "inr"), R("share", "Share", "pct"), R("orders", "Orders", "num"),
      R("outlets", "Outlets", "num"), R("promoters", "Promoters", "num")],
    state: [R("state_name", "State"), R("zone_from_state", "Zone"), R("sales", "Sale", "inr"), R("share", "Share", "pct"), R("outlets", "Outlets", "num")],
    target: [R("kae", "KAE (master)"), R("channel", "Channel"), R("stores", "Stores", "num"), R("target", "Target", "inr"),
      R("achievement", "Achievement", "inr"), R("ach_pct", "Ach %", "pct"), R("expected_pct", "Expected %", "pct"),
      R("gap_vs_plan", "Gap vs plan", "inr"), R("required_per_day", "Required ₹/day", "inr"), R("rag", "RAG", "pill")],
    nosale: [R("cust_code", "Store"), R("account", "Account"), R("kae", "KAE"), R("supervisor", "Supervisor"), R("target", "Target", "inr")],
    quality: [R("issue", "Issue"), R("lines", "Lines", "num"), R("orders", "Orders", "num"), R("amount", "Amount", "inr")],
    gaps: [R("order_ref", "Order"), R("order_date", "Date"), R("emp_name", "Promoter"), R("cust_name", "Outlet"), R("lines_received", "Lines got", "num"),
      R("lines_sum", "Lines sum", "inr"), R("order_total", "Order total", "inr"), R("gap", "Gap", "inr")],
    checks: [R("check", "Check"), R("expected", "Expected", "num"), R("actual", "Actual", "num"), R("result", "Result", "pill")],
  };
  const SUMMABLE = new Set(["sales", "orders", "lines", "qty", "target", "achievement", "amount", "gap", "gap_vs_plan", "stores", "lines_received"]);
  function cell(v, f) {
    if (f === "inr") return inr(v); if (f === "num") return num(v); if (f === "num1") return num(v, 1); if (f === "pct") return pct(v);
    if (f === "pill") return v ? `<span class="pill ${esc(String(v).split(" ")[0])}">${esc(v)}</span>` : "";
    return esc(v);
  }
  function table(sel, rows, cols, title, search = true, totals = true) {
    const host = $(sel); rows = rows || [];
    host.innerHTML = `<div class="card"><div class="table-tools"><h3>${esc(title)} <small>(${rows.length})</small></h3>
      ${search ? `<input type="search" placeholder="Search…">` : ""}</div><div class="table-wrap"><table class="data"><thead><tr>
      ${cols.map((c, i) => `<th data-i="${i}">${esc(c[1])}</th>`).join("")}</tr></thead><tbody></tbody><tfoot></tfoot></table></div></div>`;
    let view = rows.slice(), sortI = -1, asc = false;
    const maxSale = Math.max(1, ...rows.map((r) => r.sales || 0));
    const render = () => {
      host.querySelector("tbody").innerHTML = view.slice(0, 2000).map((r) => "<tr>" + cols.map(([k, , f]) => {
        const cls = ["inr", "num", "num1", "pct"].includes(f) ? "num" : "";
        if (k === "sales" && f === "inr") return `<td class="num bar-cell"><span class="b" style="width:${(100 * (r.sales || 0) / maxSale).toFixed(1)}%"></span><span class="t">${cell(r[k], f)}</span></td>`;
        return `<td class="${cls}">${cell(r[k], f)}</td>`;
      }).join("") + "</tr>").join("");
      const tot = cols.map(([k, , f], i) => {
        if (i === 0) return "<td>Total</td>";
        if (SUMMABLE.has(k)) return `<td class="num">${cell(view.reduce((a, r) => a + (Number(r[k]) || 0), 0), f)}</td>`;
        return "<td></td>";
      });
      host.querySelector("tfoot").innerHTML = rows.length && totals ? "<tr>" + tot.join("") + "</tr>" : "";
    };
    host.querySelectorAll("th").forEach((th) => th.onclick = () => {
      const i = +th.dataset.i; asc = sortI === i ? !asc : false; sortI = i; const k = cols[i][0];
      view.sort((a, b) => { const x = a[k], y = b[k]; const r = (typeof x === "number" && typeof y === "number") ? x - y : String(x ?? "").localeCompare(String(y ?? "")); return asc ? r : -r; });
      render();
    });
    const inp = host.querySelector("input[type=search]");
    if (inp) inp.oninput = () => { const q = inp.value.toLowerCase(); view = rows.filter((r) => cols.some(([k]) => String(r[k] ?? "").toLowerCase().includes(q))); render(); };
    render();
  }

  // open a job directly with #job=<id>
  const m = location.hash.match(/job=([\w-]+)/); if (m) openDash(m[1]);
})();
