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

  if (usuario.perfil === 'vendedor' && !usuario.onboarding_concluido) {
    await iniciarOnboarding(data.user, usuario);
    return;
  }
  await setupApp(usuario);
}

// ── LOGOUT ────────────────────────────────────────────────────────────────────
async function doLogout() {
  await sb.auth.signOut();
  currentUser = null; currentPerfil = null; currentPrestadorId = null;
  document.getElementById('login-screen').style.display = 'flex';
  document.getElementById('app').style.display = 'none';
  document.getElementById('onboarding-screen').style.display = 'none';
  document.getElementById('nav-tabs').style.display = 'none';
  document.getElementById('email-input').value = '';
  document.getElementById('senha-input').value = '';
  document.getElementById('perfil-select').value = '';
}

// ── SETUP APP ─────────────────────────────────────────────────────────────────
async function setupApp(usuario) {
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('onboarding-screen').style.display = 'none';
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
  } else if (usuario.perfil === 'vendedor') {
    badge.className = 'topbar-badge badge-vendedor';
    badge.textContent = 'Parceiro Comercial';
    document.getElementById('nav-tabs').style.display = 'none';
    const { data: prest } = await sb.from('prestadores').select('id,nome').eq('usuario_id', currentUser.id).single();
    if (prest) { currentPrestadorId = prest.id; await carregarVendedor(prest.id, prest.nome); }
    document.getElementById('view-vendedor').classList.add('active');
  }
}

// ── ONBOARDING ────────────────────────────────────────────────────────────────
let obStep = 0;
let obUsuario = null;

async function iniciarOnboarding(user, usuario) {
  currentUser = user;
  obUsuario = usuario;
  obStep = usuario?.onboarding_step || 0;
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('app').style.display = 'none';
  document.getElementById('onboarding-screen').style.display = 'flex';
  renderObStep();
}

