-- Leva à comissão fechada os mesmos dados que a prévia já mostra na ficha do
-- cliente: data da 1ª transação/mensalidade e TPV do mês.
--
-- Os dois já existiam, só não chegavam à tela:
--   data_ativacao — está em `comissoes`, a view simplesmente não a projetava.
--   tpv_fuel      — está em `fechamentos`, a origem da linha de comissão.
--
-- Ampliar a view resolve as duas telas de uma vez (extrato do parceiro e tabela
-- por cliente da gestão), porque ambas leem daqui. Nenhuma consulta do
-- navegador muda: as duas usam select('*').
--
-- O TPV só existe para FUEL — mensalidade não tem volume transacionado, tem
-- valor cobrado. Fica nulo nos demais produtos, e a ficha omite a linha.

create or replace view public.vw_extrato_prestador as
  select
    c.prestador_id,
    c.periodo_inicio,
    c.periodo_fim,
    c.cliente_cnpj,
    c.cliente_nome,
    c.produto,
    c.mes_curva,
    c.fator_ramp,
    c.base_calculo,
    c.taxa_comissao,
    c.comissao_bruta,
    c.status,
    c.data_ativacao,
    case when c.produto = 'FUEL' then f.tpv_fuel end as tpv
  from public.comissoes c
  left join public.fechamentos f on f.id = c.fechamento_id
  order by c.periodo_fim desc, c.cliente_nome, c.produto;

grant select on public.vw_extrato_prestador to authenticated, anon;
