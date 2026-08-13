-- Corrige um vínculo cliente→indicador semeado errado em 20260812_parceiro_indicador.sql.
--
-- Naquela migration eu tratei o CNPJ '118460530001440' (15 dígitos) como
-- corrupção de origem e "normalizei" para '11846053000144' (14 dígitos).
-- Estava errado: consultando prod_analytics.clientes na Data Lake, são
-- DOIS clientes distintos e reais:
--
--   cliente_id 1785 | DISTRIBUICAO E TRANSPORTES FERNANDO      | 11846053000144  | ATIVO     | repr. EDUARDO | sem indicador
--   cliente_id 1024 | DISTRIBUICAO E TRANSPORTES FERNANDO CAN  | 118460530001440 | CANCELADO | repr. LUIZ    | indicador CLAUDIO
--
-- O sufixo "CAN" e o zero extra no CNPJ são a convenção do sistema de origem
-- para liberar o CNPJ quando um cliente cancela e volta a se cadastrar.
--
-- Efeito do erro: CLAUDIO ficou vinculado ao cliente ATIVO (do EDUARDO), e não
-- ao cancelado. Nenhuma comissão indevida chegou a ser paga porque o contrato
-- do CLAUDIO está 'pendente' com 0%, mas isso pagaria errado assim que fosse
-- ativado. Corrigido aqui antes disso.

delete from public.clientes_indicadores where cliente_cnpj = '11846053000144';

insert into public.clientes_indicadores (cliente_cnpj, indicador_id)
select '118460530001440', p.id
from public.prestadores p
where p.nome = 'CLAUDIO' and p.tipo_parceiro = 'indicador'
on conflict (cliente_cnpj) do nothing;
