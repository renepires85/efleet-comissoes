-- Nenhuma tabela do schema public tinha SELECT/UPDATE/DELETE para service_role:
-- só INSERT em algumas, mais REFERENCES/TRIGGER/TRUNCATE. É o efeito de criar
-- tabelas com "Automatically expose new tables" desmarcado — o GRANT padrão do
-- Supabase não é aplicado.
--
-- Consequência prática: toda Edge Function que usa SUPABASE_SERVICE_ROLE_KEY
-- lia zero linhas em silêncio. A clever-handler respondia "Prestador não
-- encontrado" para qualquer id válido, porque o select devolvia vazio.
--
-- service_role já tem BYPASSRLS por definição; o GRANT completo é a
-- configuração que o Supabase aplica por padrão.

grant all on all tables    in schema public to service_role;
grant all on all sequences in schema public to service_role;
grant all on all functions in schema public to service_role;

-- Tabelas criadas daqui em diante já nascem com o grant correto.
alter default privileges in schema public grant all on tables    to service_role;
alter default privileges in schema public grant all on sequences to service_role;
alter default privileges in schema public grant all on functions to service_role;
