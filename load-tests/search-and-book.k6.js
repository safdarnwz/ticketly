// k6 load test — the two hottest paths: search and the hold→confirm booking
// flow. Run: `k6 run --vus 200 --duration 60s load-tests/search-and-book.k6.js`
//
// The thresholds encode the platform's SLOs and FAIL the run if missed, so this
// doubles as a performance regression gate in CI (a nightly job against staging).
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend, Rate } from 'k6/metrics';

const BASE = __ENV.BASE_URL || 'http://localhost:3000/api/v1';
const searchLatency = new Trend('search_latency_ms');
const bookErrors = new Rate('book_errors');

export const options = {
  scenarios: {
    // 90% of traffic is search; 10% books — realistic for a bus storefront.
    search: { executor: 'ramping-vus', exec: 'search', startVUs: 0,
      stages: [{ duration: '15s', target: 180 }, { duration: '45s', target: 180 }] },
    book: { executor: 'ramping-vus', exec: 'book', startVUs: 0,
      stages: [{ duration: '15s', target: 20 }, { duration: '45s', target: 20 }] },
  },
  thresholds: {
    // SLO: search p99 < 120ms, booking-confirm p99 < 400ms.
    'search_latency_ms': ['p(99)<120', 'p(95)<80'],
    'http_req_duration{scenario:book}': ['p(99)<400'],
    'book_errors': ['rate<0.01'],
    'http_req_failed': ['rate<0.01'],
  },
};

const CITY_A = __ENV.CITY_A || '00000000-0000-7000-8000-000000000001';
const CITY_B = __ENV.CITY_B || '00000000-0000-7000-8000-000000000002';
const DATE = __ENV.DATE || '2026-04-01';

export function search() {
  const res = http.post(`${BASE}/search`, JSON.stringify({
    originCityId: CITY_A, destCityId: CITY_B, journeyDate: DATE,
  }), { headers: { 'Content-Type': 'application/json' } });
  searchLatency.add(res.timings.duration);
  check(res, { 'search 200': (r) => r.status === 200 });
  sleep(1);
}

export function book() {
  // A real script would: search → quote → hold (Idempotency-Key) → confirm.
  // Shown abbreviated; the Idempotency-Key makes retries safe under load.
  const key = `${__VU}-${__ITER}-${Date.now()}`;
  const res = http.post(`${BASE}/pricing/quote`, JSON.stringify({
    tripId: __ENV.TRIP_ID, fromStopId: __ENV.FROM_STOP, toStopId: __ENV.TO_STOP,
    seatType: 'seater', seatCount: 1,
  }), { headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key } });
  bookErrors.add(res.status >= 400);
  sleep(1);
}
