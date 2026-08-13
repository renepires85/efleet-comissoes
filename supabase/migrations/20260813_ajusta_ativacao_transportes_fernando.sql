-- Ajuste de comissão a pedido da gestão, com apuração feita na origem.
--
-- Contexto: DISTRIBUICAO E TRANSPORTES FERNANDO entrou em churn e voltou por
-- nova negociação, com CADASTRO NOVO. Regra de negócio confirmada pela
-- gestão: cadastro novo = cliente novo, Curva C recomeça do zero.
--
-- Na Data Lake (prod_analytics) são dois cadastros distintos:
--   1024 | ...FERNANDO CAN | 118460530001440 | CANCELADO | repr. LUIZ    | indicador CLAUDIO
--   1785 | ...FERNANDO     | 11846053000144  | ATIVO     | repr. EDUARDO | sem indicador
--
-- Toda a receita até julho/2026 é do cadastro ANTIGO (1024). O cadastro novo
-- (1785) só passou a transacionar em 11/08/2026 — 14 transações, R$ 516,69.
--
-- Consequência: a comissão de junho atribuída ao EDUARDO (R$ 297,18 sobre
-- R$ 3.714,70) veio de receita do cadastro antigo, que era do LUIZ. Pela
-- regra acima, não é devida — o cliente novo dele ainda não existia
-- comercialmente em junho.
--
-- Correção: ativacao_fuel do cadastro novo passa a 2026-08-11 (primeira
-- transação real). Com isso, junho vira mes_curva 0 → fator 0% → comissão
-- zerada pela própria regra do sistema, sem edição manual de valor. A partir
-- de agosto a Curva C começa em 1/12 (20%), como cliente novo.
--
-- Nenhum pagamento precisa ser estornado: as duas validações do EDUARDO
-- estavam 'pendente', nunca aprovadas nem pagas.

update public.fechamentos
set    ativacao_fuel = '2026-08-11'
where  id = 'eb74a66a-779b-4c8f-9de5-c1ea45081ca7';

-- Remove a comissão para que processar_comissoes a recalcule com a data nova
-- (o insert usa ON CONFLICT DO NOTHING, então não sobrescreveria sozinho).
delete from public.comissoes
where  id = '5213c47e-e26b-4712-a0ea-10e24a2180a6';

select public.processar_comissoes('e81ce762-7b9e-43e0-ad2b-a25d2a80ae95');
