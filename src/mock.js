'use strict';

// Demo data in the exact shape of getStockAvailablityReport, used when no token is set
// (DATA_SOURCE=mock or auto without SD_TOKEN). Deterministic per date, with today's
// visits "arriving" over time so the live refresh has something to show.

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return h >>> 0;
}

const PRODUCTS = [
  [695, 'GC0078', 'CANDID CREAM 30 GM', 'Candid Cream', 'Candid', 0.62],
  [696, 'GC0081', 'CANDID CREAM 50 GM', 'Candid Cream', 'Candid', 0.55],
  [697, 'GC0074', 'Candid Dusting Powder 60 gm', 'Candid Core', 'Candid', 0.71],
  [698, 'GC0073', 'Candid Dusting Powder 120 gm', 'Candid Core', 'Candid', 0.66],
  [699, 'GC0075', 'Candid Dusting Powder 250 gm', 'Candid Core', 'Candid', 0.38],
  [1118, 'GSKU5', 'Candid Medicated Soap 75 gm', 'Candid Core', 'Candid', 0.58],
  [701, 'GC0084', 'Candid Medicated Soap 125 gm', 'Candid Soap', 'Candid', 0.47],
  [1119, 'GSKU6', 'Candid Prickly Heat Powder 120 gm (Menthol cool)', 'Candid PH', 'Candid', 0.74],
  [1120, 'GSKU7', 'Candid Prickly Heat Powder 120 gm (Rose)', 'Candid PH', 'Candid', 0.44],
  [1121, 'GSKU8', 'Candid Prickly Heat Powder 120 gm (Sandalwood)', 'Candid PH', 'Candid', 0.31],
  [1248, 'GSK11', 'Candid Prickly Heat Powder 60 gm (Menthol cool)', 'Candid PH', 'Candid', 0.52],
  [1301, 'LS0101', 'La Shield Sunscreen SPF 40 60 gm', 'Sun Care', 'La Shield', 0.49],
  [1302, 'LS0102', 'La Shield Lite Gel SPF 50 50 gm', 'Sun Care', 'La Shield', 0.36],
  [1303, 'LS0103', 'La Shield Kids Lotion 100 ml', 'Sun Care', 'La Shield', 0.22],
  [1401, 'SC0201', 'Scalpe Plus Anti Dandruff Shampoo 75 ml', 'Hair Care', 'Scalpe', 0.57],
  [1402, 'SC0202', 'Scalpe Pro Shampoo 100 ml', 'Hair Care', 'Scalpe', 0.41],
  [1501, 'EP0301', 'Episoft AC Cleansing Lotion 125 ml', 'Skin Care', 'Episoft', 0.33],
  [1502, 'EP0302', 'Episoft Moisturiser 75 gm', 'Skin Care', 'Episoft', 0.27],
];

const GEO = [
  ['South', 'Visakhapatnam', 'Visakhapatnam', 'Andhra Pradesh', '530020'],
  ['South', 'Vijayawada', 'Vijayawada', 'Andhra Pradesh', '520010'],
  ['South', 'Hyderabad', 'Hyderabad East', 'Telangana', '500036'],
  ['South', 'Hyderabad', 'Hyderabad West', 'Telangana', '500081'],
  ['South', 'Chennai', 'Chennai Central', 'Tamil Nadu', '600002'],
  ['South', 'Bengaluru', 'Bengaluru North', 'Karnataka', '560024'],
  ['West', 'Mumbai', 'Andheri', 'Maharashtra', '400053'],
  ['West', 'Mumbai', 'Thane', 'Maharashtra', '400601'],
  ['West', 'Pune', 'Pune City', 'Maharashtra', '411001'],
  ['West', 'Ahmedabad', 'Ahmedabad', 'Gujarat', '380009'],
  ['North', 'Delhi', 'South Delhi', 'Delhi', '110017'],
  ['North', 'Delhi', 'East Delhi', 'Delhi', '110092'],
  ['North', 'Lucknow', 'Lucknow', 'Uttar Pradesh', '226001'],
  ['North', 'Jaipur', 'Jaipur', 'Rajasthan', '302001'],
  ['East', 'Kolkata', 'Kolkata South', 'West Bengal', '700029'],
  ['East', 'Bhubaneswar', 'Bhubaneswar', 'Odisha', '751001'],
  ['East', 'Patna', 'Patna', 'Bihar', '800001'],
];

const FIRST = ['Ravi', 'Sneha', 'Arjun', 'Pooja', 'Kiran', 'Anil', 'Divya', 'Suresh', 'Meena', 'Rahul', 'Lakshmi', 'Vikas', 'Neha', 'Sanjay', 'Priya', 'Manoj', 'Kavya', 'Deepak', 'Asha', 'Imran'];
const LAST = ['Kumar', 'Reddy', 'Sharma', 'Naidu', 'Patel', 'Iyer', 'Das', 'Singh', 'Rao', 'Gupta', 'Khan', 'Verma', 'Joshi', 'Pillai', 'Ghosh'];
const CHAINS = [['DMART', 'MT'], ['MORE', 'MT'], ['RELIANCE SMART', 'MT'], ['MEDPLUS', 'PHARMA'], ['APOLLO PHARMACY', 'PHARMA'], ['GENERAL STORES', 'GT'], ['KIRANA', 'GT'], ['SUPERMARKET', 'GT']];
const RSM = { South: ['RSM Ranjith Team', 'Ranjith Kumar', 'GL90023678'], West: ['RSM Mehta Team', 'Nikhil Mehta', 'GL90023102'], North: ['RSM Kapoor Team', 'Ritu Kapoor', 'GL90023311'], East: ['RSM Bose Team', 'Arnab Bose', 'GL90023455'] };

