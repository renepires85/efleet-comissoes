-- Lembra o parceiro, toda quarta às 09h (BRT) = 12h UTC, de que há comissão
-- esperando aprovação dele.
--
-- Quarta, e não segunda: o relatório da gestão sai segunda 08h, e empilhar os
-- dois no mesmo dia faz o time receber "há pendências" e o parceiro receber
-- "aprove" sem que ninguém tenha tido tempo de agir no meio.
--
-- Semanal, não diário: a pendência dura semanas por natureza — o parceiro
-- confere o extrato quando tem tempo. Um lembrete por dia vira ruído e a
-- pessoa passa a ignorar todos, inclusive o que importa.
--
-- O problema concreto que isso resolve: o Eduardo ficou com a comissão de
-- junho parada desde 16/07 — quase um mês — porque a única forma de saber era
-- entrar no sistema e navegar até o mês certo.

select cron.unschedule('lembrete-parceiros')
where exists (select 1 from cron.job where jobname = 'lembrete-parceiros');

select cron.schedule(
  'lembrete-parceiros',
  '0 12 * * 3',
  $$
  select net.http_post(
    url     := 'https://zakxroemofwolqqkfyaz.supabase.co/functions/v1/clever-handler',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inpha3hyb2Vtb2Z3b2xxcWtmeWF6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc0OTA4NTMsImV4cCI6MjA5MzA2Njg1M30.U2R5R2YUDY0kIPXTgtqmNDfFjxm3EqSSVcj3hLj-bC0',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inpha3hyb2Vtb2Z3b2xxcWtmeWF6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc0OTA4NTMsImV4cCI6MjA5MzA2Njg1M30.U2R5R2YUDY0kIPXTgtqmNDfFjxm3EqSSVcj3hLj-bC0'
    ),
    body := '{"action":"lembrete_parceiros"}'::jsonb
  )
  $$
);
