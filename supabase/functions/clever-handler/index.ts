import { createClient } from "jsr:@supabase/supabase-js@2";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";

export default async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
      },
    });
  }

  let body: {
    action?: string;
    prestador_id?: string;
    periodo?: string;
    solicitacao?: {
      nome: string;
      email: string;
      telefone?: string;
      tipo: string;
    };
  } = {};

  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Body inválido" }, { status: 400 });
  }

  const { action } = body;

  // ─── ROTA 1: Notificar parceiro sobre comissões disponíveis ───
  if (action === "notificar_parceiro" || !action) {
    const { prestador_id, periodo } = body;

    if (!prestador_id || !periodo) {
      return Response.json({ error: "prestador_id e periodo são obrigatórios" }, { status: 400 });
    }

    try {
      const sb = createClient(
        Deno.env.get("SUPABASE_URL") ?? "",
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
      );

      const { data: prestador, error } = await sb
        .from("prestadores")
        .select("nome, email")
        .eq("id", prestador_id)
        .single();

      if (error || !prestador) {
        return Response.json({ error: "Prestador não encontrado", detail: error?.message }, { status: 404 });
      }

      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: "eFleet · Comissões <onboarding@resend.dev>",
          to: [prestador.email],
          subject: `eFleet · Suas comissões de ${periodo} estão disponíveis`,
          html: `
            <div style="font-family:sans-serif;max-width:520px;margin:0 auto;background:#0D1E35;color:#E8F0FE;padding:32px;border-radius:12px;">
              <div style="font-size:20px;font-weight:700;margin-bottom:8px;">eFleet · <span style="color:#5CC878;">Comissões</span></div>
              <hr style="border:1px solid #1E3A6E;margin:16px 0;">
              <p style="font-size:15px;">Olá, <strong>${prestador.nome}</strong>!</p>
              <p style="font-size:14px;color:#A0BCE8;">Suas comissões referentes a <strong style="color:#E8F0FE;">${periodo}</strong> já estão disponíveis para validação.</p>
              <p style="font-size:14px;color:#A0BCE8;">Acesse o sistema, confira os valores e aprove até o dia 20.</p>
              <a href="https://efleet-comissoes.vercel.app"
                 style="display:inline-block;margin-top:20px;padding:12px 24px;background:#5CC878;color:#0D1E35;border-radius:8px;font-weight:700;text-decoration:none;font-size:14px;">
                Acessar sistema
              </a>
              <p style="font-size:12px;color:#6B8CC4;margin-top:24px;">eFleet Digital · Sistema de Comissões</p>
            </div>
          `,
        }),
      });

      const result = await res.json();
      if (!res.ok) {
        return Response.json({ error: "Resend error", detail: result }, { status: 500 });
      }

      return Response.json({ ok: true, email: prestador.email });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return Response.json({ error: msg }, { status: 500 });
    }
  }

  // ─── ROTA 2: Notificar gestão sobre nova solicitação de acesso ───
  if (action === "nova_solicitacao") {
    const { solicitacao } = body;

    if (!solicitacao?.nome || !solicitacao?.email || !solicitacao?.tipo) {
      return Response.json({ error: "nome, email e tipo são obrigatórios" }, { status: 400 });
    }

    try {
      const tipoLabel = solicitacao.tipo === "gestao" ? "Gestão" : "Parceiro Comercial";

      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: "eFleet · Comissões <onboarding@resend.dev>",
          to: ["argosefleet@gmail.com"],
          subject: `eFleet · Nova solicitação de acesso — ${solicitacao.nome}`,
          html: `
            <div style="font-family:sans-serif;max-width:520px;margin:0 auto;background:#0D1E35;color:#E8F0FE;padding:32px;border-radius:12px;">
              <div style="font-size:20px;font-weight:700;margin-bottom:8px;">eFleet · <span style="color:#5CC878;">Comissões</span></div>
              <hr style="border:1px solid #1E3A6E;margin:16px 0;">
              <p style="font-size:15px;">Nova solicitação de acesso recebida.</p>
              <table style="width:100%;font-size:14px;color:#A0BCE8;border-collapse:collapse;margin-top:8px;">
                <tr><td style="padding:6px 0;color:#6B8CC4;">Nome</td><td style="padding:6px 0;color:#E8F0FE;">${solicitacao.nome}</td></tr>
                <tr><td style="padding:6px 0;color:#6B8CC4;">E-mail</td><td style="padding:6px 0;color:#E8F0FE;">${solicitacao.email}</td></tr>
                <tr><td style="padding:6px 0;color:#6B8CC4;">Telefone</td><td style="padding:6px 0;color:#E8F0FE;">${solicitacao.telefone ?? "—"}</td></tr>
                <tr><td style="padding:6px 0;color:#6B8CC4;">Tipo</td><td style="padding:6px 0;color:#E8F0FE;">${tipoLabel}</td></tr>
              </table>
              <a href="https://efleet-comissoes.vercel.app"
                 style="display:inline-block;margin-top:24px;padding:12px 24px;background:#5CC878;color:#0D1E35;border-radius:8px;font-weight:700;text-decoration:none;font-size:14px;">
                Acessar sistema para aprovar
              </a>
              <p style="font-size:12px;color:#6B8CC4;margin-top:24px;">eFleet Digital · Sistema de Comissões</p>
            </div>
          `,
        }),
      });

      const result = await res.json();
      if (!res.ok) {
        return Response.json({ error: "Resend error", detail: result }, { status: 500 });
      }

      return Response.json({ ok: true });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return Response.json({ error: msg }, { status: 500 });
    }
  }

  return Response.json({ error: "Action inválida" }, { status: 400 });
};
