-- Fechamento automático passa a criar as validações pendentes.
--
-- Terceira (e última) etapa que o fluxo do navegador fazia e o do servidor não:
-- depois de processar_comissoes, o upload manual chama criar_validacoes_pendentes
-- (js/uploads.js:49). Sem isso, o parceiro abre o extrato e não tem o botão
-- "Aprovar" — ele só aparece quando existe validação pendente do período.
--
-- Efeito prático em julho/2026: comissões corretas na tela, mas nenhum parceiro
-- conseguia aprovar, e portanto nada avançava para pagamento. Um fechamento que
-- calcula certo e trava no fim é pior que um que falha na cara — parece pronto.
--
-- As três etapas do fechamento agora vivem juntas em executar_fechamento_mensal:
--   1. processar_comissoes        → calcula
--   2. gerar_checkpoint           → explica o que não calculou
--   3. criar_validacoes_pendentes → habilita a aprovação do parceiro

create or replace function public.executar_fechamento_mensal(
  p_dados          jsonb,
  p_periodo_inicio date,
  p_origem         text default 'automatico'
)
returns jsonb
language plpgsql
security definer
as $function$
declare
  v_fim         date;
  v_upload_id   uuid;
  v_linhas      int := 0;
  v_comissoes   int;
  v_existentes  int;
  v_checkpoint  jsonb;
  v_validacoes  int;
begin
  v_fim := (date_trunc('month', p_periodo_inicio) + interval '1 month - 1 day')::date;

  select count(*) into v_existentes
  from public.fechamentos where periodo_inicio = date_trunc('month', p_periodo_inicio)::date;

  if v_existentes > 0 then
    return jsonb_build_object(
      'ok', false, 'motivo', 'periodo_ja_fechado',
      'periodo', to_char(p_periodo_inicio, 'YYYY-MM'),
      'linhas_existentes', v_existentes
    );
  end if;

  insert into public.uploads (nome_arquivo, periodo_inicio, periodo_fim, status, total_linhas)
  values (
    'Fechamento ' || p_origem || ' ' || to_char(p_periodo_inicio, 'MM/YYYY'),
    date_trunc('month', p_periodo_inicio)::date, v_fim, 'processando',
    jsonb_array_length(p_dados)
  )
  returning id into v_upload_id;

  insert into public.fechamentos (
    periodo_inicio, periodo_fim, vendedor_nome, cliente_cnpj, cliente_nome,
    ativacao_fuel, ativacao_pass, ativacao_fines, ativacao_premium,
    tpv_fuel, receita_fuel, receita_pass, receita_fines, receita_premium,
    status_cliente, upload_id
  )
  select
    date_trunc('month', p_periodo_inicio)::date, v_fim,
    x.vendedor_nome, x.cliente_cnpj, x.cliente_nome,
    nullif(x.ativacao_fuel,'')::date, nullif(x.ativacao_pass,'')::date,
    nullif(x.ativacao_fines,'')::date, nullif(x.ativacao_premium,'')::date,
    x.tpv_fuel, x.receita_fuel, x.receita_pass, x.receita_fines, x.receita_premium,
    case upper(trim(coalesce(x.situacao, '')))
      when 'ATIVO'     then 'ativo'
      when 'CANCELADO' then 'churn'
      else 'inadimplente'
    end,
    v_upload_id
  from jsonb_to_recordset(p_dados) as x(
    vendedor_nome    text,
    cliente_cnpj     text,
    cliente_nome     text,
    ativacao_fuel    text,
    ativacao_pass    text,
    ativacao_fines   text,
    ativacao_premium text,
    tpv_fuel         numeric,
    receita_fuel     numeric,
    receita_pass     numeric,
    receita_fines    numeric,
    receita_premium  numeric,
    situacao         text
  )
  where coalesce(trim(x.vendedor_nome), '') <> '';

  get diagnostics v_linhas = row_count;

  v_comissoes  := public.processar_comissoes(v_upload_id);
  v_checkpoint := public.gerar_checkpoint(v_upload_id);
  v_validacoes := public.criar_validacoes_pendentes(v_upload_id);

  return jsonb_build_object(
    'ok', true,
    'periodo', to_char(p_periodo_inicio, 'YYYY-MM'),
    'upload_id', v_upload_id,
    'linhas_fechamento', v_linhas,
    'comissoes_geradas', v_comissoes,
    'checkpoint', v_checkpoint,
    'validacoes_criadas', v_validacoes
  );
end;
$function$;
