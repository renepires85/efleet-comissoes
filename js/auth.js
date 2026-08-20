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
  // "Parceiro Comercial" no seletor cobre os DOIS tipos de parceiro: vendedor e
  // indicador. A distinção existe para o cálculo da comissão — o indicador ganha
  // percentual cheio sem Curva C —, não para quem está entrando: ele só sabe que
  // é parceiro da eFleet. Sem isso, todo indicador era barrado com "Perfil de
  // acesso incorreto", porque o seletor nunca teve a opção 'indicador'.
  const perfisAceitos = perfil === 'vendedor' ? ['vendedor', 'indicador'] : [perfil];
  if (!perfisAceitos.includes(usuario.perfil)) {
    err.textContent = 'Perfil de acesso incorreto.'; err.style.display = 'block';
    await sb.auth.signOut(); return;
  }

  // `ativo` nunca era conferido: inativar alguém não impedia nada, e a gestão
  // acreditava ter revogado um acesso que continuava funcionando. A senha
  // segue válida no Auth de propósito — inativar é reversível, e apagar o
  // usuário levaria junto o histórico de comissão dele.
  if (usuario.ativo === false) {
    err.textContent = 'Este acesso está inativo. Fale com a eFleet.';
    err.style.display = 'block';
    await sb.auth.signOut(); return;
  }

  currentUser = data.user;
  currentPerfil = usuario.perfil;

  // Senha provisória não abre o sistema. A tela de login continua no lugar,
  // com o modal por cima e sem saída: é o único ponto em que dá para garantir
  // que a senha que nós geramos, e que trafegou por e-mail, seja substituída.
  if (usuario.senha_provisoria) { exigirTrocaDeSenha(usuario); return; }

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

// Modo obrigatório do modal: sem ✕, sem Cancelar, sem fechar clicando fora e
// sem o campo "senha atual". Dois caminhos chegam aqui e o texto muda entre
// eles, mas a trava é a mesma:
//   'provisoria'  — entrou com a senha que o sistema gerou
//   'recuperacao' — chegou pelo link de "esqueci minha senha"
// Em nenhum dos dois pedimos a senha atual: no primeiro ela acabou de ser
// digitada no login; no segundo a pessoa não a sabe — é justamente o motivo de
// estar aqui. Quem autoriza é a sessão, que só existe porque ela provou algo.
let trocaObrigatoria = null;
let usuarioAguardandoTroca = null;

function exigirTrocaDeSenha(usuario, modo = 'provisoria') {
  trocaObrigatoria = modo;
  usuarioAguardandoTroca = usuario;
  abrirModalSenha();
}

// Chamado quando o link do e-mail de recuperação cria a sessão.
async function entrarModoRecuperacao() {
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return;
  const { data: usuario } = await sb.from('usuarios').select('*').eq('id', user.id).single();
  if (!usuario) return;
  currentUser = user;
  currentPerfil = usuario.perfil;
  document.getElementById('app').style.display = 'none';
  document.getElementById('login-screen').style.display = 'flex';
  exigirTrocaDeSenha(usuario, 'recuperacao');
}

function abrirModalSenha() {
  ['ms-atual','ms-nova','ms-nova2'].forEach(id => document.getElementById(id).value = '');
  avisoSenha('');

  document.getElementById('ms-campo-atual').style.display = trocaObrigatoria ? 'none' : 'block';
  document.getElementById('ms-fechar').style.display     = trocaObrigatoria ? 'none' : 'block';
  document.getElementById('ms-cancelar').style.display   = trocaObrigatoria ? 'none' : 'inline-flex';
  document.getElementById('ms-titulo').textContent =
    trocaObrigatoria === 'recuperacao' ? 'Defina uma nova senha'
    : trocaObrigatoria ? 'Crie a sua senha'
    : 'Alterar senha';
  document.getElementById('ms-sub').textContent =
    trocaObrigatoria === 'recuperacao'
      ? 'Confirmamos o seu e-mail. Escolha agora a nova senha — a anterior deixa de valer.'
    : trocaObrigatoria
      ? 'Você entrou com a senha provisória que a eFleet enviou. Escolha agora uma senha que só você conheça — ela substitui a provisória.'
      : 'Escolha uma senha que só você conheça.';
  document.getElementById('ms-salvar').textContent =
    trocaObrigatoria === 'recuperacao' ? 'Salvar nova senha'
    : trocaObrigatoria ? 'Criar senha' : 'Alterar senha';

  document.getElementById('modal-senha').style.display = 'flex';
  document.getElementById(trocaObrigatoria ? 'ms-nova' : 'ms-atual').focus();
}