function renderObStep() {
  const totalSteps = 6;
  const pct = Math.round(((obStep + 1) / totalSteps) * 100);
  document.getElementById('ob-progress').style.width = pct + '%';

  let dots = '';
  for (let i = 0; i < totalSteps; i++) {
    if (i < obStep) dots += `<div class="ob-step-dot done"></div>`;
    else if (i === obStep) dots += `<div class="ob-step-dot active"></div>`;
    else dots += `<div class="ob-step-dot"></div>`;
  }
  document.getElementById('ob-dots').innerHTML = dots;

  const content = document.getElementById('ob-content');
  switch (obStep) {
    case 0:
      content.innerHTML = `
        <div style="text-align:center;margin-bottom:24px;">
          <svg viewBox="0 0 40 40" width="56" height="56" fill="none"><circle cx="20" cy="20" r="18" fill="#245091"/><path d="M13 20l5 5 9-10" stroke="#A4C557" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </div>
        <div class="ob-title" style="text-align:center;">Bem-vindo à eFleet!</div>
        <div class="ob-sub" style="text-align:center;">Olá${obUsuario?.nome ? ', <strong style="color:#fff;">' + obUsuario.nome + '</strong>' : ''}! Você foi convidado para acessar o sistema de comissões. Vamos configurar seu acesso em poucos passos.</div>
        <div class="ob-actions"><button class="btn btn-primary btn-lg btn-full" onclick="obProximo()">Começar cadastro →</button></div>`;
      break;
    case 1:
      content.innerHTML = `
        <div class="ob-title">Seus dados pessoais</div>
        <div class="ob-sub">Confirme ou complete suas informações.</div>
        <div class="form-field"><label class="input-label">E-mail</label><input class="input" id="ob-email" value="${currentUser?.email || ''}" disabled style="opacity:.6;"></div>
        <div class="form-field"><label class="input-label">Nome completo</label><input class="input" id="ob-nome" value="${obUsuario?.nome || ''}" placeholder="Seu nome completo"></div>
        <div class="form-field"><label class="input-label">CPF</label><input class="input" id="ob-cpf" placeholder="000.000.000-00"></div>
        <div class="form-field"><label class="input-label">Telefone / WhatsApp</label><input class="input" id="ob-tel" placeholder="(11) 99999-9999"></div>
        <div class="ob-actions">
          <button class="btn btn-ghost btn-md" onclick="obAnterior()">← Voltar</button>
          <button class="btn btn-primary btn-md" onclick="obSalvarDadosPessoais()">Continuar →</button>
        </div>`;
      break;
    case 2:
      content.innerHTML = `
        <div class="ob-title">Dados bancários</div>
        <div class="ob-sub">Informe sua conta para receber as comissões. Você pode pular e preencher depois.</div>
        <div class="form-field"><label class="input-label">Banco</label><select class="input" id="ob-banco"><option value="">Selecionar...</option><option>Itaú</option><option>Bradesco</option><option>Santander</option><option>Banco do Brasil</option><option>Caixa Econômica</option><option>Nubank</option><option>Inter</option><option>C6 Bank</option><option>Outro</option></select></div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
          <div class="form-field"><label class="input-label">Agência</label><input class="input" id="ob-agencia" placeholder="0000"></div>
          <div class="form-field"><label class="input-label">Conta</label><input class="input" id="ob-conta" placeholder="00000-0"></div>
        </div>
        <div class="form-field"><label class="input-label">Tipo de conta</label><select class="input" id="ob-tipo-conta"><option value="corrente">Corrente</option><option value="poupanca">Poupança</option><option value="pagamento">Pagamento</option></select></div>
        <div class="form-field"><label class="input-label">Chave PIX</label><input class="input" id="ob-pix" placeholder="CPF, CNPJ, e-mail ou telefone"></div>
        <div class="ob-actions">
          <button class="btn btn-ghost btn-md" onclick="obAnterior()">← Voltar</button>
          <button class="btn btn-ghost btn-md" onclick="obPularBanco()">Pular por agora</button>
          <button class="btn btn-primary btn-md" onclick="obSalvarBanco()">Continuar →</button>
        </div>`;
      break;
    case 3:
      content.innerHTML = `
        <div class="ob-title">Política de comissões</div>
        <div class="ob-sub">Leia e aceite a política antes de continuar.</div>
        <div class="ob-politica-box">
          <div>
            <div style="font-family:var(--efl-font-head);font-size:14px;font-weight:700;color:#fff;margin-bottom:4px;">Política de Comissões eFleet</div>
            <div style="font-size:12px;color:var(--efl-gray-400);">Documento em atualização — disponível em breve</div>
          </div>
          <div style="display:flex;gap:8px;">
            <button class="btn btn-ghost btn-sm" disabled style="opacity:.4;">↓ Baixar PDF</button>
            <button class="btn btn-secondary btn-sm" disabled style="opacity:.4;">Visualizar</button>
          </div>
        </div>
        <div class="ob-checkbox-row">
          <input type="checkbox" id="ob-aceite">
          <span>Li e aceito a política de comissões da eFleet Digital</span>
        </div>
        <div class="ob-actions" style="margin-top:20px;">
          <button class="btn btn-ghost btn-md" onclick="obAnterior()">← Voltar</button>
          <button class="btn btn-primary btn-md" onclick="obSalvarAceite()">Continuar →</button>
        </div>`;
      break;
    case 4:
      content.innerHTML = `
        <div class="ob-title">Crie sua senha</div>
        <div class="ob-sub">Escolha uma senha segura para acessar o sistema.</div>
        <div class="form-field"><label class="input-label">Nova senha</label><input class="input" id="ob-senha" type="password" placeholder="Mínimo 8 caracteres"></div>
        <div class="form-field"><label class="input-label">Confirmar senha</label><input class="input" id="ob-senha2" type="password" placeholder="Repita a senha"></div>
        <div style="font-size:12px;color:var(--efl-gray-500);margin-bottom:8px;">• Mínimo 8 caracteres</div>
        <div class="status-box" id="ob-senha-status"></div>
        <div class="ob-actions">
          <button class="btn btn-ghost btn-md" onclick="obAnterior()">← Voltar</button>
          <button class="btn btn-primary btn-md" onclick="obSalvarSenha()">Continuar →</button>
        </div>`;
      break;
    case 5:
      content.innerHTML = `
        <div class="ob-title" style="text-align:center;">Tudo pronto! 🎉</div>
        <div class="ob-sub" style="text-align:center;">Veja como o sistema funciona:</div>
        <div class="ob-tutorial-card">
          <div class="ob-tutorial-icon">📊</div>
          <div class="ob-tutorial-title">Acompanhe suas comissões</div>
          <div class="ob-tutorial-text">Veja em detalhe suas comissões por cliente e produto — FUEL, mensalidades e mais.</div>
        </div>
        <div class="ob-tutorial-card">
          <div class="ob-tutorial-icon">✅</div>
          <div class="ob-tutorial-title">Valide mensalmente</div>
          <div class="ob-tutorial-text">Todo mês você recebe uma notificação, confere os valores e aprova até o dia 20. Sem aprovação, o pagamento não é processado.</div>
        </div>
        <div class="ob-tutorial-card">
          <div class="ob-tutorial-icon">💬</div>
          <div class="ob-tutorial-title">Conteste se necessário</div>
          <div class="ob-tutorial-text">Encontrou alguma divergência? Conteste direto no sistema e a eFleet entrará em contato.</div>
        </div>
        <div class="ob-actions"><button class="btn btn-primary btn-lg btn-full" onclick="obConcluir()">Acessar meu extrato →</button></div>`;
      break;
  }
}

