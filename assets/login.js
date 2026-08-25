const $ = id => document.getElementById(id);
const status = $('status');
const loginForm = $('loginForm');
const registerForm = $('registerForm');
const invitePasswordForm = $('invitePasswordForm');
let passwordFlow = 'invite';
let recoveryActive = false;

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
  invitePasswordForm.classList.add('hidden');
  document.querySelector('.tabs').classList.remove('hidden');
  status.classList.add('hidden');
}

async function api(path, options = {}) {
  return window.ShamathaBackend.request(path, options);
}

function routeUser(user) {
  if (user.role === 'editor') {
    location.href = './editor.html';
    return;
  }
  if (user.accessStatus === 'approved' || user.accessGranted) {
    location.href = './app.html';
    return;
  }
  $('pendingActions').classList.remove('hidden');
  if (user.accessStatus === 'suspended') {
    setStatus('Seu acesso está Suspenso. Seu histórico permanece preservado e voltará a ficar disponível quando um editor reativar sua conta.', 'bad');
  } else {
    setStatus('Sua conta está Pendente. O conteúdo será liberado quando um editor aprovar seu acesso.', 'good');
  }
}

function showPasswordForm(email, mode = 'invite') {
  passwordFlow = mode;
  if (mode === 'recovery') recoveryActive = true;
  document.querySelector('.tabs').classList.add('hidden');
  loginForm.classList.add('hidden');
  registerForm.classList.add('hidden');
  invitePasswordForm.classList.remove('hidden');
  $('pendingActions').classList.add('hidden');
  $('passwordFlowMessage').textContent = mode === 'recovery'
    ? `Redefinição autorizada para ${email}. Escolha sua nova senha.`
    : `Convite aceito para ${email}. Escolha sua senha para concluir a conta.`;
  setStatus(mode === 'recovery' ? 'Escolha e confirme sua nova senha.' : `Convite aceito para ${email}. Escolha sua senha para concluir a conta.`, 'good');
}

async function detectInvitation() {
  if (recoveryActive) return true;
  const sb = window.ShamathaBackend.getClient();
  await sb.auth.getSession();
  const { data } = await sb.auth.getUser();
  const user = data?.user;
  if (user?.user_metadata?.shamatha_invited === true) {
    showPasswordForm(user.email || 'seu e-mail', 'invite');
    return true;
  }
  return false;
}

function recoveryRedirectUrl() {
  const url = new URL('./', location.href);
  url.hash = '';
  url.search = '';
  return url.href;
}

$('loginTab').addEventListener('click', () => selectTab('login'));
$('registerTab').addEventListener('click', () => selectTab('register'));

loginForm.addEventListener('submit', async event => {
  event.preventDefault();
  try {
    const data = await api('/api/login', { method:'POST', body:JSON.stringify({ email:$('loginEmail').value, password:$('loginPassword').value }) });
    if (await detectInvitation()) return;
    routeUser(data.user);
  } catch (error) { setStatus(error.message, 'bad'); }
});

$('forgotPassword').addEventListener('click', async () => {
  const input = $('loginEmail');
  if (!input.checkValidity()) {
    input.reportValidity();
    return;
  }
  const button = $('forgotPassword');
  button.disabled = true;
  try {
    const sb = window.ShamathaBackend.getClient();
    const { error } = await sb.auth.resetPasswordForEmail(String(input.value || '').trim(), {
      redirectTo: recoveryRedirectUrl()
    });
    if (error) throw error;
    setStatus('Se o e-mail estiver cadastrado, você receberá um link para definir uma nova senha.', 'good');
  } catch (error) {
    setStatus(error?.message || 'Não foi possível solicitar a redefinição de senha.', 'bad');
  } finally {
    button.disabled = false;
  }
});

registerForm.addEventListener('submit', async event => {
  event.preventDefault();
  try {
    const data = await api('/api/register', { method:'POST', body:JSON.stringify({ email:$('registerEmail').value, password:$('registerPassword').value }) });
    if (data.confirmationRequired) {
      selectTab('login');
      $('pendingActions').classList.add('hidden');
      setStatus('Conta criada. Abra o e-mail de confirmação e depois entre por esta página. A conta começa com estado Pendente.', 'good');
      return;
    }
    routeUser(data.user);
  } catch (error) { setStatus(error.message, 'bad'); }
});

invitePasswordForm.addEventListener('submit', async event => {
  event.preventDefault();
  const password = $('invitePassword').value;
  const confirm = $('invitePasswordConfirm').value;
  if (password.length < 8) return setStatus('A senha precisa ter pelo menos 8 caracteres.', 'bad');
  if (password !== confirm) return setStatus('As duas senhas precisam ser iguais.', 'bad');
  const button = invitePasswordForm.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    const sb = window.ShamathaBackend.getClient();
    const { data: userData } = await sb.auth.getUser();
    if (!userData?.user) throw new Error('Sessão de definição de senha encerrada. Solicite um novo link.');
    const metadata = { ...(userData.user.user_metadata || {}), shamatha_invited:false };
    const { error } = await sb.auth.updateUser({ password, data:metadata });
    if (error) throw error;
    const data = await api('/api/me');
    if (!data.user) throw new Error('Sessão encerrada. Entre novamente com a nova senha.');
    routeUser(data.user);
  } catch (error) {
    setStatus(error.message || (passwordFlow === 'recovery' ? 'Falha ao redefinir a senha.' : 'Falha ao definir a senha.'), 'bad');
    button.disabled = false;
  }
});

$('logoutPending').addEventListener('click', async () => {
  await api('/api/logout', { method:'POST', body:'{}' }).catch(() => null);
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
    const sb = window.ShamathaBackend.getClient();
    sb.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY') {
        showPasswordForm(session?.user?.email || 'seu e-mail', 'recovery');
      }
    });
    if (await detectInvitation()) return;
    const data = await api('/api/me');
    if (data.user) routeUser(data.user);
    if (new URLSearchParams(location.search).get('pending') === '1') setStatus('Sua conta está Pendente e aguarda aprovação do editor.');
  } catch (_) {}
})();
