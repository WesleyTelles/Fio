import { useState } from 'preact/hooks';
import { Mark, Icon } from '../components/Icon';
import { Field } from '../components/ui';
import { auth } from '../lib/auth';
import { mapError } from '../lib/errors';
import { session } from '../lib/state';

type Mode = 'login' | 'signup' | 'recover' | 'newpass';
const emailOk = (v: string) => /^\S+@\S+\.\S+$/.test(v.trim());

export function AuthScreen({ initial = 'login' }: { initial?: Mode }) {
  const recovery = session.value.status === 'recovery';
  const [mode, setMode] = useState<Mode>(recovery ? 'newpass' : initial);
  const [name, setName] = useState(''); const [email, setEmail] = useState(''); const [pass, setPass] = useState(''); const [show, setShow] = useState(false);
  const [errs, setErrs] = useState<Record<string, string>>({}); const [form, setForm] = useState(''); const [info, setInfo] = useState(''); const [busy, setBusy] = useState(false);
  const go = (m: Mode) => { setMode(m); setErrs({}); setForm(''); setInfo(''); };

  const submit = async (e: Event) => {
    e.preventDefault(); if (busy) return;
    const er: Record<string, string> = {};
    if (mode !== 'newpass' && !emailOk(email)) er.email = 'Informe um e-mail válido.';
    if ((mode === 'login' || mode === 'signup' || mode === 'newpass') && pass.length < (mode === 'login' ? 1 : 8)) er.pass = mode === 'login' ? 'Informe sua senha.' : 'Use pelo menos 8 caracteres.';
    if (mode === 'signup' && !name.trim()) er.name = 'Como devemos te chamar?';
    setErrs(er); setForm(''); setInfo(''); if (Object.keys(er).length) return;
    setBusy(true);
    try {
      if (mode === 'login') await auth.signIn(email, pass);
      else if (mode === 'signup') { const inNow = await auth.signUp(name, email, pass); if (!inNow) { setInfo('Cadastro criado! Enviamos um e-mail de confirmação. Confirme e depois entre.'); setMode('login'); setPass(''); } }
      else if (mode === 'recover') { await auth.resetPassword(email); setInfo('Se esse e-mail tiver cadastro, enviamos um link para criar uma nova senha. Verifique também o spam.'); }
      else await auth.setNewPassword(pass);
    } catch (x) { setForm(mapError(x).message); }
    finally { setBusy(false); }
  };
  const expired = session.value.status === 'out' && session.value.expired;
  const title = mode === 'login' ? 'Entrar' : mode === 'signup' ? 'Criar conta' : mode === 'recover' ? 'Recuperar senha' : 'Nova senha';
  return (
    <main class="screen nonav" style="display:flex;flex-direction:column;justify-content:center;min-height:100dvh">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:28px"><Mark size={34} /><span style="font-size:26px;font-weight:700;letter-spacing:-.03em">Fio</span></div>
      <h1 class="h1" style="margin:0 0 6px">{title}</h1>
      <p class="muted" style="margin-bottom:22px;font-size:13px">{mode === 'login' ? 'Suas finanças, por conversa.' : mode === 'signup' ? 'Seus dados ficam só na sua conta.' : mode === 'recover' ? 'Informe o e-mail da sua conta.' : 'Escolha uma senha nova para sua conta.'}</p>
      {expired && mode === 'login' && <div class="banner warn" role="alert" style="margin-bottom:14px"><Icon n="warn" size={18} color="var(--danger)" /><span>Sua sessão expirou. Entre de novo — lançamentos pendentes neste aparelho continuam guardados.</span></div>}
      <form onSubmit={submit} noValidate style="display:flex;flex-direction:column;gap:14px">
        {mode === 'signup' && <Field id="a-name" label="Nome" error={errs.name}><input id="a-name" class="input" autocomplete="name" value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} aria-invalid={!!errs.name} /></Field>}
        {mode !== 'newpass' && <Field id="a-email" label="E-mail" error={errs.email}><input id="a-email" class="input" type="email" inputMode="email" autocomplete="email" autocapitalize="none" value={email} onInput={(e) => setEmail((e.target as HTMLInputElement).value)} aria-invalid={!!errs.email} /></Field>}
        {mode !== 'recover' && (
          <Field id="a-pass" label={mode === 'newpass' ? 'Nova senha' : 'Senha'} error={errs.pass}>
            <div style="position:relative"><input id="a-pass" class="input" type={(show ? 'text' : 'password') as any} autocomplete={mode === 'login' ? 'current-password' : 'new-password'} value={pass} onInput={(e) => setPass((e.target as HTMLInputElement).value)} aria-invalid={!!errs.pass} style="padding-right:56px" />
              <button type="button" class="ibtn press" aria-label={show ? 'Ocultar senha' : 'Mostrar senha'} aria-pressed={show} onClick={() => setShow(!show)} style="position:absolute;right:4px;top:4px"><Icon n="eye" size={20} /></button></div>
            {mode !== 'login' && <span class="muted">Mínimo de 8 caracteres.</span>}
          </Field>)}
        {form && <div class="err" role="alert">{form}</div>}
        {info && <div class="banner" role="status"><Icon n="check" size={18} color="var(--lime)" /><span style="color:#fff">{info}</span></div>}
        <button class="btn-p press" type="submit" disabled={busy}>{busy ? 'Aguarde…' : mode === 'login' ? 'Entrar' : mode === 'signup' ? 'Criar conta' : mode === 'recover' ? 'Enviar link' : 'Salvar nova senha'}</button>
      </form>
      <div style="display:flex;flex-direction:column;align-items:center;margin-top:10px">
        {mode === 'login' && <><button class="btn-link press" onClick={() => go('recover')}>Esqueci minha senha</button><button class="btn-link press" onClick={() => go('signup')}>Não tenho conta — criar</button></>}
        {mode !== 'login' && mode !== 'newpass' && <button class="btn-link press" onClick={() => go('login')}>Já tenho conta — entrar</button>}
      </div>
    </main>
  );
}
