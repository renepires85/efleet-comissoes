async function salvarPrestador() {
  const id = document.getElementById('f-id').value;
  const ativo = document.getElementById('f-status').value === 'true';
  const payload = {
    nome:            document.getElementById('f-nome').value,
    tipo:            document.getElementById('f-tipo').value,
    documento:       document.getElementById('f-doc').value,
    email:           document.getElementById('f-email').value,
    cpf_responsavel: document.getElementById('f-cpf').value,
    telefone:        document.getElementById('f-telefone').value,
    banco:           document.getElementById('f-banco').value,
    agencia:         document.getElementById('f-agencia').value,
    conta:           document.getElementById('f-conta').value,
    tipo_conta:      document.getElementById('f-tipo-conta').value,
    pix:             document.getElementById('f-pix').value,
    ativo
  };

  let error;
  if (id) {
    // Busca o estado atual antes de salvar para comparar o campo ativo
    const { data: prestadorAtual } = await sb.from('prestadores').select('ativo, usuario_id').eq('id', id).single();
    ({ error } = await sb.from('prestadores').update(payload).eq('id', id));
    if (error) { alert('Erro: ' + error.message); return; }

    // Se o campo ativo mudou e tem usuario_id, bane ou desbane no Auth
    console.log('ativo atual:', prestadorAtual?.ativo, typeof prestadorAtual?.ativo);
console.log('ativo novo:', ativo, typeof ativo);
console.log('mudou?', prestadorAtual?.ativo !== ativo);
if (prestadorAtual && prestadorAtual.ativo !== ativo && prestadorAtual.usuario_id) {
      try {
        const { data: { session } } = await sb.auth.getSession();
        const res = await fetch(SMART_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session.access_token}`,
            'apikey': SUPABASE_ANON
          },
          body: JSON.stringify({
            action: 'atualizar_usuario',
            usuario_id: prestadorAtual.usuario_id,
            ativo
          })
        });
        const result = await res.json();
        if (result.error) throw new Error(result.error);
      } catch (e) {
        alert(`⚠️ Cadastro salvo mas erro ao ${ativo ? 'reativar' : 'bloquear'} acesso: ${e.message}`);
      }
    }
  } else {
    const { data: cod } = await sb.rpc('gerar_codigo_prestador', { p_nome: payload.nome });
    payload.codigo = cod;
    ({ error } = await sb.from('prestadores').insert(payload));
    if (error) { alert('Erro: ' + error.message); return; }
  }

  fecharModalPrestador();
  await carregarPrestadores();
}
