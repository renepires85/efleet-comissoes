// ── CONFIGURAÇÃO GLOBAL ───────────────────────────────────────────────────────
const SUPABASE_URL = 'https://zakxroemofwolqqkfyaz.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inpha3hyb2Vtb2Z3b2xxcWtmeWF6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc0OTA4NTMsImV4cCI6MjA5MzA2Njg1M30.U2R5R2YUDY0kIPXTgtqmNDfFjxm3EqSSVcj3hLj-bC0';
const CLEVER_URL   = SUPABASE_URL + '/functions/v1/clever-handler';
const SMART_URL    = SUPABASE_URL + '/functions/v1/smart-service';

// ── CLIENTE SUPABASE ──────────────────────────────────────────────────────────
const { createClient } = supabase;
const sb = createClient(SUPABASE_URL, SUPABASE_ANON);

// Link de recuperação de senha.
// O link do e-mail cria uma sessão válida — sem tratar isso, a pessoa entraria
// direto no sistema e NUNCA definiria a senha nova, que é o motivo de ela ter
// clicado. O evento pode chegar antes ou depois do init da página, então o
// marcador fica aqui (registrado antes de tudo) e o init consulta depois.
let recuperacaoDeSenha = false;
sb.auth.onAuthStateChange((evento) => {
  if (evento !== 'PASSWORD_RECOVERY') return;
  recuperacaoDeSenha = true;
  if (typeof entrarModoRecuperacao === 'function') entrarModoRecuperacao();
});

// ── ESTADO GLOBAL ─────────────────────────────────────────────────────────────
let currentUser        = null;
let currentPerfil      = null;
let currentPrestadorId = null;
let currentValidacaoId = null;
let currentPagamentoId = null;
let periodoAtual       = 'ultimo_mes';
