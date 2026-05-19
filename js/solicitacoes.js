// ── MODAL SOLICITAÇÃO (público) ───────────────────────────────────────────────
function abrirModalSolicitacao() {
  document.getElementById('sol-nome').value     = '';
  document.getElementById('sol-email').value    = '';
  document.getElementById('sol-telefone').value = '';
  document.getElementById('sol-tipo').value     = 'parceiro_comercial';
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
  const st       = document.getElementById('sol-status');
  const btn      = document.getElementById('btn-enviar-solicitacao');

  if (!nome || !email) {
    st.className = 'status-box status-err'; st.style.display = 'block';
    st.textContent = 'Preencha nome e e-mail.'; return;
  }

  btn.textContent = 'Enviando...'; btn.disabled = true;

  try {
    const { error } = await sb.from('solicitacoes_acesso').insert({ nome, email, telefone, tipo });
    if (error) throw new Error(error.message);
    await notificarGestaoSolicitacao({ nome, email, telefone, tipo });
    st.className = 'status-box status-ok'; st.style.display = 'block';
    st.textContent = '✓ Solicitação enviada! A equipe eFleet entrará em contato em breve.';
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

  document.getElementById('tbody-solicitacoes-pendentes').innerHTML = pendentes.length
    ? pendentes.map(s => `<tr>
        <td><strong style="color:#fff;">${s.nome}</strong></td>
        <td class="td-muted">${s.email}</td>
        <td class="td-muted">${s.telefone || '—'}</td>
        <td><span class="badge badge-blue">${tipoLabel(s.tipo)}</span></td>
        <td class="td-muted">${new Date(s.created_at).toLocaleDateString('pt-BR')}</td>
        <td style="display:flex;gap:6px;">
          <button class="btn btn-primary btn-sm" onclick="aprovarSolicitacao('${s.id}','${s.nome}','${s.email}','${s.tipo}')">✓ Aprovar</button>
          <button class="btn btn-danger btn-sm" onclick="rejeitarSolicitacao('${s.id}')">✗ Rejeitar</button>
        </td>
      </tr>`).join('')
    : '<tr><td colspan="6" class="loading">Nenhuma solicitação pendente.</td></tr>';

  document.getElementById('tbody-solicitacoes-historico').innerHTML = historico.length
    ? historico.map(s => `<tr>
        <td><strong style="color:#fff;">${s.nome}</strong></td>
        <td class="td-muted">${s.email}</td>
        <td><span class="badge badge-blue">${tipoLabel(s.tipo)}</span></td>
        <td><span class="badge ${s.status === 'aprovado' ? 'badge-green' : 'badge-red'}">${s.status === 'aprovado' ? '✓ Aprovado' : '✗ Rejeitado'}</span></td>
        <td class="td-muted">${new Date(s.created_at).toLocaleDateString('pt-BR')}</td>
      </tr>`).join('')
    : '<tr><td colspan="5" class="loading">Nenhum histórico.</td></tr>';
}

async function aprovarSolicitacao(id, nome, email, tipo) {
  if (!confirm(`Aprovar solicitação de ${nome} e enviar convite para ${email}?`)) return;
  const perfil = tipo === 'gestao' ? 'gestao' : 'vendedor';
  try {
    const { data: { session } } = await sb.auth.getSession();
    const res = await fetch(SMART_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}`, 'apikey': SUPABASE_ANON },
      body: JSON.stringify({ nome, email, perfil })
    });
    const result = await res.json();
    if (result.error) throw new Error(result.error);
    await sb.from('solicitacoes_acesso').update({ status: 'aprovado', updated_at: new Date().toISOString() }).eq('id', id);
    alert(`✓ Convite enviado para ${email}`);
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
