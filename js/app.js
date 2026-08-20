// ── INIT ──────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {

  // Auth
  document.getElementById('login-btn').addEventListener('click', doLogin);
  document.getElementById('senha-input').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
  document.getElementById('email-input').addEventListener('keydown', e => { if (e.key === 'Enter') document.getElementById('senha-input').focus(); });
  document.getElementById('logout-btn').addEventListener('click', doLogout);

  // Nav
  document.getElementById('nav-comissoes').addEventListener('click', () => switchNav('comissoes'));
  document.getElementById('nav-arquivos').addEventListener('click', () => switchNav('arquivos'));
  document.getElementById('nav-checkpoints').addEventListener('click', () => switchNav('checkpoints'));
  document.getElementById('nav-prestadores').addEventListener('click', () => switchNav('prestadores'));
  document.getElementById('nav-solicitacoes').addEventListener('click', () => switchNav('solicitacoes'));

  // Tabs gestão
  document.getElementById('tab-btn-parceiros').addEventListener('click', function () { switchTab(this, 'tab-parceiros'); });
  document.getElementById('tab-btn-clientes').addEventListener('click', function () { switchTab(this, 'tab-clientes'); });
  document.getElementById('tab-btn-validacoes').addEventListener('click', function () { switchTab(this, 'tab-validacoes'); });
  document.getElementById('tab-btn-alertas').addEventListener('click', function () { switchTab(this, 'tab-alertas'); });

  // Upload
  document.getElementById('file-upload').addEventListener('change', function () { processarUpload(this); });
  document.getElementById('file-upload-arq').addEventListener('change', function () { processarUpload(this, true); });
  document.getElementById('btn-rodar').addEventListener('click', rodarCalculo);
  document.getElementById('btn-relatorio').addEventListener('click', exportarRelatorio);

  // Período
  document.getElementById('btn-periodo').addEventListener('click', togglePeriodoMenu);
  const labels = { mes_atual: 'Mês atual', ultimo_mes: 'Último mês', '3m': '3 meses', '6m': '6 meses', '12m': '12 meses', ano_atual: 'Ano atual', tudo: 'Todo o histórico' };
  Object.keys(labels).forEach(tipo => {
    const el = document.getElementById('opt-' + tipo);
    if (el) el.addEventListener('click', () => setPeriodo(tipo, labels[tipo]));
  });
  document.addEventListener('click', e => {
    if (!document.getElementById('btn-periodo')?.contains(e.target)) {
      const m = document.getElementById('periodo-menu');
      if (m) m.style.display = 'none';
    }
  });

  // Extrato por parceiro
  document.getElementById('select-parceiro').addEventListener('change', filtrarPorParceiro);

  // Prestadores
  document.getElementById('btn-novo-prestador').addEventListener('click', () => abrirModalPrestador());
  document.getElementById('btn-convidar').addEventListener('click', abrirModalConvite);
  document.getElementById('btn-fechar-prestador').addEventListener('click', fecharModalPrestador);
  document.getElementById('btn-cancelar-prestador').addEventListener('click', fecharModalPrestador);
  document.getElementById('btn-salvar-prestador').addEventListener('click', salvarPrestador);
  document.getElementById('f-tipo').addEventListener('change', toggleDoc);

  // Convite
  document.getElementById('btn-fechar-convite').addEventListener('click', fecharModalConvite);
  document.getElementById('btn-cancelar-convite').addEventListener('click', fecharModalConvite);
  document.getElementById('btn-enviar-convite').addEventListener('click', enviarConvite);

  // Contestar
  document.getElementById('btn-fechar-contestar').addEventListener('click', fecharModalContestar);
  document.getElementById('btn-cancelar-contestar').addEventListener('click', fecharModalContestar);
  document.getElementById('btn-confirmar-contestar').addEventListener('click', confirmarContestacao);
  document.getElementById('btn-fechar-baixa-alerta').addEventListener('click', fecharModalBaixaAlerta);
  document.getElementById('btn-cancelar-baixa-alerta').addEventListener('click', fecharModalBaixaAlerta);
  document.getElementById('btn-confirmar-baixa-alerta').addEventListener('click', confirmarBaixaAlerta);

  // Pagamento
  document.getElementById('btn-fechar-pagamento').addEventListener('click', fecharModalPagamento);
  document.getElementById('btn-cancelar-pagamento').addEventListener('click', fecharModalPagamento);
  document.getElementById('btn-confirmar-pagamento').addEventListener('click', confirmarPagamento);

  // Vendedor
  document.getElementById('btn-aprovar').addEventListener('click', aprovarComissoes);
  document.getElementById('btn-contestar').addEventListener('click', abrirModalContestar);
  document.getElementById('btn-dados-bancarios').addEventListener('click', abrirModalBanco);
  document.getElementById('btn-extrato-pdf').addEventListener('click', exportarExtratoPDF);

  // Checkpoints
  document.getElementById('btn-cp-voltar').addEventListener('click', fecharDetalheCheckpoint);
  document.getElementById('btn-cp-baixar').addEventListener('click', baixarCheckpoint);
  document.getElementById('cp-f-busca').addEventListener('input', renderCpDetalhe);
  document.getElementById('cp-f-produto').addEventListener('change', renderCpDetalhe);
  document.getElementById('cp-f-status').addEventListener('change', renderCpDetalhe);
  document.getElementById('cp-f-erro').addEventListener('change', renderCpDetalhe);
  document.getElementById('btn-cp-limpar').addEventListener('click', () => limparFiltrosCp());

  // Cadastros
  document.getElementById('pr-f-busca').addEventListener('input', renderPrestadores);
  document.getElementById('pr-f-parceiro').addEventListener('change', renderPrestadores);
  document.getElementById('pr-f-status').addEventListener('change', renderPrestadores);
  document.getElementById('pr-f-acesso').addEventListener('change', renderPrestadores);
  document.getElementById('btn-pr-limpar').addEventListener('click', limparFiltrosPrestadores);

  // ── VERIFICAR SESSÃO ────────────────────────────────────────────────────────
  const { data: { session } } = await sb.auth.getSession();
  // Sessão criada por link de recuperação serve só para trocar a senha.
  if (recuperacaoDeSenha) { await entrarModoRecuperacao(); return; }
  if (session) {
    currentUser = session.user;
    const { data: usuario } = await sb.from('usuarios').select('*').eq('id', session.user.id).single();
    // Mesma regra do login: sessão de acesso inativado não sobrevive a um
    // recarregamento. Sem isso, quem já estivesse dentro continuaria dentro.
    if (usuario && usuario.ativo === false) { await sb.auth.signOut(); return; }
    if (usuario) {
      currentPerfil = usuario.perfil;
      // Mesma trava do login: sessão restaurada de quem ainda está com a senha
      // provisória também para na tela de troca. Sem isso, bastava recarregar a
      // página para entrar sem trocar nada.
      if (usuario.senha_provisoria) exigirTrocaDeSenha(usuario);
      else await setupApp(usuario);
    }
  }
});
