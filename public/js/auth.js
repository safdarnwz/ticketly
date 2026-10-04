// Sign-in screen. Step 0 (only on GitHub Pages): reach the local Shelfwise server.
// Step 1: company key. Step 2: username + password. The server talks to SalesDiary.

const $ = (id) => document.getElementById(id);

function remember(key, value) {
  try {
    if (value === undefined) return localStorage.getItem('sw-' + key);
    localStorage.setItem('sw-' + key, value);
  } catch {
    /* private mode */
  }
  return null;
}

function initials(name) {
  return String(name || '?').split(/[\s._-]+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
}

export function logoHtml(company) {
  if (company?.logo) return `<img src="${company.logo.replace(/"/g, '&quot;')}" alt="" referrerpolicy="no-referrer">`;
  return initials(company?.name || company?.key);
}

const prettyUrl = (u) => String(u || '').replace(/^https?:\/\//, '');

/**
 * getBackend(): current backend (may be null while offline)
 * onSignedIn(): called after a successful sign-in / demo choice
 * onRetry(url): try to reach the server again; resolves true when connected
 * onSnapshot(): open the published snapshot instead
 */
export function initAuth({ getBackend, onSignedIn, onRetry, onSnapshot }) {
  const forms = { offline: $('offlineForm'), company: $('companyForm'), login: $('loginForm'), token: $('tokenForm') };
  let company = null;
  let snapshotOk = false;

  const error = (msg) => ($('authError').textContent = msg || '');
  const busy = (btn, on, label) => {
    btn.disabled = on;
    if (label) btn.textContent = label;
  };
  const showForm = (name) => {
    for (const [k, f] of Object.entries(forms)) f.hidden = k !== name;
    $('authSteps').hidden = name === 'offline';
    $('stepOne').className = name === 'login' ? 'done' : 'on';
    $('stepTwo').className = name === 'login' ? 'on' : '';
    $('tokenToggle').hidden = name === 'offline' || getBackend()?.allowTokenUpdate === false;
    $('tokenToggle').textContent = name === 'token' ? 'Use username & password' : 'Use a token instead';
    $('demoBtn').hidden = name === 'offline' && !snapshotOk;
    $('demoBtn').textContent = name === 'offline' ? 'View the demo snapshot' : 'Explore with demo data';
    $('altSep').hidden = $('tokenToggle').hidden || $('demoBtn').hidden;
    error('');
    const first = forms[name].querySelector('input:not([type=checkbox]), textarea');
    setTimeout(() => first?.focus(), 30);
  };
  const serverLine = (url, ok) => {
    $('serverLine').hidden = !url;
    $('serverLabel').textContent = prettyUrl(url);
    $('serverDot').className = 'dot ' + (ok ? 'ok' : 'err');
  };

  forms.offline.addEventListener('submit', async (e) => {
    e.preventDefault();
    busy($('retryBtn'), true, 'Connecting…');
    error('');
    const ok = await onRetry($('serverUrl').value.trim());
    busy($('retryBtn'), false, 'Retry');
    if (!ok) error(`Still can't reach ${prettyUrl($('serverUrl').value)}. Check that the container is running (docker ps).`);
  });

  forms.company.addEventListener('submit', async (e) => {
    e.preventDefault();
    const key = $('companyKey').value.trim().toLowerCase();
    if (!key) return;
    busy($('companyBtn'), true, 'Checking…');
    error('');
    try {
      const c = await getBackend().company(key);
      company = c;
      remember('company', key);
      $('companyName').textContent = c.name || key;
      $('companyInstance').textContent = c.instance && c.instance !== c.name ? `${key} · ${c.instance}` : key;
      $('companyLogo').innerHTML = logoHtml({ ...c, key });
      showForm('login');
      const lastUser = remember('user-' + key);
      if (lastUser) {
        $('username').value = lastUser;
        setTimeout(() => $('password').focus(), 40);
      }
    } catch (err) {
      error(err.message);
    } finally {
      busy($('companyBtn'), false, 'Continue');
    }
  });

  forms.login.addEventListener('submit', async (e) => {
    e.preventDefault();
    busy($('loginBtn'), true, 'Signing in…');
    error('');
    try {
      const username = $('username').value.trim();
      await getBackend().login({ companyKey: company.companyKey, username, password: $('password').value, remember: $('remember').checked });
      remember('user-' + company.companyKey, username);
      $('password').value = '';
      onSignedIn();
    } catch (err) {
      error(err.message);
      $('password').select();
    } finally {
      busy($('loginBtn'), false, 'Sign in');
    }
  });

  forms.token.addEventListener('submit', async (e) => {
    e.preventDefault();
    error('');
    try {
      await getBackend().loginToken($('tokenLogin').value.trim());
      $('tokenLogin').value = '';
      onSignedIn();
    } catch (err) {
      error(err.message);
    }
  });

  $('changeCompany').addEventListener('click', () => showForm('company'));
  $('serverChange').addEventListener('click', () => {
    $('serverUrl').value = getBackend()?.base || $('serverUrl').value;
    showForm('offline');
    $('serverUrl').select();
  });
  $('pwToggle').addEventListener('click', () => {
    const pw = $('password');
    pw.type = pw.type === 'password' ? 'text' : 'password';
    $('pwToggle').textContent = pw.type === 'password' ? 'Show' : 'Hide';
  });
  $('tokenToggle').addEventListener('click', () => showForm(forms.token.hidden ? 'token' : company ? 'login' : 'company'));
  $('demoBtn').addEventListener('click', async () => {
    try {
      if (!forms.offline.hidden) return onSnapshot();
      await getBackend().demo();
      onSignedIn();
    } catch (err) {
      error(err.message);
    }
  });

  const open = () => {
    document.body.classList.add('signed-out');
    $('auth').hidden = false;
  };

  return {
    show(status, message) {
      open();
      const b = getBackend();
      serverLine(b?.remote ? b.base : null, true);
      $('companyKey').value = remember('company') || status?.defaultCompany || '';
      showForm('company');
      if (message) error(message);
    },
    showOffline(url, hasSnapshot, message) {
      open();
      snapshotOk = hasSnapshot;
      serverLine(url, false);
      $('serverUrl').value = url;
      showForm('offline');
      if (message) error(message);
    },
    hide() {
      document.body.classList.remove('signed-out');
      $('auth').hidden = true;
    },
  };
}
