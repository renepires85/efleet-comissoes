-- Corrige bug financeiro: match_prestador_por_nome não ignorava acentos, então
-- vendedora ATIVA ficava sem comissão.
--
-- Caso real: o arquivo do BI traz 'VITORIA MARTINS' (sem acento, como o
-- sistema de origem grava), e o cadastro no Argos é 'Vitória Thalia Lopes
-- Martins'. Os três níveis do match falhavam:
--   1. exato     — 'vitoria martins' <> 'vitória thalia lopes martins'
--   2. substring — 'vitória...' não contém 'vitoria martins'
--   3. palavras  — 'vitoria' não é substring de 'vitória' (o acento quebra)
--
-- Resultado: ela nunca recebeu comissão em nenhum fechamento — 0 linhas em
-- `comissoes`, apesar de ter clientes com receita todo mês. Como esta função
-- é usada por processar_comissoes E pela prévia, o conserto vale para os dois.

create extension if not exists unaccent with schema extensions;

create or replace function public.match_prestador_por_nome(p_nome text)
returns uuid
language sql
stable
as $function$
  with alvo as (
    select lower(extensions.unaccent(trim(p_nome))) as nome
  )
  select p.id
  from (
    -- prio 1: exato, ignorando caixa e acento
    select p1.id, 1 as prio
    from public.prestadores p1, alvo a
    where lower(extensions.unaccent(trim(p1.nome))) = a.nome
    union all
    -- prio 2: cadastro contém o nome do arquivo — só se o match for único
    select p2.id, 2
    from (
      select px.id, count(*) over () as qtd
      from public.prestadores px, alvo a
      where lower(extensions.unaccent(px.nome)) like '%' || a.nome || '%'
    ) p2
    where p2.qtd = 1
    union all
    -- prio 3: todas as palavras do arquivo aparecem no cadastro — só se único
    select p3.id, 3
    from (
      select px.id, count(*) over () as qtd
      from public.prestadores px, alvo a
      where (select bool_and(lower(extensions.unaccent(px.nome)) like '%' || w || '%')
             from unnest(string_to_array(a.nome, ' ')) as w)
    ) p3
    where p3.qtd = 1
  ) p
  order by p.prio
  limit 1
$function$;
