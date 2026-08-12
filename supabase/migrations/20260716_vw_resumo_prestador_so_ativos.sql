-- Regra de negócio: vendedor inativo não conta na tela de Comissões nem no
-- total a pagar. O cálculo continua existindo em `comissoes` e no checkpoint
-- (log de auditoria linha a linha) — só o resumo agregado por parceiro passa
-- a considerar apenas prestadores ativos.
--
-- vw_resumo_prestador alimenta: KPI "Total a pagar", KPI "Clientes ativos",
-- KPI "Suspensas", a aba "Por parceiro" e (via select-parceiro, que já
-- filtrava ativo=true) a aba "Por cliente" e o extrato individual.

create or replace view public.vw_resumo_prestador as
 SELECT c.prestador_id,
    p.nome AS prestador_nome,
    p.codigo AS prestador_codigo,
    c.periodo_inicio,
    c.periodo_fim,
    sum(
        CASE
            WHEN ((c.produto = 'FUEL'::text) AND (c.status = 'calculada'::text)) THEN c.comissao_bruta
            ELSE (0)::numeric
        END) AS comissao_fuel,
    sum(
        CASE
            WHEN ((c.produto <> 'FUEL'::text) AND (c.status = 'calculada'::text)) THEN c.comissao_bruta
            ELSE (0)::numeric
        END) AS comissao_mensalidades,
    sum(
        CASE
            WHEN (c.status = 'calculada'::text) THEN c.comissao_bruta
            ELSE (0)::numeric
        END) AS comissao_total,
    sum(
        CASE
            WHEN (c.status = 'suspensa'::text) THEN c.comissao_bruta
            ELSE (0)::numeric
        END) AS comissao_suspensa,
    count(DISTINCT c.cliente_cnpj) AS clientes_ativos,
    count(DISTINCT
        CASE
            WHEN (c.status = 'suspensa'::text) THEN c.cliente_cnpj
            ELSE NULL::text
        END) AS clientes_inadimplentes,
    count(DISTINCT
        CASE
            WHEN ((c.mes_curva >= 11) AND (c.status = 'calculada'::text)) THEN c.cliente_cnpj
            ELSE NULL::text
        END) AS clientes_encerrando
   FROM (comissoes c
     JOIN prestadores p ON ((p.id = c.prestador_id)))
  WHERE p.ativo = true
  GROUP BY c.prestador_id, p.nome, p.codigo, c.periodo_inicio, c.periodo_fim;
