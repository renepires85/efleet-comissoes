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

// Notificação a partir de uma LINHA de validação — e não do filtro da tela.
//
// Dois defeitos morriam aqui juntos:
//
// 1. Nenhuma checagem de valor. Notificar uma validação sem comissão manda ao
//    parceiro "suas comissões de <mês> estão disponíveis" para algo que não
//    existe. É o mesmo erro do aviso na tela e do lembrete diário, pela
//    terceira porta — a que a própria gestão abre, achando que está cobrando.
//
// 2. O mês vinha de `periodoAtual`, o filtro do dashboard, não da linha
//    clicada. Notificar uma pendência de julho com a tela em "mês atual"
//    mandava um e-mail falando de agosto.
async function notificarParceiroValidacao(validacaoId) {
  const { data: v, error } = await sb.from('validacoes_mensais')
    .select('prestador_id, periodo_inicio, periodo_fim, prestadores(nome)')
    .eq('id', validacaoId).single();
  if (error || !v) { alert('✗ Não foi possível ler a validação: ' + (error?.message || 'não encontrada')); return; }

  const { data: coms } = await sb.from('comissoes')
    .select('comissao_bruta')
    .eq('prestador_id', v.prestador_id)
    .eq('periodo_inicio', v.periodo_inicio)
    .eq('status', 'calculada');

  const total = (coms || []).reduce((s, c) => s + Number(c.comissao_bruta || 0), 0);
  const periodo = formatPeriodo(v.periodo_inicio, v.periodo_fim);

  if (!(total > 0)) {
    alert(`Esta validação de ${periodo} não tem comissão calculada — não há o que o parceiro aprovar.\n\n` +
          `Notificar mandaria um e-mail dizendo que a comissão está disponível, para um valor que não existe. ` +
          `Confira o fechamento do período antes de cobrar a aprovação.`);
    return;
  }

  if (!confirm(`Enviar e-mail para ${v.prestadores?.nome || 'o parceiro'} sobre ${periodo} (${fmtR(total)})?`)) return;
  try {
    await notificarEmail(v.prestador_id, periodo);
    alert('✓ E-mail enviado com sucesso!');
  } catch (e) {
    alert('✗ Erro: ' + e.message);
  }
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
