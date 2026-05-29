// ── MODAL SOLICITAÇÃO (público) ───────────────────────────────────────────────
function abrirModalSolicitacao() {
  document.getElementById('sol-nome').value     = '';
  document.getElementById('sol-email').value    = '';
  document.getElementById('sol-telefone').value = '';
  document.getElementById('sol-tipo').value     = 'parceiro_comercial';
  document.getElementById('sol-senha').value    = '';
  document.getElementById('sol-senha2').value   = '';
  const st = document.getElementById('sol-status');
  st.style.display = 'none'; st.className = 'status-box';
  document.getElementById('modal-solicitacao').style.display = 'flex';
}

function fecharModalSolicitacao() {
  document.getElementById('modal-solicitacao').style.display = 'none';
}

async function enviarSolicitacao() {
  const nome     = document.getElementById('sol-nome').value.trim();
  const email    = document.getElementById('sol-email').value.trim();
  const telefone = document.getElementById('sol-telefone').value.trim();
  const tipo     = document.getElementById('sol-tipo').value;
  const senha    = document.getElementById('sol-senha').value;
  const senha2   = document.getElementById('sol-senha2').value;
  const st       = document.getElementById('sol-status');
  const btn      = document.getElementById('btn-enviar-solicitacao');

  if (!nome || !email) {
    st.className = 'status-box status-err'; st.style.display = 'block';
    st.textContent = 'Preencha nome e e-mail.'; return;
  }
  if (senha.length < 8) {
    st.className = 'status-box status-err'; st.style.display = 'block';
    st.textContent = 'A senha deve ter pelo menos 8 caracteres.'; return;
  }
  if (senha !== senha2) {
    st.className = 'status-box status-err'; st.style.display = 'block';
    st.textContent = 'As senhas não conferem.'; return;
  }

  btn.textContent = 'Enviando...'; btn.disabled = true;

  try {
    const { error } = await sb.from('solicitacoes_acesso').insert({ nome, email, telefone, tipo, senha_hash: senha });
    if (error) throw new Error(error.message);

    await notificarGestaoSolicitacao({ nome, email, telefone, tipo });

    st.className = 'status-box status-ok'; st.style.display = 'block';
    st.textContent = '✓ Solicitação enviada! Você receberá um e-mail quando o acesso for liberado.';
    btn.textContent = 'Enviado';
  } catch (e) {
    st.className = 'status-box status-err'; st.style.display = 'block';
    st.textContent = '✗ Erro: ' + e.message;
    btn.textContent = 'Enviar solicitação'; btn.disabled = false;
  }
}

// ── PAINEL GESTÃO ─────────────────────────────────────────────────────────────
async function carregarSolicitacoes() {
  const { data } = await sb.from('solicitacoes_acesso').select('*').order('created_at', { ascending: false });
  if (!data) return;

  const pendentes = data.filter(s => s.status === 'pendente');
  const historico = data.filter(s => s.status !== 'pendente');
  const tipoLabel = t => t === 'gestao' ? 'Gestão' : 'Parceiro Comercial';

  // Bug #3 — badge vermelho com contagem de pedidos pendentes
  const navBtn = document.getElementById('nav-solicitacoes');
  const badgeExistente = navBtn.querySelector('.nav-badge');
  if (badgeExistente) badgeExistente.remove();
  if (pendentes.length > 0) {
    const badge = document.createElement('span');
    badge.className = 'nav-badge';
    badge.textContent = pendentes.length;
    badge.style.cssText = 'background:var(--efl-red);color:#fff;font-family:var(--efl-font-head);font-size:10px;font-weight:800;min-width:18px;height:18px;border-radius:999px;display:inline-flex;align-items:center;justify-content:center;padding:0 5px;margin-left:6px;';
    navBtn.appendChild(badge);
  }

  document.getElementById('tbody-solicitacoes-pendentes').innerHTML = pendentes.length
    ? pendentes.map(s => `<tr>
        <td><strong style="color:#fff;">${s.nome}</strong></td>
        <td class="td-muted">${s.email}</td>
        <td class="td-muted">${s.telefone || '—'}</td>
        <td><span class="badge badge-blue">${tipoLabel(s.tipo)}</span></td>
        <td class="td-muted">${new Date(s.created_at).toLocaleDateString('pt-BR')}</td>
        <td style="display:flex;gap:6px;">
          <button class="btn btn-primary btn-sm" onclick="aprovarSolicitacao('${s.id}','${s.nome}','${s.email}','${s.tipo}','${s.senha_hash}')">✓ Aprovar</button>
          <button class="btn btn-danger btn-sm" onclick="rejeitarSolicitacao('${s.id}')">✗ Rejeitar</button>
        </td>
      </tr>`).join('')
    : '<tr><td colspan="6" class="loading">Nenhuma solicitação pendente.</td></tr>';

  document.getElementById('tbody-solicitacoes-historico').innerHTML = historico.length
    ? historico.map(s => `<tr>
        <td><strong style="color:#fff;">${s.nome}</strong></td>
        <td class="td-muted">${s.email}</td>
        <td><span class="badge badge-blue">${tipoLabel(s.tipo)}</span></td>
        <td><span class="badge ${s.status === 'aprovado' ? 'badge-green' : s.status === 'ja_cadastrado' ? 'badge-yellow' : 'badge-red'}">${s.status === 'aprovado' ? '✓ Aprovado' : s.status === 'ja_cadastrado' ? '⚠️ Já cadastrado' : '✗ Rejeitado'}</span></td>
        <td class="td-muted">${new Date(s.created_at).toLocaleDateString('pt-BR')}</td>
      </tr>`).join('')
    : '<tr><td colspan="5" class="loading">Nenhum histórico.</td></tr>';
}

async function aprovarSolicitacao(id, nome, email, tipo, senha) {
  if (!confirm(`Aprovar acesso de ${nome} (${email})?`)) return;

  const perfil = tipo === 'gestao' ? 'gestao' : 'vendedor';

  try {
    const { data: { session } } = await sb.auth.getSession();
    const res = await fetch(SMART_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`,
        'apikey': SUPABASE_ANON
      },
      body: JSON.stringify({ nome, email, perfil, senha })
    });
    const result = await res.json();

    // E-mail já cadastrado — move para histórico sem travar
    if (result.error && result.error.includes('already been registered')) {
      await sb.from('solicitacoes_acesso').update({
        status: 'ja_cadastrado',
        updated_at: new Date().toISOString()
      }).eq('id', id);
      alert(`⚠️ Este e-mail já possui acesso ao sistema. A solicitação foi arquivada.`);
      await carregarSolicitacoes();
      return;
    }

    if (result.error) throw new Error(result.error);

    await sb.from('solicitacoes_acesso').update({
      status: 'aprovado',
      updated_at: new Date().toISOString()
    }).eq('id', id);

    alert(`✓ Acesso liberado para ${email}. Um e-mail foi enviado com as instruções.`);
    await carregarSolicitacoes();
  } catch (e) {
    alert('✗ Erro: ' + e.message);
  }
}

async function rejeitarSolicitacao(id) {
  if (!confirm('Rejeitar esta solicitação?')) return;
  const { data: { session } } = await sb.auth.getSession();
  await sb.from('solicitacoes_acesso').update({
    status: 'rejeitado',
    rejeitado_por: session.user.email,
    updated_at: new Date().toISOString()
  }).eq('id', id);
  await carregarSolicitacoes();
}
