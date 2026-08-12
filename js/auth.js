// ── LOGIN ─────────────────────────────────────────────────────────────────────
async function doLogin() {
  const perfil = document.getElementById('perfil-select').value;
  const email  = document.getElementById('email-input').value.trim();
  const senha  = document.getElementById('senha-input').value;
  const err    = document.getElementById('login-error');
  const btn    = document.getElementById('login-btn');

  if (!perfil) { err.textContent = 'Selecione um perfil.'; err.style.display = 'block'; return; }
  if (!email || !senha) { err.textContent = 'Preencha e-mail e senha.'; err.style.display = 'block'; return; }

  btn.textContent = 'Entrando...'; btn.disabled = true; err.style.display = 'none';

  const { data, error } = await sb.auth.signInWithPassword({ email, password: senha });
  btn.textContent = 'Entrar'; btn.disabled = false;

  if (error) { err.textContent = 'E-mail ou senha incorretos.'; err.style.display = 'block'; return; }

  const { data: usuario } = await sb.from('usuarios').select('*').eq('id', data.user.id).single();
  if (!usuario) { err.textContent = 'Usuário sem perfil cadastrado.'; err.style.display = 'block'; await sb.auth.signOut(); return; }
  if (usuario.perfil !== perfil) { err.textContent = 'Perfil de acesso incorreto.'; err.style.display = 'block'; await sb.auth.signOut(); return; }

  currentUser = data.user;
  currentPerfil = usuario.perfil;
  await setupApp(usuario);
}

// ── LOGOUT ────────────────────────────────────────────────────────────────────
async function doLogout() {
  await sb.auth.signOut();
  currentUser = null; currentPerfil = null; currentPrestadorId = null;
  document.getElementById('login-screen').style.display = 'flex';
  document.getElementById('app').style.display = 'none';
  document.getElementById('nav-tabs').style.display = 'none';
  document.getElementById('email-input').value = '';
  document.getElementById('senha-input').value = '';
  document.getElementById('perfil-select').value = '';
}

// ── SETUP APP ─────────────────────────────────────────────────────────────────
async function setupApp(usuario) {
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('app').style.display = 'flex';
  document.getElementById('topbar-user').textContent = usuario.nome;

  const badge = document.getElementById('topbar-badge');
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));

  if (usuario.perfil === 'gestao') {
    badge.className = 'topbar-badge badge-gestao';
    badge.textContent = 'Gestão';
    document.getElementById('nav-tabs').style.display = 'block';
    document.getElementById('view-gestao').classList.add('active');
    await carregarGestao();
  } else if (usuario.perfil === 'vendedor' || usuario.perfil === 'indicador') {
    // Indicador reaproveita a mesma tela de extrato do vendedor: o RLS já
    // restringe pelo prestador_id, então cada um só vê seus próprios dados.
    badge.className = 'topbar-badge badge-vendedor';
    badge.textContent = usuario.perfil === 'indicador' ? 'Parceiro Indicador' : 'Parceiro Comercial';
    document.getElementById('nav-tabs').style.display = 'none';
    const { data: prest } = await sb.from('prestadores').select('id,nome').eq('usuario_id', currentUser.id).single();
    if (prest) { currentPrestadorId = prest.id; await carregarVendedor(prest.id, prest.nome); }
    document.getElementById('view-vendedor').classList.add('active');
  }
}
