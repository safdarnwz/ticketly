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
    btn.textContent = 'Checking…';
    try {
      await getBackend().loginToken(token);
      field.value = '';
      field.type = 'password';
      $('tokenShow').textContent = 'Show';
      await onToken();
    } catch (err) {
      setStatus(err.message, 'error');
      field.select();
    } finally {
      btn.disabled = false;
      btn.textContent = 'Load data';
    }
  });

  // Submit straight away when a whole token is pasted.
  field.addEventListener('paste', () => {
    setTimeout(() => {
      if (/^\s*(Bearer\s+)?eyJ[\w-]+\.[\w-]+\.[\w-]+\s*$/.test(field.value)) bar.requestSubmit();
    }, 0);
  });

  $('tokenShow').addEventListener('click', () => {
    field.type = field.type === 'password' ? 'text' : 'password';
    $('tokenShow').textContent = field.type === 'password' ? 'Show' : 'Hide';
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
