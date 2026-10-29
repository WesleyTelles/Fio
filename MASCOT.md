# Mascote da assistente — especificação, motion e limites

**Fonte da arte:** `design/mascot/original-gemini.jpg` (arquivo fornecido pelo dono do produto, criado no Gemini). **Nada foi redesenhado nem regenerado.**
Asset de produção: `public/mascot/assistente-192.png` (recorte circular da cabeça, PNG com transparência real, 192 px = nitidez em 3x para 64 px).
Como foi gerado: `design/mascot/recorte.py` + `recorte-final.py` (OpenCV GrabCut sobre o JPEG; ver "Limitações da imagem").

## Onde aparece (só onde acrescenta valor)
1. **Botão flutuante** do assistente (`Nav` em `components/ui.tsx`): substitui o botão lima genérico. 60 px de arte, alvo de toque 64 px, `aria-label="Abrir assistente financeiro"`, foco visível, abre `/assistente` (rota existente, sem atraso).
2. **Cabeçalho do chat** (`screens/Assistant.tsx`): versão 36 px "quieta" (sem movimento de repouso, para não competir com a leitura). Entra com um fade/escala de 280 ms.
Não aparece em nenhum outro lugar; não há balões automáticos sobre o dashboard.

## Estados (fonte única: `src/lib/mascot.ts`; sem lógica financeira)
Prioridade: **oops > happy > busy > idle**.

| Estado | Gatilho REAL | Visual | Duração |
|---|---|---|---|
| idle (repouso) | nenhum evento | flutuar 3 px (6,5 s), respirar ×1,025 (7,5 s, começa depois), inclinação ±2° ocasional (ciclo 19 s, atraso 6 s), halo 0,34↔0,62 (5,5 s). Camadas distintas, ciclos diferentes: nunca tudo junto | contínuo, `ease-in-out` |
| press | toque/clique | escala 0,93 imediata (CSS `:active`, 160 ms) | enquanto pressionado |
| busy | `beginBusy()` em `send()` (chamada da IA) e em `confirm()` (gravação) | pequena inclinação de atenção + arco lima girando no anel; selo oculto | 1,8 s / 1,1 s por ciclo; só enquanto o trabalho real existir |
| happy | `createTransaction` devolveu `synced` (servidor confirmou) | aceno (desce 2 px, sobe 5 px, volta) + selo de check | 700 ms (reação 1,6 s) |
| oops | recusa do servidor (`rejected`), falha do provedor de IA, IA desativada | anel cinza, halo apagado, assentamento mínimo, selo neutro "i". Sem tremor, sem tristeza | 520 ms (reação 2,6 s; "desativado" fica neutro enquanto durar) |

**Garantias (cobertas por testes):** proposta ≠ registro (sem comemorar); cancelar não comemora; offline/pendente não comemora; rejeição não diz "registrado"; processamento só enquanto há chamada real.
Easing padrão do app: `cubic-bezier(.2,.8,.2,1)` para reações; `ease-in-out` para repouso; `linear` apenas na rotação do arco.

## Desempenho e acessibilidade
- Só `transform` e `opacity` (compositor). Uma animação por elemento. Sem dependências novas, sem JS por quadro.
- Aba oculta: animações pausadas (`html[data-hidden]`). Aparelho modesto (`deviceMemory ≤ 2` ou `hardwareConcurrency ≤ 2`): **desliga só o repouso**; reações e processamento continuam.
- `prefers-reduced-motion`: nenhuma animação de deslocamento/escala/rotação; os estados seguem legíveis por anel, selo (check/"i") e arco estático.
- Controle é um `<button>` com nome acessível; a imagem é decorativa (`alt=""`); não é a única indicação da ação.
- PWA: o PNG entra no precache (estático); nada de dados privados.

## Limitações da imagem original (honestidade)
- É um **JPEG sem canal alfa**; o "fundo transparente" era um **xadrez desenhado nos pixels**. O recorte foi feito por segmentação automática (GrabCut) + limpeza de halo; no aro dos cachos pode restar um pontinho claro isolado, invisível em 64 px. Para qualidade máxima, forneça o **PNG com alfa real** ou o arquivo-fonte em camadas.
- É **uma ilustração estática, de corpo único**: só dá para mover a imagem inteira. **Não há piscar, boca ou sobrancelhas animados**, e nenhum deles foi simulado. As variações de energia vêm do movimento do corpo, do anel, do halo e do selo.
- O recorte mostra só cabeça e pescoço (formato circular de avatar).

## Arquivos complementares que habilitariam mais personalidade (opcional)
1. Versão com **olhos fechados** (mesmo enquadramento) → piscar real a cada ~6 s.
2. Variações de expressão **neutra/atenta** (processando) e **sorriso discreto** (confirmado), mesma pose, mesmo fundo transparente.
3. PNG/WebP com **alfa real** em 1024 px, cabelo e óculos em camadas separadas (cabelo e rosto) → leve paralaxe/balanço do cabelo.
4. Se houver Lottie/sprites: especificar nomes por estado (`idle`, `busy`, `happy`, `oops`) — o `Mascot.tsx` já separa a camada de imagem.

## Pendências de validação externa
Fluidez em celulares reais (Android de entrada e iPhone), nitidez em telas 2x/3x físicas, e confirmação visual do dono do produto (aprovação do enquadramento circular).