async function obSalvarStep() {
  if (!currentUser) return;
  await sb.from('usuarios').update({ onboarding_step: obStep }).eq('id', currentUser.id);
}

function obProximo() { obStep++; obSalvarStep(); renderObStep(); }
function obAnterior() { if (obStep > 0) { obStep--; obSalvarStep(); renderObStep(); } }

async function obSalvarDadosPessoais() {
  const nome = document.getElementById('ob-nome').value.trim();
  const cpf  = document.getElementById('ob-cpf').value.trim();
  const tel  = document.getElementById('ob-tel').value.trim();
  if (!nome) { alert('Preencha seu nome completo.'); return; }
  await sb.from('usuarios').update({ nome }).eq('id', currentUser.id);
  const { data: prest } = await sb.from('prestadores').select('id').eq('usuario_id', currentUser.id).single();
  if (prest) { await sb.from('prestadores').update({ nome, cpf_responsavel: cpf, telefone: tel }).eq('id', prest.id); }
  obUsuario = { ...obUsuario, nome };
  obStep++; obSalvarStep(); renderObStep();
}

async function obPularBanco() { obStep++; obSalvarStep(); renderObStep(); }

async function obSalvarBanco() {
  const banco      = document.getElementById('ob-banco').value;
  const agencia    = document.getElementById('ob-agencia').value;
  const conta      = document.getElementById('ob-conta').value;
  const tipo_conta = document.getElementById('ob-tipo-conta').value;
  const pix        = document.getElementById('ob-pix').value;
  const { data: prest } = await sb.from('prestadores').select('id').eq('usuario_id', currentUser.id).single();
  if (prest && banco) { await sb.from('prestadores').update({ banco, agencia, conta, tipo_conta, pix }).eq('id', prest.id); }
  obStep++; obSalvarStep(); renderObStep();
}

async function obSalvarAceite() {
  const aceite = document.getElementById('ob-aceite').checked;
  if (!aceite) { alert('Você precisa aceitar a política para continuar.'); return; }
  await sb.from('usuarios').update({ aceite_politica_em: new Date().toISOString() }).eq('id', currentUser.id);
  obStep++; obSalvarStep(); renderObStep();
}

async function obSalvarSenha() {
  const s1 = document.getElementById('ob-senha').value;
  const s2 = document.getElementById('ob-senha2').value;
  const st = document.getElementById('ob-senha-status');
  if (s1.length < 8) { st.className = 'status-box status-err'; st.style.display = 'block'; st.textContent = 'A senha deve ter pelo menos 8 caracteres.'; return; }
  if (s1 !== s2) { st.className = 'status-box status-err'; st.style.display = 'block'; st.textContent = 'As senhas não conferem.'; return; }
  st.className = 'status-box status-warn'; st.style.display = 'block'; st.textContent = 'Salvando...';
  const { error } = await sb.auth.updateUser({ password: s1 });
  if (error) { st.className = 'status-box status-err'; st.style.display = 'block'; st.textContent = 'Erro: ' + error.message; return; }
  obStep++; obSalvarStep(); renderObStep();
}

async function obConcluir() {
  await sb.from('usuarios').update({ onboarding_concluido: true, onboarding_step: 5 }).eq('id', currentUser.id);
  const { data: usuario } = await sb.from('usuarios').select('*').eq('id', currentUser.id).single();
  if (usuario) await setupApp(usuario);
}
