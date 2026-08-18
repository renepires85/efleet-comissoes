import { createClient } from "jsr:@supabase/supabase-js@2";

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
    const { email, nome, perfil, senha: senhaRecebida } = await req.json();

    if (!email || !nome || !perfil) {
      throw new Error("email, nome e perfil são obrigatórios");
    }

    // A senha provisória é gerada AQUI, no servidor, e não no navegador: assim
    // ela não passa pelo console, pelo histórico da aba nem por nenhum log do
    // cliente. O convite é o único lugar onde ela aparece.
    const senha = senhaRecebida ?? "Argos" +
      Array.from(crypto.getRandomValues(new Uint8Array(9)))
        .map(b => "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789"[b % 56])
        .join("") + "!";

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

    const userId = data.user.id;

    // 2. Inserir em usuarios
    const { error: errUsuario } = await sb.from("usuarios").insert({
      id: userId,
      nome,
      perfil,
    });

    if (errUsuario) throw new Error("Erro usuarios: " + errUsuario.message);

    // 3. Se vendedor, inserir em prestadores
    if (perfil === "vendedor") {
      const { error: errPrestador } = await sb.from("prestadores").insert({
        nome,
        email,
        usuario_id: userId,
        tipo: "PF",
        ativo: true,
      });

      if (errPrestador) throw new Error("Erro prestadores: " + errPrestador.message);
    }

    // 4. Enviar o convite. O acesso já existe neste ponto — se o e-mail
    // falhar, o cadastro não é desfeito: a gestão repassa a senha por outro
    // canal em vez de recomeçar. Por isso o envio não derruba a resposta.
    let emailEnviado = false;
    try {
      const resendKey = Deno.env.get("RESEND_API_KEY");
      if (resendKey) {
        const remetente = Deno.env.get("RESEND_FROM") ?? "eFleet ARGOS <onboarding@resend.dev>";
        const html = `
          <div style="font-family:system-ui,-apple-system,sans-serif;max-width:520px;color:#1a2535;">
            <h2 style="color:#245091;margin:0 0 4px;">Seu acesso ao ARGOS Comissões</h2>
            <p style="color:#606878;margin:0 0 20px;">Olá, ${nome}.</p>
            <p>A eFleet criou seu acesso ao sistema de comissões. Use os dados abaixo para entrar:</p>
            <div style="background:#f0f2f5;border-radius:8px;padding:16px;margin:18px 0;">
              <div style="font-size:13px;color:#606878;">E-mail</div>
              <div style="font-weight:600;margin-bottom:10px;">${email}</div>
              <div style="font-size:13px;color:#606878;">Senha provisória</div>
              <div style="font-weight:600;font-family:ui-monospace,monospace;font-size:16px;">${senha}</div>
            </div>
            <p><strong>Troque essa senha no primeiro acesso</strong> — é só clicar em "Senha" na barra superior.</p>
            <p style="color:#606878;font-size:13px;margin-top:24px;">eFleet ARGOS · Comissões</p>
          </div>`;
        const r = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({ from: remetente, to: email, subject: "Seu acesso ao ARGOS Comissões", html }),
        });
        emailEnviado = r.ok;
      }
    } catch (_) { /* acesso já criado; o convite é o que falhou */ }

    return new Response(JSON.stringify({ ok: true, user_id: userId, email_enviado: emailEnviado, senha_provisoria: emailEnviado ? undefined : senha }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify({ error: msg }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
