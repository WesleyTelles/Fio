import { useEffect } from 'preact/hooks';
import { Mark } from './components/Icon';
import { Nav, Toast } from './components/ui';
import { Sheets } from './sheets/Sheets';
import { AuthScreen } from './screens/Auth';
import { Home } from './screens/Home';
import { Moves } from './screens/Moves';
import { Budget } from './screens/Budget';
import { Insights } from './screens/Insights';
import { Assistant } from './screens/Assistant';
import { Profile } from './screens/Profile';
import { config } from './config';
import { navigate, route, session } from './lib/state';

function Splash() { return <div style="min-height:100dvh;display:flex;align-items:center;justify-content:center" role="status" aria-label="Carregando"><Mark size={44} run /></div>; }
function ConfigError() {
  return <main class="screen nonav"><h1 class="h1">Configuração ausente</h1><p class="muted" style="margin-top:10px;line-height:1.6">Este build não tem <code>VITE_SUPABASE_URL</code> e <code>VITE_SUPABASE_ANON_KEY</code>. Defina as variáveis (veja <code>.env.example</code> e o README) e gere o build novamente.</p></main>;
}

export function App() {
  if (!config.ok) return <ConfigError />;
  const st = session.value.status; const r = route.value;
  useEffect(() => { document.title = 'Fio'; }, []);
  if (st === 'loading') return <Splash />;
  if (st === 'out' || st === 'recovery') return <><AuthScreen key={st} /><Toast /></>;
  const known = ['/', '/movimentacoes', '/orcamento', '/metas', '/insights', '/assistente', '/perfil'];
  if (!known.includes(r)) { queueMicrotask(() => navigate('/', true)); return <Splash />; }
  return (
    <>
      {r === '/' && <Home />}{r === '/movimentacoes' && <Moves />}{(r === '/orcamento' || r === '/metas') && <Budget />}
      {r === '/insights' && <Insights />}{r === '/assistente' && <Assistant />}{r === '/perfil' && <Profile />}
      {r !== '/assistente' && r !== '/perfil' && <Nav />}
      <Sheets /><Toast />
    </>
  );
}
