-- Gera o checkpoint de um upload no banco, para o fechamento automático.
--
-- Até aqui o checkpoint só nascia no navegador (calcularCheckpoint em
-- js/uploads.js). Isso quebrava o fechamento automático de um jeito silencioso:
-- a tela de Arquivos deriva o badge "Calculado" da EXISTÊNCIA de um checkpoint
-- (uploads.js:262), não de uploads.status. Sem checkpoint, um fechamento já
-- calculado aparecia como "Pendente" com botão "Calcular", e a aba Checkpoints
-- ficava vazia — exatamente o que aconteceu com julho/2026.
--
-- Espelha a lógica do navegador: lê o que processar_comissoes já gravou e
-- reconstrói apenas a explicação do único caso que não deixa rastro em
-- `comissoes` — fechamento cujo vendedor não bateu com nenhum prestador.
-- Continua sem recalcular nada, para não virar mais uma cópia da regra.

create or replace function public.gerar_checkpoint(p_upload_id uuid)
returns jsonb
language plpgsql
security definer
as $function$
declare
  v_upload      record;
  v_detalhes    jsonb;
  v_calculadas  int;
  v_erros       int;
begin
  select * into v_upload from public.uploads where id = p_upload_id;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'upload_inexistente');
  end if;

  if exists (select 1 from public.checkpoints where upload_id = p_upload_id) then
    return jsonb_build_object('ok', false, 'motivo', 'checkpoint_ja_existe');
  end if;

  with linhas as (
    -- Comissões efetivamente gravadas
    select
      f.vendedor_nome, c.cliente_cnpj, c.cliente_nome, c.produto,
      c.mes_curva, c.fator_ramp,
      case when c.status = 'calculada' then c.comissao_bruta else 0 end as comissao,
      c.status,
      case
        when c.status = 'suspensa' then 'Cliente inadimplente — comissão suspensa'
        when c.status = 'zerada' and c.fator_ramp = 0 then 'Mês ' || c.mes_curva || ' fora da janela'
        else null
      end as erro
    from public.comissoes c
    join public.fechamentos f on f.id = c.fechamento_id
    where f.upload_id = p_upload_id

    union all

    -- Linhas cujo vendedor não casou com nenhum prestador: não viram comissão
    -- nenhuma, então precisam ser reconstruídas produto a produto.
    select
      f.vendedor_nome, f.cliente_cnpj, f.cliente_nome, prod.produto,
      null::int, null::numeric, 0::numeric, 'erro',
      'Prestador não encontrado'
    from public.fechamentos f
    cross join lateral (values
      ('FUEL',    f.ativacao_fuel,    f.receita_fuel),
      ('PASS',    f.ativacao_pass,    f.receita_pass),
      ('FINES',   f.ativacao_fines,   f.receita_fines),
      ('PREMIUM', f.ativacao_premium, f.receita_premium)
    ) as prod(produto, ativacao, receita)
    where f.upload_id = p_upload_id
      and f.prestador_id is null
      and coalesce(trim(f.vendedor_nome), '') <> ''
      and prod.ativacao is not null
      and prod.receita is not null
  )
  select
    coalesce(jsonb_agg(to_jsonb(l) order by l.vendedor_nome, l.cliente_nome), '[]'::jsonb),
    count(*) filter (where l.status = 'calculada'),
    count(*) filter (where l.status <> 'calculada')
  into v_detalhes, v_calculadas, v_erros
  from linhas l;

  insert into public.checkpoints (
    upload_id, periodo_inicio, periodo_fim,
    total_linhas, calculadas, nao_calculadas, detalhes, criado_por
  ) values (
    p_upload_id, v_upload.periodo_inicio, v_upload.periodo_fim,
    jsonb_array_length(v_detalhes), v_calculadas, v_erros,
    -- Array jsonb de verdade. Os checkpoints antigos guardam uma STRING JSON
    -- (o JSON.stringify do navegador), mas o leitor aceita as duas formas
    -- (uploads.js:412), então não vale replicar a esquisitice.
    v_detalhes, null
  );

  return jsonb_build_object(
    'ok', true, 'total_linhas', jsonb_array_length(v_detalhes),
    'calculadas', v_calculadas, 'nao_calculadas', v_erros
  );
end;
$function$;

-- Passa a gerar o checkpoint junto com o fechamento automático.
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
  v_checkpoint jsonb;
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

  return jsonb_build_object(
    'ok', true,
    'periodo', to_char(p_periodo_inicio, 'YYYY-MM'),
    'upload_id', v_upload_id,
    'linhas_fechamento', v_linhas,
    'comissoes_geradas', v_comissoes,
    'checkpoint', v_checkpoint
  );
end;
$function$;
