-- Lembra o parceiro, TODO DIA às 09h (BRT) = 12h UTC, de que há comissão
-- esperando aprovação dele — e para de lembrar assim que ele aprova.
--
-- Diário e não semanal: não é aviso institucional, é o dinheiro da própria
-- pessoa parado, e ela é quem destrava. O lembrete só existe enquanto há
-- pendência: no dia seguinte à aprovação, a consulta não retorna nada e
-- ninguém recebe nada. Quem não quer receber tem como fazer parar.
--
-- O problema concreto que isso resolve: o Eduardo ficou com a comissão de
-- junho parada desde 16/07 — quase um mês — porque a única forma de saber era
-- entrar no sistema e navegar até o mês certo.

select cron.unschedule('lembrete-parceiros')
where exists (select 1 from cron.job where jobname = 'lembrete-parceiros');

select cron.schedule(
  'lembrete-parceiros',
  '0 12 * * *',
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
