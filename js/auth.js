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

// ── ALTERAR SENHA ─────────────────────────────────────────────────────────────
// Até aqui o sistema não tinha nenhuma forma de trocar a senha: só o login e o
// formulário de solicitação de acesso pediam senha. Quem recebia uma senha
// temporária ficava com ela para sempre, até um reset manual pelo banco.
//
// A senha ATUAL é exigida de propósito, embora o Supabase não precise dela para
// updateUser: sem isso, qualquer pessoa que encontrasse uma sessão aberta —
// máquina destravada, navegador compartilhado — trocaria a senha e tomaria a
// conta. Confirmamos reautenticando com signInWithPassword antes de trocar.

function abrirModalSenha() {
  ['ms-atual','ms-nova','ms-nova2'].forEach(id => document.getElementById(id).value = '');
  avisoSenha('');
  document.getElementById('modal-senha').style.display = 'flex';
  document.getElementById('ms-atual').focus();
}

function fecharModalSenha() {
  document.getElementById('modal-senha').style.display = 'none';
}

function avisoSenha(msg, tipo = 'erro') {
  const el = document.getElementById('ms-aviso');
  if (!msg) { el.style.display = 'none'; return; }
  el.textContent = msg;
  el.style.color = tipo === 'ok' ? 'var(--efl-green-400)' : 'var(--efl-red)';
  el.style.display = 'block';
}

async function salvarNovaSenha() {
  const atual = document.getElementById('ms-atual').value;
  const nova  = document.getElementById('ms-nova').value;
  const nova2 = document.getElementById('ms-nova2').value;
  const btn   = document.getElementById('ms-salvar');

  if (!atual)                 return avisoSenha('Informe sua senha atual.');
  if (nova.length < 8)        return avisoSenha('A nova senha precisa ter ao menos 8 caracteres.');
  if (nova !== nova2)         return avisoSenha('As duas senhas novas não são iguais.');
  if (nova === atual)         return avisoSenha('A nova senha precisa ser diferente da atual.');

  btn.disabled = true; btn.textContent = 'Alterando...';
  try {
    const { data: { user } } = await sb.auth.getUser();
    if (!user?.email) { avisoSenha('Sessão expirada. Entre novamente.'); return; }

    // Confirma que quem está na frente da tela sabe a senha atual.
    const { error: erroLogin } = await sb.auth.signInWithPassword({ email: user.email, password: atual });
    if (erroLogin) { avisoSenha('Senha atual incorreta.'); return; }

    const { error } = await sb.auth.updateUser({ password: nova });
    if (error) { avisoSenha('Não foi possível alterar: ' + error.message); return; }

    avisoSenha('Senha alterada. Use a nova no próximo acesso.', 'ok');
    setTimeout(fecharModalSenha, 2000);
  } catch (e) {
    avisoSenha('Erro inesperado: ' + (e?.message || e));
  } finally {
    btn.disabled = false; btn.textContent = 'Alterar senha';
  }
}
