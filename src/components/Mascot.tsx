import { Icon } from './Icon';
import type { MascotMood } from '../lib/mascot';

/**
 * Mascote oficial da assistente (arte original fornecida pelo dono do produto: recorte circular da cabeça, sem redesenho).
 * É UMA IMAGEM ESTÁTICA: todo movimento é do corpo inteiro (flutuar, respirar, inclinar), nunca expressão facial.
 * Camadas (cada uma com UMA animação por vez, para estados não competirem):
 *   .mascot (flutuar | reação)  >  .mascot-body (respirar)  >  .mascot-disc > .mascot-img (inclinar)
 *   + halo (brilho), anel (disponível), arco (processando), selo (disponível / confirmado / aviso).
 */
export function Mascot({ size = 64, mood = 'idle', quiet = false, testId }: { size?: number; mood?: MascotMood; quiet?: boolean; testId?: string }) {
  const showBadge = size >= 44;
  return (
    <span class="mascot" data-mood={mood} data-quiet={quiet ? '' : undefined} data-testid={testId} style={`--ms:${size}px`} aria-hidden="true">
      <span class="mascot-halo" />
      <span class="mascot-body">
        <span class="mascot-disc">
          <img class="mascot-img" src="/assistente-192.png" width={size} height={size} alt="" decoding="async" draggable={false} />
        </span>
        <span class="mascot-ring" />
        <span class="mascot-arc" />
      </span>
      {showBadge && (
        <span class="mascot-badge">
          {mood === 'happy' && <Icon n="check" size={11} sw={3} color="#10110F" />}
          {mood === 'oops' && <Icon n="info" size={11} sw={2.6} color="#10110F" />}
        </span>
      )}
    </span>
  );
}
