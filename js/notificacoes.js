// ── NOTIFICAR PARCEIRO ────────────────────────────────────────────────────────
async function notificarEmail(prestadorId, periodo) {
  try {
    await fetch(CLEVER_URL, {
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
  } catch (e) {
    console.error('Erro ao notificar:', e);
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
    await fetch(CLEVER_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_ANON,
        'Authorization': 'Bearer ' + SUPABASE_ANON
      },
      body: JSON.stringify({ action: 'nova_solicitacao', solicitacao })
    });
  } catch (e) {
    console.error('Erro ao notificar gestão:', e);
  }
}