function fecharModalSenha() {
  if (trocaObrigatoria) return;   // sem saída até a senha ser trocada
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
  const rotulo = document.getElementById('ms-salvar').textContent;

  if (!trocaObrigatoria && !atual) return avisoSenha('Informe sua senha atual.');
  if (nova.length < 8)             return avisoSenha('A senha precisa ter ao menos 8 caracteres.');
  if (nova !== nova2)              return avisoSenha('As duas senhas não são iguais.');
  if (!trocaObrigatoria && nova === atual) return avisoSenha('A nova senha precisa ser diferente da atual.');

  btn.disabled = true; btn.textContent = 'Salvando...';
  try {
    const { data: { user } } = await sb.auth.getUser();
    if (!user?.email) { avisoSenha('Sessão expirada. Entre novamente.'); return; }

    if (trocaObrigatoria) {
      // Sem campo de senha atual para comparar, tentamos entrar com a senha
      // escolhida: se funcionar, ela É a provisória, e manter a provisória é
      // exatamente o que esta tela existe para impedir.
      const { error: igual } = await sb.auth.signInWithPassword({ email: user.email, password: nova });
      if (!igual) { avisoSenha('Essa já é a sua senha atual. Escolha uma diferente.'); return; }
    } else {
      // Confirma que quem está na frente da tela sabe a senha atual.
      const { error: erroLogin } = await sb.auth.signInWithPassword({ email: user.email, password: atual });
      if (erroLogin) { avisoSenha('Senha atual incorreta.'); return; }
    }

    const { error } = await sb.auth.updateUser({ password: nova });
    if (error) { avisoSenha('Não foi possível salvar: ' + error.message); return; }

    // Só desliga a flag depois que a senha nova já está valendo: se a ordem
    // fosse inversa e o updateUser falhasse, a pessoa ficaria com a provisória
    // e sem ninguém para cobrar a troca.
    //
    // Por RPC e não por update direto: `usuarios` tem RLS e nenhuma policy de
    // UPDATE, então um update daqui afetaria zero linhas SEM ERRO — a senha
    // mudava, a flag ficava, e o próximo login caía na mesma tela para sempre.
    const { error: erroFlag } = await sb.rpc('concluir_troca_de_senha');
    if (erroFlag) { avisoSenha('Senha salva, mas houve um erro no cadastro: ' + erroFlag.message); return; }

    if (trocaObrigatoria) {
      avisoSenha('Senha salva. Entrando...', 'ok');
      const usuario = { ...usuarioAguardandoTroca, senha_provisoria: false };
      trocaObrigatoria = null; usuarioAguardandoTroca = null; recuperacaoDeSenha = false;
      setTimeout(async () => { fecharModalSenha(); await setupApp(usuario); }, 1200);
      return;
    }

    avisoSenha('Senha alterada. Use a nova no próximo acesso.', 'ok');
    setTimeout(fecharModalSenha, 2000);
  } catch (e) {
    avisoSenha('Erro inesperado: ' + (e?.message || e));
  } finally {
    btn.disabled = false; btn.textContent = rotulo;
  }
}

// ── ESQUECI MINHA SENHA ───────────────────────────────────────────────────────
// Até aqui não havia saída nenhuma: quem esquecia a senha dependia de alguém da
// gestão redefinir no banco. O próprio Rene ficou de fora do sistema por isso.
//
// O envio é feito pela smart-service, que gera o link pela API Admin e entrega
// pelo Resend. A resposta é sempre a mesma, exista ou não a conta — do
// contrário esta tela viraria um verificador de e-mails cadastrados.

function abrirModalRecuperar() {
  document.getElementById('mr-email').value = document.getElementById('email-input').value.trim();
  avisoRecuperar('');
  document.getElementById('modal-recuperar').style.display = 'flex';
  document.getElementById('mr-email').focus();
}

function fecharModalRecuperar() {
  document.getElementById('modal-recuperar').style.display = 'none';
}

function avisoRecuperar(msg, tipo = 'erro') {
  const el = document.getElementById('mr-aviso');
  if (!msg) { el.style.display = 'none'; return; }
  el.textContent = msg;
  el.style.color = tipo === 'ok' ? 'var(--efl-green-400)' : 'var(--efl-red)';
  el.style.display = 'block';
}

async function enviarRecuperacao() {
  const email = document.getElementById('mr-email').value.trim();
  const btn   = document.getElementById('mr-enviar');
  if (!email || !email.includes('@')) return avisoRecuperar('Informe um e-mail válido.');

  btn.disabled = true; btn.textContent = 'Enviando...';
  try {
    const res = await fetch(SMART_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON, 'Authorization': `Bearer ${SUPABASE_ANON}` },
      body: JSON.stringify({ recuperar: email })
    });
    const r = await res.json();
    if (r.error) throw new Error(r.error);
    avisoRecuperar(r.mensagem, 'ok');
    setTimeout(fecharModalRecuperar, 4000);
  } catch (e) {
    avisoRecuperar('Não foi possível enviar agora: ' + (e?.message || e));
  } finally {
    btn.disabled = false; btn.textContent = 'Enviar link';
  }
}
