import { render } from 'preact';
import './styles.css';
import { App } from './App';
import { config } from './config';
import { initAuth } from './lib/auth';
import { initPWA } from './lib/pwa';
import { outbox, startLifecycle } from './lib/state';

(async () => {
  render(<App />, document.getElementById('app')!);
  if (!config.ok) return;
  initPWA();
  startLifecycle();
  await outbox.load().catch(() => {});   // pendências persistidas voltam antes de qualquer sincronização
  initAuth();
})();
