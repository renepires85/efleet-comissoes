// ── NOTIFICAR PARCEIRO ────────────────────────────────────────────────────────
async function notificarEmail(prestadorId, periodo) {
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
      })
    });
    await res.text();
  } catch (e) {
    console.error('Erro ao notificar:', e);
    throw e;
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
async function notificarGestaoSolicitacao(solicitacao) {
  try {
    const res = await fetch(CLEVER_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_ANON,
        'Authorization': 'Bearer ' + SUPABASE_ANON
      },
      body: JSON.stringify({ action: 'nova_solicitacao', solicitacao })
    });
    await res.text();
  } catch (e) {
    console.error('Erro ao notificar gestão:', e);
  }
}
