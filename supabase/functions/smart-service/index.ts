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

    return new Response(JSON.stringify({ ok: true, user_id: userId }), {
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
