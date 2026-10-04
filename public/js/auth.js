// Two pieces of UI that decide whether data can load:
//   - the token box at the top of the site (paste SalesDiary token -> Load data)
//   - the full-screen "start your server" panel, shown only when the Shelfwise server is down

const $ = (id) => document.getElementById(id);
const prettyUrl = (u) => String(u || '').replace(/^https?:\/\//, '');

function fmtExp(ms) {
  const d = new Date(ms);
  const sameDay = d.toDateString() === new Date().toDateString();
  return sameDay ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : d.toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

/**
 * getBackend(): current backend (null while offline)
 * onToken(): a token was accepted by the server -> load data
 * onDemo(): use generated demo data
 * onRetry(url): reach the server again; resolves true when connected
 * onSnapshot(): show the snapshot published with the website
 */
export function initAuth({ getBackend, onToken, onDemo, onRetry, onSnapshot }) {
  const bar = $('tokenBar');
  const field = $('tokenField');
  const statusEl = $('tokenStatus');

  const setStatus = (html, kind = '') => {
    statusEl.innerHTML = html;
    bar.classList.toggle('is-error', kind === 'error');
    bar.classList.toggle('is-ok', kind === 'ok');
  };

  const syncClear = () => {
    $('tokenClear').hidden = !field.value;
  };

  // The API is called only when the user presses Load data (or Enter), never on paste.
  bar.addEventListener('submit', async (e) => {
    e.preventDefault();
    const token = field.value.trim();
    if (!token) {
      setStatus('Paste the token first.', 'error');
      field.focus();
      return;
    }
    const btn = $('tokenSubmit');
    btn.disabled = true;
    btn.classList.add('is-busy');
    btn.querySelector('.label').textContent = 'Loading…';
    setStatus('Checking the token…');
    try {
      await getBackend().loginToken(token);
      field.value = '';
      syncClear();
      await onToken();
    } catch (err) {
      setStatus(err.message, 'error');
      field.select();
    } finally {
      btn.disabled = false;
      btn.classList.remove('is-busy');
      btn.querySelector('.label').textContent = 'Load data';
    }
  });

  field.addEventListener('input', () => {
    syncClear();
    if (bar.classList.contains('is-error')) setStatus('Press Load data when ready.');
  });
  field.addEventListener('paste', () => {
    setTimeout(() => {
      // Strip "Bearer " or quotes copied along with the header value, but leave it visible.
      field.value = field.value.trim().replace(/^(Bearer|authorization:?)\s+/i, '').replace(/^['"]|['"]$/g, '');
      syncClear();
      setStatus('Token pasted. Press <b>Load data</b> to fetch the report.');
    }, 0);
  });
  $('tokenClear').addEventListener('click', () => {
    field.value = '';
    syncClear();
    field.focus();
  });

  statusEl.addEventListener('click', (e) => {
    if (e.target.closest('[data-demo]')) onDemo();
  });

  // ---------- server offline screen ----------

  $('offlineForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('retryBtn');
    btn.disabled = true;
    btn.textContent = 'Connecting…';
    $('authError').textContent = '';
    const ok = await onRetry($('serverUrl').value.trim());
    btn.disabled = false;
    btn.textContent = 'Retry';
    if (!ok) $('authError').textContent = `Still can't reach ${prettyUrl($('serverUrl').value)}. Check that the container is running (docker ps).`;
  });
  $('serverChange').addEventListener('click', () => $('serverUrl').select());
  $('demoBtn').addEventListener('click', () => onSnapshot());

  return {
    /** Reflect the server's view of the current token in the box. */
    update(status, message) {
      bar.hidden = status?.allowTokenUpdate === false || status?.mode === 'shared' || status?.source === 'snapshot';
      if (message) return setStatus(message, 'error');
      const t = status?.token;
      if (status?.mode === 'live' && t) {
        const who = [t.instance, t.profile].filter(Boolean).join(' · ');
        setStatus(`<span class="ok-dot"></span>Connected${who ? ` · ${who}` : ''}${t.exp ? ` · valid till ${fmtExp(t.exp)}` : ''}`, 'ok');
        field.placeholder = 'Paste a new token to replace the current one';
      } else if (status?.mode === 'mock') {
        setStatus('Showing demo data. Paste a token to see your numbers.');
        field.placeholder = 'Paste the authorization token (eyJhbGciOi…)';
      } else {
        setStatus('Paste your token and press Load data. <button type="button" class="btn-link" data-demo>Or try demo data</button>');
        field.placeholder = 'Paste the authorization token (eyJhbGciOi…)';
      }
    },
    focus() {
      field.focus();
    },
    showOffline(url, hasSnapshot, message) {
      document.body.classList.add('signed-out');
      $('auth').hidden = false;
      $('serverLine').hidden = false;
      $('serverLabel').textContent = prettyUrl(url);
      $('serverDot').className = 'dot err';
      $('serverUrl').value = url;
      $('demoBtn').hidden = !hasSnapshot;
      $('authError').textContent = message || '';
      setTimeout(() => $('retryBtn').focus(), 30);
    },
    hideOffline() {
      document.body.classList.remove('signed-out');
      $('auth').hidden = true;
    },
  };
}
