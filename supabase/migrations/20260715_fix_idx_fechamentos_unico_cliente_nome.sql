-- O CSV do BI traz filiais distintas com o MESMO CNPJ (ex: RODOFROTA "FROTA LEVE"
-- e "MATRIZ", ambas 17877334000140), o que violava o índice único
-- (vendedor_nome, cliente_cnpj, periodo_inicio, periodo_fim) e derrubava o
-- insert do upload inteiro. Incluir cliente_nome na chave mantém a proteção
-- contra reimportação do mesmo período e permite filiais com CNPJ compartilhado.

drop index if exists public.idx_fechamentos_unico;

create unique index idx_fechamentos_unico
  on public.fechamentos (vendedor_nome, cliente_cnpj, cliente_nome, periodo_inicio, periodo_fim);
