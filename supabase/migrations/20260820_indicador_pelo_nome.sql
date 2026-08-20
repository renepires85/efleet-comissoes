-- O indicador passa a vir do relatório do Data Lake, pelo nome.
--
-- Até aqui o único jeito de ligar um cliente a um indicador era o vínculo
-- manual em `clientes_indicadores`, cliente a cliente. Isso não escala: cada
-- cliente novo de um indicador exigia alguém lembrar de cadastrar, e enquanto
-- não cadastrasse a comissão simplesmente não existia — sem erro, sem aviso.
--
-- O Data Lake já tem a coluna `indicador` no cadastro do cliente. Passamos a
-- lê-la e casá-la por nome com match_prestador_por_nome — o mesmo caminho que
-- o vendedor sempre usou (e que ignora acento, desde a correção que descobriu
-- a Vitória sem comissão).
--
-- PRECEDÊNCIA: o vínculo manual vence. Ele é uma decisão explícita de alguém da
-- gestão para um caso que a origem não cobre — como o RODOTEC ligado ao Bruno.
-- O nome do Data Lake cobre o resto, automaticamente.

alter table public.fechamentos
  add column if not exists indicador_nome text;

comment on column public.fechamentos.indicador_nome is
  'Nome do indicador como veio do Data Lake. Resolvido por match_prestador_por_nome quando não há vínculo manual em clientes_indicadores.';

create or replace function public.inserir_comissao_indicador(
  p_fechamento_id  uuid,
  p_periodo_inicio date,
  p_periodo_fim    date,
  p_cliente_cnpj   text,
  p_cliente_nome   text,
  p_produto        text,
  p_data_ativacao  date,
  p_mes_curva      integer,
  p_base_calculo   numeric,
  p_status_cliente text
)
returns void
language plpgsql
security definer
as $function$
declare
  v_indicador_id  uuid;
  v_indicador_bi  text;
  v_contrato      record;
  v_taxa          numeric;
  v_comissao      numeric;
  v_status        text;
begin
  -- 1. Vínculo manual: decisão explícita, tem precedência.
  select ci.indicador_id into v_indicador_id
  from public.clientes_indicadores ci
  where ci.cliente_cnpj = p_cliente_cnpj;

  -- 2. Sem vínculo manual, usa o nome que veio do Data Lake no fechamento.
  if v_indicador_id is null then
    select f.indicador_nome into v_indicador_bi
    from public.fechamentos f
    where f.id = p_fechamento_id;

    if coalesce(trim(v_indicador_bi), '') <> '' then
      v_indicador_id := public.match_prestador_por_nome(v_indicador_bi);
    end if;
  end if;

  if v_indicador_id is null then
    return;
  end if;

  -- Indicador INATIVO não é filtrado aqui de propósito. No fechamento a regra
  -- acordada é que parceiro inativo entra no cálculo e some apenas das telas
  -- (comissões e total a pagar). Só a prévia, que é projeção, o descarta antes.
  select * into v_contrato
  from public.contratos_indicadores
  where prestador_id = v_indicador_id and status = 'ativo'
  order by data_inicio desc
  limit 1;

  -- `found` e não `v_contrato is null`: numa variável de registro, IS NULL só é
  -- verdadeiro quando TODAS as colunas são nulas. A forma com IS NOT NULL já
  -- derrubou o cálculo do indicador na prévia, em silêncio.
  if not found then
    return;
  end if;

  if not (p_produto = any(v_contrato.produtos_elegiveis)) then
    return;
  end if;

  if p_mes_curva > v_contrato.periodo_recorrencia then
    return;
  end if;

  -- Indicador recebe percentual cheio: sem Curva C, sem rampa.
  v_taxa     := v_contrato.percentual_comissao / 100.0;
  v_comissao := p_base_calculo * v_taxa;
  v_status   := case
    when p_status_cliente = 'churn'        then 'zerada'
    when p_status_cliente = 'inadimplente' then 'suspensa'
    else 'calculada'
  end;

  insert into public.comissoes (
    fechamento_id, prestador_id, periodo_inicio, periodo_fim,
    cliente_cnpj, cliente_nome, produto, data_ativacao,
    mes_curva, fator_ramp, base_calculo, taxa_comissao, comissao_bruta, status
  ) values (
    p_fechamento_id, v_indicador_id, p_periodo_inicio, p_periodo_fim,
    p_cliente_cnpj, p_cliente_nome, p_produto, p_data_ativacao,
    p_mes_curva, 1.0, p_base_calculo, v_taxa, v_comissao, v_status
  ) on conflict do nothing;
end;
$function$;
