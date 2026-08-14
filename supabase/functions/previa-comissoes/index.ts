// Prévia de comissões: busca no Metabase (Data Lake / Athena) a receita
// acumulada do mês corrente e entrega ao Postgres, que faz TODO o cálculo
// em atualizar_previa_comissoes() — reusando as mesmas funções de Curva C do
// fechamento oficial. Nada de regra de comissão em TypeScript aqui.
//
// Agendada pelo pg_cron (ver migration 20260814_previa_comissoes_cron.sql).
// Sem METABASE_API_KEY configurada, responde ok sem fazer nada — mesmo
// comportamento defensivo da clever-handler, para poder ser agendada antes
// de a chave existir.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const METABASE_URL = Deno.env.get("METABASE_URL") ?? "https://dados.efleet.com.br";
const DATABASE_ID = 2; // Data Lake (Athena)

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Receita do MÊS CORRENTE por cliente, com a ativação histórica (necessária
// para a Curva C) e o status atual do cliente — que é o que pode mudar a
// prévia até o fechamento.
const SQL = `
WITH periodo AS (
  SELECT DATE_TRUNC('MONTH', CURRENT_DATE) AS ini
), receitas_fuel AS (
  -- tpv = volume transacionado pelo cliente; receita = o que fica com a eFleet.
  -- A comissão sai da receita, mas o TPV é o número que o parceiro reconhece
  -- como "o tamanho do cliente" e aparece na ficha.
  SELECT t.cliente_id, SUM(t.valor) AS tpv_fuel, SUM(t.receita) AS receita_fuel
  FROM prod_analytics.transacoes t, periodo p
  WHERE DATE_TRUNC('MONTH', t.transacao_date) = p.ini
  GROUP BY 1
), ativacao_fuel AS (
  SELECT t.cliente_id, MIN(t.transacao_date) AS ativacao_fuel
  FROM prod_analytics.transacoes t GROUP BY 1
), mens AS (
  SELECT r.cliente_id,
    SUM(CASE WHEN r.fonte_receita='pass' THEN r.valor_receita END) AS receita_pass,
    SUM(CASE WHEN r.fonte_receita='fines' THEN r.valor_receita END) AS receita_fines,
    SUM(CASE WHEN r.fonte_receita='premium' THEN r.valor_receita END) AS receita_premium
  FROM prod_analytics.receitas r, periodo p
  WHERE r.tipo_receita='mensalidade' AND DATE_TRUNC('MONTH', r.receita_date) = p.ini
  GROUP BY 1
), ativacao_mens AS (
  -- Data da 1ª mensalidade por fonte, sem limite de período (histórico).
  SELECT cliente_id,
    MIN(CASE WHEN fonte_receita='pass'    THEN receita_date END) AS ativ_pass,
    MIN(CASE WHEN fonte_receita='fines'   THEN receita_date END) AS ativ_fines,
    MIN(CASE WHEN fonte_receita='premium' THEN receita_date END) AS ativ_premium
  FROM prod_analytics.receitas WHERE tipo_receita='mensalidade' GROUP BY 1
)
SELECT
  COALESCE(c.representante,'') AS vendedor_nome,
  c.cnpj_cpf AS cliente_cnpj,
  c.nome AS cliente_nome,
  CAST(af.ativacao_fuel AS VARCHAR) AS ativacao_fuel,
  CAST(am.ativ_pass AS VARCHAR) AS ativacao_pass,
  CAST(am.ativ_fines AS VARCHAR) AS ativacao_fines,
  CAST(am.ativ_premium AS VARCHAR) AS ativacao_premium,
  f.tpv_fuel,
  f.receita_fuel, m.receita_pass, m.receita_fines, m.receita_premium,
  CASE c.situacao
    WHEN 'ATIVO' THEN 'Ativo'
    WHEN 'BLOQUEADO' THEN 'Inadimplente'
    WHEN 'CANCELADO' THEN 'Churn'
    ELSE c.situacao
  END AS status_cliente
FROM prod_analytics.clientes c
CROSS JOIN periodo p
LEFT JOIN receitas_fuel f ON f.cliente_id = c.cliente_id
LEFT JOIN mens m ON m.cliente_id = c.cliente_id
LEFT JOIN ativacao_fuel af ON af.cliente_id = c.cliente_id
LEFT JOIN ativacao_mens am ON am.cliente_id = c.cliente_id
WHERE (f.receita_fuel IS NOT NULL OR m.receita_pass IS NOT NULL
       OR m.receita_fines IS NOT NULL OR m.receita_premium IS NOT NULL)
  AND COALESCE(c.representante,'') <> ''
`;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const apiKey = Deno.env.get("METABASE_API_KEY");
    if (!apiKey) {
      return json({ ok: true, linhas: 0, motivo: "METABASE_API_KEY não configurada" });
    }

    // /api/dataset/json é endpoint de EXPORTAÇÃO: espera a consulta como campo
    // de formulário chamado "query", não como corpo JSON. Em compensação,
    // devolve os registros já com nomes de coluna (em vez de arrays paralelos
    // de /api/dataset), que é o formato que atualizar_previa_comissoes espera.
    const form = new URLSearchParams();
    form.set("query", JSON.stringify({
      database: DATABASE_ID,
      type: "native",
      native: { query: SQL },
    }));

    const resp = await fetch(`${METABASE_URL}/api/dataset/json`, {
      method: "POST",
      headers: { "x-api-key": apiKey, "Content-Type": "application/x-www-form-urlencoded" },
      body: form,
    });

    if (!resp.ok) {
      const detalhe = await resp.text();
      return json({ ok: false, error: `Metabase ${resp.status}: ${detalhe.slice(0, 300)}` }, 400);
    }

    const linhas = await resp.json();
    if (!Array.isArray(linhas)) {
      return json({ ok: false, error: `Resposta inesperada do Metabase: ${JSON.stringify(linhas).slice(0, 300)}` }, 400);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data, error } = await supabase.rpc("atualizar_previa_comissoes", { p_dados: linhas });
    if (error) return json({ ok: false, error: error.message }, 400);

    return json({ ok: true, clientes_lidos: linhas.length, linhas_geradas: data });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return json({ ok: false, error: msg }, 400);
  }
});
