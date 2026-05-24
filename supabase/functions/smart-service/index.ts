import { createClient } from "jsr:@supabase/supabase-js@2";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { email, nome, perfil, senha } = await req.json();

    if (!email || !nome || !perfil || !senha) {
      throw new Error("email, nome, perfil e senha são obrigatórios");
    }

    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    // 1. Criar usuário no Auth
    const { data, error } = await sb.auth.admin.createUser({
      email,
      password: senha,
      email_confirm: true,
    });

    if (error) throw error;

    // 2. Inserir em usuarios
    await sb.from("usuarios").insert({
      id: data.user.id,
      nome,
      perfil,
    });

    // 3. Se vendedor, inserir em prestadores
    if (perfil === "vendedor") {
      await sb.from("prestadores").insert({
        nome,
        email,
        usuario_id: data.user.id,
        tipo: "PF",
        ativo: true,
      });
    }

    // 4. Retorna sucesso ANTES de tentar e-mail
    const response = new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

    // 5. E-mail em background — não trava o fluxo
    EdgeRuntime.waitUntil(
      fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: "eFleet · Comissões <onboarding@resend.dev>",
          to: [email],
          subject: "eFleet · Seu acesso foi liberado!",
          html: `
            <div style="font-family:sans-serif;max-width:520px;margin:0 auto;background:#0D1E35;color:#E8F0FE;padding:32px;border-radius:12px;">
              <div style="font-size:20px;font-weight:700;margin-bottom:8px;">eFleet · <span style="color:#A4C557;">Comissões</span></div>
              <hr style="border:1px solid #1E3A6E;margin:16px 0;">
              <p style="font-size:15px;">Olá, <strong>${nome}</strong>!</p>
              <p style="font-size:14px;color:#A0BCE8;">Seu acesso ao sistema de comissões foi aprovado.</p>
              <p style="font-size:14px;color:#A0BCE8;">Use a senha que você cadastrou na solicitação de acesso para entrar.</p>
              <a href="https://efleet-comissoes.vercel.app"
                 style="display:inline-block;margin-top:20px;padding:12px 24px;background:#A4C557;color:#0D1E35;border-radius:8px;font-weight:700;text-decoration:none;font-size:14px;">
                Acessar sistema
              </a>
              <p style="font-size:12px;color:#6B8CC4;margin-top:24px;">eFleet Digital · Sistema de Comissões</p>
            </div>
          `,
        }),
      }).catch(e => console.log("e-mail falhou:", e))
    );

    return response;

  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify({ error: msg }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
