-- Fecha o mês anterior no dia 03 às 03h (BRT) = 06h UTC.
--
-- Roda nos dias 3, 4 E 5 de propósito. Não é redundância: a função tem trava de
-- completude e trava de idempotência, então as tentativas extras são a rede de
-- segurança do adiamento. Se no dia 3 o Data Lake ainda estiver carregando o
-- último dia do mês, a função adia sem gravar nada e o dia 4 tenta de novo. Se
-- o dia 3 fechar normalmente, os dias 4 e 5 respondem 'periodo_ja_fechado' e não
-- fazem nada. Sem isso, um atraso pontual de ETL deixaria o mês sem fechamento
-- até alguém perceber — foi exatamente o que aconteceu com julho/2026.

select cron.unschedule('fechamento-mensal')
where exists (select 1 from cron.job where jobname = 'fechamento-mensal');

select cron.schedule(
  'fechamento-mensal',
  '0 6 3-5 * *',
  $$
  select net.http_post(
    url     := 'https://zakxroemofwolqqkfyaz.supabase.co/functions/v1/fechamento-mensal',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inpha3hyb2Vtb2Z3b2xxcWtmeWF6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc0OTA4NTMsImV4cCI6MjA5MzA2Njg1M30.U2R5R2YUDY0kIPXTgtqmNDfFjxm3EqSSVcj3hLj-bC0',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inpha3hyb2Vtb2Z3b2xxcWtmeWF6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc0OTA4NTMsImV4cCI6MjA5MzA2Njg1M30.U2R5R2YUDY0kIPXTgtqmNDfFjxm3EqSSVcj3hLj-bC0'
    ),
    body := '{}'::jsonb
  )
  $$
);
