-- Relatório semanal por e-mail para a gestão: pendências de fechamento
-- (uploads ainda não calculados) e aprovações pendentes (validações
-- aguardando o parceiro ou já contestadas). Destinatários: todo usuário
-- com perfil='gestao' e ativo=true.

-- ── 1. Extensões para agendamento ──────────────────────────────────────────────
create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net  with schema extensions;

-- ── 2. E-mails dos gestores ativos ─────────────────────────────────────────────
-- auth.users não é acessível pela Edge Function via anon/authenticated; esta
-- função roda SECURITY DEFINER e faz o join que a clever-handler não
-- conseguiria fazer sozinha.
create or replace function public.emails_gestao()
returns table(nome text, email text)
language sql
security definer
as $function$
  select u.nome, au.email
  from public.usuarios u
  join auth.users au on au.id = u.id
  where u.perfil = 'gestao' and u.ativo = true
$function$;

-- ── 3. Agendamento semanal ──────────────────────────────────────────────────────
-- Segunda-feira 08h (horário de Brasília, UTC-3) = 11h UTC. A action nova
-- (relatorio_semanal) foi adicionada à clever-handler no mesmo commit desta
-- migration — sem RESEND_FROM configurada, ela responde ok sem enviar nada
-- (mesmo comportamento defensivo das outras rotas), então agendar antes do
-- domínio verificar é seguro.
select cron.schedule(
  'relatorio-semanal-gestao',
  '0 11 * * 1',
  $$
  select net.http_post(
    url     := 'https://zakxroemofwolqqkfyaz.supabase.co/functions/v1/clever-handler',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inpha3hyb2Vtb2Z3b2xxcWtmeWF6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc0OTA4NTMsImV4cCI6MjA5MzA2Njg1M30.U2R5R2YUDY0kIPXTgtqmNDfFjxm3EqSSVcj3hLj-bC0',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inpha3hyb2Vtb2Z3b2xxcWtmeWF6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc0OTA4NTMsImV4cCI6MjA5MzA2Njg1M30.U2R5R2YUDY0kIPXTgtqmNDfFjxm3EqSSVcj3hLj-bC0'
    ),
    body := jsonb_build_object('action', 'relatorio_semanal')
  )
  $$
);
