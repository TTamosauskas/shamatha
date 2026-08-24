const $ = id => document.getElementById(id);
const status = $('status');
const loginForm = $('loginForm');
const registerForm = $('registerForm');

function setStatus(message, kind = '') {
  status.textContent = message;
  status.className = `status ${kind}`.trim();
}

function selectTab(tab) {
  const login = tab === 'login';
  $('loginTab').classList.toggle('active', login);
  $('registerTab').classList.toggle('active', !login);
  loginForm.classList.toggle('hidden', !login);
  registerForm.classList.toggle('hidden', login);
  status.classList.add('hidden');
}

async function api(path, options = {}) {
  return window.ShamathaBackend.request(path, options);
}


function routeUser(user) {
  if (user.role === 'editor') location.href = './editor.html';
  else if (user.accessGranted) location.href = './app.html';
  else {
    setStatus('Cadastro concluído. Seu acesso ao conteúdo aguarda a liberação do editor.', 'good');
    $('pendingActions').classList.remove('hidden');
  }
}

$('loginTab').addEventListener('click', () => selectTab('login'));
$('registerTab').addEventListener('click', () => selectTab('register'));

loginForm.addEventListener('submit', async event => {
  event.preventDefault();
  try {
    const data = await api('/api/login', { method: 'POST', body: JSON.stringify({ email: $('loginEmail').value, password: $('loginPassword').value }) });
    routeUser(data.user);
  } catch (error) { setStatus(error.message, 'bad'); }
});

registerForm.addEventListener('submit', async event => {
  event.preventDefault();
  try {
    const data = await api('/api/register', { method: 'POST', body: JSON.stringify({ email: $('registerEmail').value, password: $('registerPassword').value }) });
    if (data.confirmationRequired) {
      selectTab('login');
      $('pendingActions').classList.add('hidden');
      setStatus('Conta criada. Abra o e-mail de confirmação do Supabase e, depois, entre por esta página. O conteúdo será liberado pelo editor.', 'good');
      return;
    }
    routeUser(data.user);
  } catch (error) { setStatus(error.message, 'bad'); }
});

$('logoutPending').addEventListener('click', async () => {
  await api('/api/logout', { method: 'POST', body: '{}' }).catch(() => null);
  location.href = './index.html';
});

(async () => {
  if (!window.ShamathaBackend?.isConfigured()) {
    setStatus('Configuração pendente: preencha supabaseUrl e supabasePublishableKey em assets/config.js.', 'bad');
    loginForm.querySelector('button[type="submit"]').disabled = true;
    registerForm.querySelector('button[type="submit"]').disabled = true;
    return;
  }
  try {
    const data = await api('/api/me');
    if (data.user) routeUser(data.user);
    if (new URLSearchParams(location.search).get('pending') === '1') setStatus('Sua conta está ativa e aguarda liberação do editor para acessar o conteúdo.');
  } catch (_) {}
})();
