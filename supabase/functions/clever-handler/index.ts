// Notificações por e-mail do eFleet Comissões.
// Estrutura espelhada da função enviar-notificacao do Argos Pricing, que é a
// que comprovadamente funciona neste ambiente: serve() do std/http (a versão
// anterior usava `export default`, que o runtime não registra como servidor —
// toda requisição ficava pendurada até o gateway cortar em 150s).
//
// Remetente vem de RESEND_FROM. Enquanto o domínio não estiver verificado no
// Resend, o fallback sandbox só entrega ao dono da conta Resend.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const APP_URL = "https://efleet-comissoes.vercel.app";
const GESTAO_EMAIL = "argosefleet@gmail.com";

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function layout(conteudo: string) {
  return `<!doctype html><html><body style="margin:0;padding:0;background:#f5f7fa;font-family:Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f7fa;padding:32px 16px;">
    <tr><td align="center">
      <table width="520" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;border:1px solid #e6e9ef;overflow:hidden;">
        <tr><td style="background:#0b1929;padding:20px 28px;">
          <span style="color:#ffffff;font-size:16px;font-weight:bold;">eFleet · <span style="color:#A4C557;">Comissões</span></span>
        </td></tr>
        ${conteudo}
        <tr><td style="padding:16px 28px;border-top:1px solid #e6e9ef;">
          <p style="margin:0;color:#6b7280;font-size:11px;">Mensagem automática do sistema de Comissões · eFleet Digital. Não responda este email.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

function botao(texto: string) {
  return `<a href="${APP_URL}" style="display:inline-block;background:#245091;color:#ffffff;text-decoration:none;font-weight:bold;font-size:14px;padding:12px 24px;border-radius:8px;">${texto} →</a>`;
}

async function enviarResend(resendKey: string, to: string[], subject: string, html: string) {
  const remetente = Deno.env.get("RESEND_FROM") ?? "eFleet · Comissões <onboarding@resend.dev>";
  const resp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: remetente, to, subject, html }),
  });
  const resultado = await resp.json();
  if (!resp.ok) {
    throw new Error(`Resend: ${resultado.message ?? JSON.stringify(resultado)}`);
  }
  return resultado.id as string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const resendKey = Deno.env.get("RESEND_API_KEY");
    const body = await req.json();
    const action = body.action ?? "notificar_parceiro";

    // Sem chave configurada: responde sem erro, para não travar o fluxo de quem chamou.
    if (!resendKey) {
      return json({ ok: true, enviados: 0, motivo: "RESEND_API_KEY não configurada" });
    }

    // ─── Parceiro: comissões disponíveis para validação ───
    if (action === "notificar_parceiro") {
      const { prestador_id, periodo } = body;
      if (!prestador_id || !periodo) {
        return json({ ok: false, error: "prestador_id e periodo são obrigatórios" }, 400);
      }

      const supabase = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      );

      const { data: prestador } = await supabase
        .from("prestadores").select("nome, email").eq("id", prestador_id).single();

      if (!prestador) return json({ ok: false, error: "Prestador não encontrado" }, 404);
      if (!prestador.email) {
        return json({ ok: false, error: `${prestador.nome} não tem e-mail cadastrado` }, 400);
      }

      const id = await enviarResend(
        resendKey,
        [prestador.email],
        `eFleet · Suas comissões de ${periodo} estão disponíveis`,
        layout(`<tr><td style="padding:28px;">
          <h2 style="margin:0 0 16px;color:#111827;font-size:20px;">Comissões de ${periodo}</h2>
          <p style="margin:0 0 8px;color:#111827;font-size:14px;">Olá, <strong>${prestador.nome}</strong>!</p>
          <p style="margin:0 0 24px;color:#6b7280;font-size:14px;line-height:1.6;">Suas comissões já estão disponíveis para validação. Acesse o sistema, confira os valores e aprove até o dia 20.</p>
          ${botao("Acessar sistema")}
        </td></tr>`),
      );

      return json({ ok: true, enviados: 1, email: prestador.email, id });
    }

    // ─── Gestão: nova solicitação de acesso ───
    if (action === "nova_solicitacao") {
      const { solicitacao } = body;
      if (!solicitacao?.nome || !solicitacao?.email || !solicitacao?.tipo) {
        return json({ ok: false, error: "nome, email e tipo são obrigatórios" }, 400);
      }

      const tipoLabel = solicitacao.tipo === "gestao" ? "Gestão" : "Parceiro Comercial";
      const linha = (r: string, v: string) =>
        `<tr><td style="padding:6px 0;color:#6b7280;font-size:13px;">${r}</td><td style="padding:6px 0;color:#111827;font-size:13px;">${v}</td></tr>`;

      const id = await enviarResend(
        resendKey,
        [GESTAO_EMAIL],
        `eFleet · Nova solicitação de acesso — ${solicitacao.nome}`,
        layout(`<tr><td style="padding:28px;">
          <h2 style="margin:0 0 16px;color:#111827;font-size:20px;">Nova solicitação de acesso</h2>
          <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
            ${linha("Nome", solicitacao.nome)}
            ${linha("E-mail", solicitacao.email)}
            ${linha("Telefone", solicitacao.telefone ?? "—")}
            ${linha("Tipo", tipoLabel)}
          </table>
          ${botao("Aprovar no sistema")}
        </td></tr>`),
      );

      return json({ ok: true, enviados: 1, id });
    }

    // ─── Gestão: relatório semanal de pendências (fechamento + aprovações) ───
    // Disparado pelo pg_cron (ver migration 20260813_relatorio_semanal_gestao.sql),
    // toda segunda 08h — mas pode ser chamado manualmente sem parâmetros.
    // ── LEMBRETE AOS PARCEIROS ────────────────────────────────────────────────
    // O relatório semanal avisa a GESTÃO; este avisa o PARCEIRO. Sem ele, a
    // pendência só é vista por quem entra no sistema — e o Eduardo ficou com
    // junho parado desde 16/07, quase um mês, porque ninguém foi atrás dele.
    //
    // Só parceiro ATIVO recebe: o inativo não consegue entrar para aprovar, e
    // cobrar ação de quem não tem acesso é ruído. Validação sem valor a pagar
    // já não existe mais — a trava criada hoje impede que nasça.
    if (action === "lembrete_parceiros") {
      const supabase = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      );

      const { data: pendentes, error } = await supabase
        .from("validacoes_mensais")
        .select("id, periodo_inicio, periodo_fim, criado_em, prestadores!inner(id, nome, email, ativo)")
        .eq("status", "pendente")
        .eq("prestadores.ativo", true);

      if (error) return json({ ok: false, error: error.message }, 400);
      if (!pendentes?.length) return json({ ok: true, enviados: 0, motivo: "nenhuma pendência" });

      const resendKey = Deno.env.get("RESEND_API_KEY");
      if (!resendKey) return json({ ok: false, error: "RESEND_API_KEY não configurada" }, 400);

      // Agrupa por parceiro: quem tem três meses parados recebe UM e-mail, não três.
      const porParceiro = new Map<string, { nome: string; email: string; periodos: string[]; desde: string }>();
      for (const v of pendentes as any[]) {
        const p = v.prestadores;
        if (!p?.email) continue;
        const mes = new Date(v.periodo_inicio + "T12:00:00")
          .toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
        const atual = porParceiro.get(p.id) ?? { nome: p.nome, email: p.email, periodos: [], desde: v.criado_em };
        atual.periodos.push(mes);
        if (v.criado_em < atual.desde) atual.desde = v.criado_em;
        porParceiro.set(p.id, atual);
      }

      let enviados = 0, semEmail = 0;
      for (const p of porParceiro.values()) {
        const dias = Math.floor((Date.now() - new Date(p.desde).getTime()) / 86400000);
        const lista = p.periodos.map(m => `<li style="margin:4px 0;">${m}</li>`).join("");
        const html = `
          <div style="font-family:system-ui,-apple-system,sans-serif;max-width:520px;color:#1a2535;">
            <h2 style="color:#245091;margin:0 0 4px;">Você tem comissão para aprovar</h2>
            <p style="color:#606878;margin:0 0 18px;">Olá, ${p.nome}.</p>
            <p>${p.periodos.length === 1 ? "Há uma comissão aguardando" : `Há ${p.periodos.length} comissões aguardando`} sua aprovação:</p>
            <ul style="padding-left:20px;">${lista}</ul>
            <p><strong>Enquanto você não aprovar, o pagamento não avança.</strong></p>
            ${dias >= 15 ? `<p style="color:#c9302c;">A mais antiga está parada há ${dias} dias.</p>` : ""}
            <p style="margin-top:22px;">
              <a href="${APP_URL}" style="background:#A4C557;color:#0B1929;text-decoration:none;padding:11px 20px;border-radius:8px;font-weight:700;display:inline-block;">Abrir o sistema</a>
            </p>
            <p style="color:#606878;font-size:13px;margin-top:24px;">eFleet ARGOS · Comissões</p>
          </div>`;
        // enviarResend lança em erro; um parceiro com e-mail inválido não pode
        // impedir que os outros recebam.
        try {
          await enviarResend(resendKey, [p.email], "Você tem comissão para aprovar", html);
          enviados++;
        } catch (_) { semEmail++; }
      }

      return json({ ok: true, enviados, falhas: semEmail, parceiros: porParceiro.size });
    }

    if (action === "relatorio_semanal") {
      const supabase = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      );

      const { data: destinatarios } = await supabase.rpc("emails_gestao");
      const emails = (destinatarios ?? []).map((d: { email: string }) => d.email).filter(Boolean);
      if (!emails.length) {
        return json({ ok: true, enviados: 0, motivo: "nenhum usuário com perfil gestao ativo" });
      }

      const { data: fechamentosPendentes } = await supabase
        .from("uploads")
        .select("nome_arquivo, periodo_inicio, periodo_fim, criado_em")
        .neq("status", "concluido")
        .order("criado_em", { ascending: true });

      const { data: validacoesPendentes } = await supabase
        .from("validacoes_mensais")
        .select("status, periodo_inicio, periodo_fim, criado_em, prestadores(nome)")
        .in("status", ["pendente", "contestado"])
        .order("status", { ascending: true })
        .order("criado_em", { ascending: true });

      const fmtData = (d: string) => new Date(d + "T12:00:00").toLocaleDateString("pt-BR");
      const fmtPeriodo = (ini: string, fim: string) => `${fmtData(ini)} – ${fmtData(fim)}`;
      const diasDesde = (d: string) => Math.floor((Date.now() - new Date(d).getTime()) / 86400000);

      const linhaFechamento = (u: { nome_arquivo: string; periodo_inicio: string; periodo_fim: string; criado_em: string }) => `
        <tr>
          <td style="padding:8px 0;border-top:1px solid #e6e9ef;color:#111827;font-size:13px;">${u.nome_arquivo}</td>
          <td style="padding:8px 0;border-top:1px solid #e6e9ef;color:#6b7280;font-size:13px;">${fmtPeriodo(u.periodo_inicio, u.periodo_fim)}</td>
          <td style="padding:8px 0;border-top:1px solid #e6e9ef;color:#6b7280;font-size:13px;text-align:right;">${diasDesde(u.criado_em)}d</td>
        </tr>`;

      const linhaValidacao = (v: { status: string; periodo_inicio: string; periodo_fim: string; criado_em: string; prestadores: { nome: string } | null }) => `
        <tr>
          <td style="padding:8px 0;border-top:1px solid #e6e9ef;color:#111827;font-size:13px;">${v.prestadores?.nome ?? "—"}</td>
          <td style="padding:8px 0;border-top:1px solid #e6e9ef;color:#6b7280;font-size:13px;">${fmtPeriodo(v.periodo_inicio, v.periodo_fim)}</td>
          <td style="padding:8px 0;border-top:1px solid #e6e9ef;font-size:13px;text-align:center;">
            <span style="display:inline-block;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:bold;${
              v.status === "contestado" ? "background:#fde2e2;color:#c0392b;" : "background:#fef3d6;color:#a5721a;"
            }">${v.status === "contestado" ? "Contestado" : "Pendente"}</span>
          </td>
          <td style="padding:8px 0;border-top:1px solid #e6e9ef;color:#6b7280;font-size:13px;text-align:right;">${diasDesde(v.criado_em)}d</td>
        </tr>`;

      const secaoFechamentos = !fechamentosPendentes?.length
        ? `<p style="margin:0 0 24px;color:#6b7280;font-size:13px;">✓ Nenhum fechamento pendente de cálculo.</p>`
        : `<table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
             <tr><th style="text-align:left;color:#6b7280;font-size:11px;text-transform:uppercase;padding-bottom:6px;">Arquivo</th><th style="text-align:left;color:#6b7280;font-size:11px;text-transform:uppercase;padding-bottom:6px;">Período</th><th style="text-align:right;color:#6b7280;font-size:11px;text-transform:uppercase;padding-bottom:6px;">Enviado há</th></tr>
             ${fechamentosPendentes.map(linhaFechamento).join("")}
           </table>`;

      const secaoValidacoes = !validacoesPendentes?.length
        ? `<p style="margin:0;color:#6b7280;font-size:13px;">✓ Nenhuma validação pendente ou contestada.</p>`
        : `<table width="100%" cellpadding="0" cellspacing="0">
             <tr><th style="text-align:left;color:#6b7280;font-size:11px;text-transform:uppercase;padding-bottom:6px;">Parceiro</th><th style="text-align:left;color:#6b7280;font-size:11px;text-transform:uppercase;padding-bottom:6px;">Período</th><th style="text-align:center;color:#6b7280;font-size:11px;text-transform:uppercase;padding-bottom:6px;">Status</th><th style="text-align:right;color:#6b7280;font-size:11px;text-transform:uppercase;padding-bottom:6px;">Há</th></tr>
             ${validacoesPendentes.map(linhaValidacao).join("")}
           </table>`;

      const hoje = new Date().toLocaleDateString("pt-BR");
      const html = layout(`<tr><td style="padding:28px;">
          <h2 style="margin:0 0 4px;color:#111827;font-size:20px;">Pendências da semana</h2>
          <p style="margin:0 0 24px;color:#6b7280;font-size:13px;">Resumo gerado em ${hoje}</p>

          <h3 style="margin:0 0 10px;color:#111827;font-size:14px;">📁 Fechamentos pendentes de cálculo (${fechamentosPendentes?.length ?? 0})</h3>
          ${secaoFechamentos}

          <h3 style="margin:0 0 10px;color:#111827;font-size:14px;">✅ Aprovações pendentes (${validacoesPendentes?.length ?? 0})</h3>
          ${secaoValidacoes}

          <div style="margin-top:28px;">${botao("Abrir o sistema")}</div>
        </td></tr>`);

      const totalPend = (fechamentosPendentes?.length ?? 0) + (validacoesPendentes?.length ?? 0);
      const id = await enviarResend(
        resendKey,
        emails,
        totalPend > 0
          ? `eFleet · ${totalPend} pendência(s) aguardando você`
          : "eFleet · Nenhuma pendência esta semana",
        html,
      );

      return json({ ok: true, enviados: emails.length, fechamentos: fechamentosPendentes?.length ?? 0, validacoes: validacoesPendentes?.length ?? 0, id });
    }

    return json({ ok: false, error: `Action inválida: ${action}` }, 400);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return json({ ok: false, error: msg }, 400);
  }
});
