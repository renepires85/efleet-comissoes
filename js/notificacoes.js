// ── NOTIFICAR PARCEIRO ────────────────────────────────────────────────────────
// Extrai a mensagem de erro que a Edge Function devolve, com fallback no status.
async function lerErro(res) {
  const txt = await res.text();
  try { return JSON.parse(txt).error || txt; } catch { return txt || `HTTP ${res.status}`; }
}

async function notificarEmail(prestadorId, periodo) {
  const ctrl = new AbortController();
  const corte = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch(CLEVER_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + SUPABASE_ANON,
        'apikey': SUPABASE_ANON
      },
      body: JSON.stringify({
        action: 'notificar_parceiro',
        prestador_id: prestadorId,
        periodo
      }),
      signal: ctrl.signal
    });
    if (!res.ok) throw new Error(await lerErro(res));
    const r = await res.json().catch(() => ({}));
    if (r.ok === false) throw new Error(r.error || 'falha desconhecida');
    if (r.enviados === 0) throw new Error(r.motivo || 'nenhum e-mail enviado');
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('tempo esgotado ao contatar o serviço de e-mail');
    console.error('Erro ao notificar:', e);
    throw e;
  } finally {
    clearTimeout(corte);
  }
}

async function notificarParceiro(prestadorId) {
  if (!confirm('Enviar notificação por e-mail para este parceiro?')) return;
  try {
    const { fim } = getPeriodoDates(periodoAtual);
    const periodo = new Date(fim).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
    await notificarEmail(prestadorId, periodo);
    alert('✓ E-mail enviado com sucesso!');
  } catch (e) {
    alert('✗ Erro: ' + e.message);
  }
}

async function notificarParceiroValidacao(prestadorId) {
  await notificarParceiro(prestadorId);
}

// ── NOTIFICAR GESTÃO (nova solicitação) ───────────────────────────────────────
// Falha aqui não interrompe o cadastro do solicitante — só registra no console.
async function notificarGestaoSolicitacao(solicitacao) {
  const ctrl = new AbortController();
  const corte = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch(CLEVER_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_ANON,
        'Authorization': 'Bearer ' + SUPABASE_ANON
      },
      body: JSON.stringify({ action: 'nova_solicitacao', solicitacao }),
      signal: ctrl.signal
    });
    if (!res.ok) console.error('Gestão não notificada:', await lerErro(res));
  } catch (e) {
    console.error('Erro ao notificar gestão:', e);
  } finally {
    clearTimeout(corte);
  }
}
