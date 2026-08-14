-- Atualiza a prévia todo dia às 06h (horário de Brasília) = 09h UTC.
-- Antes do início do expediente, então o vendedor abre o sistema já com o
-- número do dia. Sem METABASE_API_KEY a função responde ok sem fazer nada,
-- então agendar antes de a chave existir é seguro.

select cron.unschedule('previa-comissoes-diaria')
where exists (select 1 from cron.job where jobname = 'previa-comissoes-diaria');

select cron.schedule(
  'previa-comissoes-diaria',
  '0 9 * * *',
  $$
  select net.http_post(
    url     := 'https://zakxroemofwolqqkfyaz.supabase.co/functions/v1/previa-comissoes',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inpha3hyb2Vtb2Z3b2xxcWtmeWF6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc0OTA4NTMsImV4cCI6MjA5MzA2Njg1M30.U2R5R2YUDY0kIPXTgtqmNDfFjxm3EqSSVcj3hLj-bC0',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inpha3hyb2Vtb2Z3b2xxcWtmeWF6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc0OTA4NTMsImV4cCI6MjA5MzA2Njg1M30.U2R5R2YUDY0kIPXTgtqmNDfFjxm3EqSSVcj3hLj-bC0'
    ),
    body := '{}'::jsonb
  )
  $$
);
