import { supabase } from './supabase';
import { api } from './api';
import { kv } from './idb';
import { AppError, mapError } from './errors';
import { loadSnapshot, outbox, refreshAll, resetData, session, navigate, route } from './state';

let explicitSignOut = false;
const LAST_USER = 'fio.lastUser';

async function onSignedIn(userId: string, email?: string, name?: string) {
  let prev: string | null = null; try { prev = localStorage.getItem(LAST_USER); } catch { /* */ }
  if (prev && prev !== userId) {
    // outra conta neste aparelho: apaga caches de leitura da anterior (pendências ficam isoladas por user_id)
    for (const k of await kv.keys().catch(() => [] as string[])) if (k.startsWith('snap:') && k !== 'snap:' + userId) await kv.del(k).catch(() => {});
    resetData();
  }
  try { localStorage.setItem(LAST_USER, userId); } catch { /* */ }
  session.value = { status: 'in', userId, email, name };
  await loadSnapshot(userId);
  void refreshAll();
  void outbox.sync();
}

export function initAuth() {
  const { data } = supabase().auth.onAuthStateChange((event, s) => {
    // Importante: não chamar o supabase de dentro do callback (risco de deadlock) — adia para o próximo tick.
    setTimeout(() => {
      if (event === 'PASSWORD_RECOVERY') { session.value = { status: 'recovery', userId: s?.user.id, email: s?.user.email }; return; }
      if (event === 'SIGNED_OUT' || (event === 'INITIAL_SESSION' && !s)) {
        // "expirou" = havia uma sessão de uso anterior (marcador local) e ela foi perdida sem o usuário sair.
        let hadUser = false; try { hadUser = !!localStorage.getItem(LAST_USER); } catch { /* */ }
        const expired = !explicitSignOut && (event === 'SIGNED_OUT' || hadUser);
        explicitSignOut = false;
        resetData();
        session.value = { status: 'out', expired };
        return;
      }
      if (s && (event === 'INITIAL_SESSION' || event === 'SIGNED_IN' || event === 'USER_UPDATED' || event === 'TOKEN_REFRESHED')) {
        if (session.value.status === 'recovery') return; // só sai do modo recuperação ao definir a senha
        if (session.value.status === 'in' && session.value.userId === s.user.id) { outbox.authBlocked.value = false; return; }
        void onSignedIn(s.user.id, s.user.email, (s.user.user_metadata as any)?.name);
      }
    }, 0);
  });
  return () => data.subscription.unsubscribe();
}

const authErr = (e: any): AppError => {
  const m = String(e?.message ?? ''); const c = String(e?.code ?? e?.error_code ?? '');
  if (/invalid login|invalid_credentials/i.test(m + c)) return new AppError('auth', 'invalid', 'E-mail ou senha incorretos.');
  if (/already registered|user_already_exists/i.test(m + c)) return new AppError('validation', 'exists', 'Este e-mail já tem cadastro. Tente entrar.');
  if (/weak_password|at least/i.test(m + c)) return new AppError('validation', 'weak', 'A senha precisa ter pelo menos 8 caracteres.');
  if (/email.*(invalid|format)|validation_failed/i.test(m + c)) return new AppError('validation', 'email', 'Informe um e-mail válido.');
  if (/not confirmed/i.test(m + c)) return new AppError('auth', 'unconfirmed', 'Confirme seu e-mail antes de entrar (veja sua caixa de entrada).');
  if (/rate|too many|over_email_send_rate_limit/i.test(m + c) || e?.status === 429) return new AppError('rate', 'rate', 'Muitas tentativas. Aguarde um pouco e tente de novo.');
  if (/fetch|network|timeout|aborted/i.test(m) || e?.status === 0) return new AppError('network', 'network', 'Sem conexão. Verifique a internet e tente de novo.');
  return mapError(e);
};

export const auth = {
  async signIn(email: string, password: string) {
    const { error } = await supabase().auth.signInWithPassword({ email: email.trim(), password });
    if (error) throw authErr(error);
  },
  /** Devolve true se já entrou; false se precisa confirmar o e-mail. */
  async signUp(name: string, email: string, password: string): Promise<boolean> {
    const { data, error } = await supabase().auth.signUp({ email: email.trim(), password, options: { data: { name: name.trim() }, emailRedirectTo: location.origin + '/' } });
    if (error) throw authErr(error);
    return !!data.session;
  },
  async resetPassword(email: string) {
    const { error } = await supabase().auth.resetPasswordForEmail(email.trim(), { redirectTo: location.origin + '/' });
    if (error && !/not found/i.test(error.message)) throw authErr(error); // resposta igual exista ou não o e-mail
  },
  async setNewPassword(password: string) {
    const { error } = await supabase().auth.updateUser({ password });
    if (error) throw authErr(error);
    const { data } = await supabase().auth.getSession();
    if (data.session) { session.value = { status: 'loading' }; await onSignedIn(data.session.user.id, data.session.user.email, (data.session.user.user_metadata as any)?.name); navigate('/', true); }
  },
  /** Sair: apaga cache local do usuário. Pendências só são apagadas com confirmação (feita pela tela). */
  async signOut(discardPending: boolean) {
    const uid = session.value.userId;
    explicitSignOut = true;
    if (uid) {
      if (discardPending) await outbox.purgeUser(uid);
      await kv.del('snap:' + uid).catch(() => {});
    }
    try { localStorage.removeItem(LAST_USER); } catch { /* */ }
    await supabase().auth.signOut({ scope: 'local' }).catch(() => {});
    resetData(); session.value = { status: 'out' }; if (route.value !== '/') navigate('/', true);
  },
  async deleteAccount() {
    await api.deleteAccount('EXCLUIR');
    const uid = session.value.userId;
    if (uid) { await outbox.purgeUser(uid); await kv.del('snap:' + uid).catch(() => {}); }
    explicitSignOut = true;
    await supabase().auth.signOut({ scope: 'local' }).catch(() => {});
    try { localStorage.removeItem(LAST_USER); } catch { /* */ }
    resetData(); session.value = { status: 'out' }; navigate('/', true);
  },
};
