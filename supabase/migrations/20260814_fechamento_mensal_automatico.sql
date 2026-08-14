-- Fechamento mensal automático.
--
-- Recebe do Metabase (via Edge Function) a receita já consolidada de um mês
-- fechado e reproduz exatamente o que o upload manual fazia: cria o registro
-- de upload, grava as linhas em `fechamentos` e chama processar_comissoes().
-- Nenhuma regra de comissão vive aqui — a Curva C, as taxas e o indicador
-- continuam em processar_comissoes/inserir_comissao_indicador.
--
-- TRÊS ARMADILHAS que o upload manual escondia e que precisam de tratamento
-- explícito aqui, porque errar qualquer uma gera comissão indevida em silêncio:
--
--   1. status_cliente é gravado em MINÚSCULO ('ativo'/'inadimplente'/'churn').
--      processar_comissoes compara com minúsculo; se viesse capitalizado do
--      Metabase, cliente em churn passaria como normal e geraria valor a pagar.
--
--   2. A origem tem 6 situações, não 3. Além de ATIVO/BLOQUEADO/CANCELADO
--      existem PROCESSO JURÍDICO, BLOQUEIO AUTOMATICO SISTEMA e situação NULA.
--      Sem mapear, todas cairiam no `else` e seriam tratadas como ativas.
--      Optamos por 'inadimplente' (suspensa) no desconhecido: suspender é
--      reversível, pagar não.
--
--   3. processar_comissoes só calcula um produto se ativacao_X E receita_X
--      estiverem preenchidas. As ativações de PASS/FINES/PREMIUM vêm do
--      MIN(receita_date) histórico por fonte — sem elas, esses produtos seriam
--      ignorados sem nenhum aviso.

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
  v_fim        date;
  v_upload_id  uuid;
  v_linhas     int := 0;
  v_comissoes  int;
  v_existentes int;
begin
  v_fim := (date_trunc('month', p_periodo_inicio) + interval '1 month - 1 day')::date;

  -- Idempotência: nunca fecha duas vezes o mesmo mês. O índice único de
  -- fechamentos já barraria, mas aqui o erro fica legível em vez de virar
  -- violação de constraint no meio do lote.
  select count(*) into v_existentes
  from public.fechamentos where periodo_inicio = date_trunc('month', p_periodo_inicio)::date;

  if v_existentes > 0 then
    return jsonb_build_object(
      'ok', false,
      'motivo', 'periodo_ja_fechado',
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
    -- Armadilhas 1 e 2: minúsculo, e desconhecido vira inadimplente (suspensa).
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

  v_comissoes := public.processar_comissoes(v_upload_id);

  return jsonb_build_object(
    'ok', true,
    'periodo', to_char(p_periodo_inicio, 'YYYY-MM'),
    'upload_id', v_upload_id,
    'linhas_fechamento', v_linhas,
    'comissoes_geradas', v_comissoes
  );
end;
$function$;
