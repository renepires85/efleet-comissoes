-- clientes_indicadores recebeu o mesmo grant de prestadores (sem DELETE),
-- mas aqui "desvincular um cliente" é uma ação real da UI — a RLS já
-- permite (policy "gestao tudo" é FOR ALL), faltava só o grant de tabela.
grant delete on public.clientes_indicadores to authenticated;