function buildWorld() {
  const r = rng(42);
  const pick = (arr) => arr[Math.floor(r() * arr.length)];
  const salesmen = [];
  const outlets = [];
  let uid = 500;
  let rid = 430400;
  GEO.forEach((g, gi) => {
    const tl = `${pick(FIRST)} ${pick(LAST)}`.toUpperCase();
    const tlCode = `GL12${String(18000 + gi * 37).padStart(5, '0')}`;
    const count = 2 + Math.floor(r() * 2);
    for (let s = 0; s < count; s++) {
      const sm = {
        user_id: uid++,
        salesman: `${pick(FIRST)} ${pick(LAST)}`.toUpperCase(),
        s_code: `GL16${String(67000 + uid).padStart(5, '0')}`,
        team: `${tl} Team`,
        tl_name: tl,
        tl_code: tlCode,
        geo: g,
        skill: 0.75 + r() * 0.45,
        outlets: [],
      };
      const oc = 6 + Math.floor(r() * 6);
      for (let o = 0; o < oc; o++) {
        const [chain, type] = pick(CHAINS);
        const outlet = {
          retailer_id: rid++,
          o_code: `${type.slice(0, 2)}${chain.slice(0, 2)}${rid % 10000}`,
          o_name: `${g[2].toUpperCase()} ${chain} ${o + 1}`,
          outlet_type: type,
          class: r() < 0.25 ? 'a' : r() < 0.6 ? 'b' : 'c',
          street: `${Math.floor(r() * 900) + 10}, Main Road`,
          health: 0.6 + r() * 0.7,
        };
        sm.outlets.push(outlet);
        outlets.push(outlet);
      }
      salesmen.push(sm);
    }
  });
  return { salesmen, outlets };
}

const WORLD = buildWorld();

function eachDate(start, end) {
  const out = [];
  const d = new Date(start + 'T00:00:00Z');
  const last = new Date(end + 'T00:00:00Z');
  while (d <= last && out.length < 92) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

function generate(start, end) {
  const rows = [];
  const dates = eachDate(start, end);
  const todayStr = new Date().toISOString().slice(0, 10);
  // On "today" visits trickle in: a new slice of sessions unlocks every ~15 seconds.
  const liveStep = Math.floor(Date.now() / 15000) % 40;
  let id = 5884000;
  let session = 93000;

  for (const date of dates) {
    const dayRand = rng(hash(date));
    const isToday = date === todayStr;
    for (const sm of WORLD.salesmen) {
      // Each rep visits a subset of their beat each day.
      const visits = sm.outlets.filter(() => dayRand() < 0.55);
      visits.forEach((outlet, vi) => {
        session++;
        if (isToday && (vi * 7 + (sm.user_id % 9)) % 40 > liveStep + 8) return;
        const vr = rng(hash(`${date}|${outlet.retailer_id}`));
        const productive = vr() < 0.35 + sm.skill * 0.3;
        const [region, cluster, territory, state, zip] = sm.geo;
        const pteam = RSM[region];
        for (const [pid, code, name, category, brand, base] of PRODUCTS) {
          id++;
          const p = Math.min(0.97, base * sm.skill * outlet.health * (outlet.class === 'a' ? 1.15 : outlet.class === 'c' ? 0.85 : 1));
          const avail = vr() < p ? 100 : 0;
          const ordered = productive && (avail ? vr() < 0.35 : vr() < 0.1);
          const o_qty = ordered ? Math.round((outlet.outlet_type === 'MT' ? 40 : 8) * (0.4 + vr() * 2.4)) : 0;
          const i_qty = avail ? Math.round(vr() * 30) : 0;
          rows.push({
            total_prog: 0,
            id,
            product_id: pid,
            comp_product_id: null,
            retailer_id: outlet.retailer_id,
            session_id: session,
            user_id: sm.user_id,
            custom_config: null,
            date,
            variant_name: null,
            i_qty,
            c_qty: avail ? Math.max(0, i_qty - Math.round(vr() * 10)) : 0,
            f_qty: null,
            ms: avail && vr() < 0.6 ? 100 : 0,
            sos: avail ? Math.round(vr() * 35) : 0,
            o_qty,
            avail,
            config_json: { inward_qty: ordered ? Math.round(o_qty * vr()) : 0 },
            region,
            cluster,
            territory,
            team: sm.team,
            tl_name: sm.tl_name,
            tl_code: sm.tl_code,
            pteam: pteam[0],
            ptl_name: pteam[1],
            ptl_code: pteam[2],
            salesman: sm.salesman,
            s_code: sm.s_code,
            p_code: null,
            p_name: null,
            o_code: outlet.o_code,
            o_name: outlet.o_name,
            outlet_type: outlet.outlet_type,
            channel: null,
            program: null,
            class: outlet.class,
            street: outlet.street,
            city: cluster,
            state,
            zip,
            prd_code: code,
            product: name,
            product_source: 'product',
            family: name.toUpperCase(),
            category,
            brand,
          });
        }
      });
    }
  }
  for (const row of rows) row.total_prog = rows.length;
  return rows;
}

async function fetchMockReport(start, end) {
  const rows = generate(start, end);
  const now = new Date();
  const time = `${now.toISOString().slice(0, 10)}|${now.toTimeString().slice(0, 8)}.000`;
  return { rows, pages: 1, upstreamTime: time, total: rows.length };
}

module.exports = { fetchMockReport };
