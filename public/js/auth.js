// Two-step SalesDiary sign-in: company key -> username/password. The server does the actual
// SalesDiary calls and keeps the token in its session; the browser only gets a cookie.

const $ = (id) => document.getElementById(id);

async function post(url, body) {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
  return json;
}

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

export function initAuth({ onSignedIn }) {
  const forms = { company: $('companyForm'), login: $('loginForm'), token: $('tokenForm') };
  let company = null;

  const error = (msg) => ($('authError').textContent = msg || '');
  const busy = (btn, on, label) => {
    btn.disabled = on;
    if (label) btn.textContent = label;
  };
  const showForm = (name) => {
    for (const [k, f] of Object.entries(forms)) f.hidden = k !== name;
    $('stepOne').className = name === 'login' ? 'done' : 'on';
    $('stepTwo').className = name === 'login' ? 'on' : '';
    $('tokenToggle').textContent = name === 'token' ? 'Use username & password' : 'Use a token instead';
    error('');
    const first = forms[name].querySelector('input:not([type=checkbox]), textarea');
    setTimeout(() => first?.focus(), 30);
  };

  forms.company.addEventListener('submit', async (e) => {
    e.preventDefault();
    const key = $('companyKey').value.trim().toLowerCase();
    if (!key) return;
    busy($('companyBtn'), true, 'Checking…');
    error('');
    try {
      const c = await post('api/auth/company', { companyKey: key });
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
      await post('api/auth/login', { companyKey: company.companyKey, username, password: $('password').value, remember: $('remember').checked });
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
      await post('api/auth/token', { token: $('tokenLogin').value.trim() });
      $('tokenLogin').value = '';
      onSignedIn();
    } catch (err) {
      error(err.message);
    }
  });

  $('changeCompany').addEventListener('click', () => showForm('company'));
  $('pwToggle').addEventListener('click', () => {
    const pw = $('password');
    pw.type = pw.type === 'password' ? 'text' : 'password';
    $('pwToggle').textContent = pw.type === 'password' ? 'Show' : 'Hide';
  });
  $('tokenToggle').addEventListener('click', () => showForm(forms.token.hidden ? 'token' : company ? 'login' : 'company'));
  $('demoBtn').addEventListener('click', async () => {
    try {
      await post('api/auth/demo');
      onSignedIn();
    } catch (err) {
      error(err.message);
    }
  });

  return {
    show(status, message) {
      document.body.classList.add('signed-out');
      $('auth').hidden = false;
      $('tokenToggle').hidden = status?.allowTokenUpdate === false;
      const key = remember('company') || status?.defaultCompany || '';
      $('companyKey').value = key;
      showForm('company');
      if (message) error(message);
    },
    hide() {
      document.body.classList.remove('signed-out');
      $('auth').hidden = true;
    },
    async signOut() {
      await post('api/auth/logout').catch(() => {});
    },
  };
}
