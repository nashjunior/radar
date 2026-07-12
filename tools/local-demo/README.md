# @radar/local-demo

Prova local da esteira **PNCP amplo → filtro → Gemini → triagem go/no-go**, com chat grounded no lote.

> Adapter Gemini é **somente development**. Produção permanece Claude/Bedrock (P-27 / P-66).

## Pré-requisitos

1. Node 22+, pnpm 9.
2. Pacotes buildados: `@radar/kernel`, `@radar/ingestao`, `@radar/triagem`.
3. Chave Gemini em `.env` (nunca no git).

```bash
# na raiz do monorepo
pnpm install
pnpm --filter @radar/kernel --filter @radar/ingestao --filter @radar/triagem build

cd tools/local-demo
cp .env.example .env
# edite GEMINI_API_KEY=...
```

## Variáveis de ambiente

| Var | Obrigatória | Descrição |
|-----|-------------|-----------|
| `GEMINI_API_KEY` | sim | Token da API Google AI (Gemini) |
| `GEMINI_MODEL` | não | Default `gemini-2.0-flash` |
| `DEMO_PALAVRAS_CHAVE` | não | Lista `a,b,c` — filtro por objeto/itens |
| `DEMO_UF` | não | Ex.: `SP` |
| `DEMO_VALOR_MAX` | não | Teto de valor estimado (R$) |
| `DEMO_MAX_EDITAIS` | não | Teto de coleta PNCP (default 20) |
| `DEMO_JANELA_DIAS` | não | Janela de publicação (default 7) |
| `DEMO_TRIAR_MAX` | não | Quantos editais filtrados vão ao Gemini (default 3) |
| `DEMO_PERFIL_JSON` | não | Override das habilitações do perfil seed |
| `NODE_ENV` | — | Deve ser `development` / `test` — **proibido `production`** |

## Comandos

```bash
# Coleta modalidades 1–13 → filtra → tria → imprime tabela
pnpm --filter @radar/local-demo start

# Chat grounded no último lote (cache em .cache/ultimo-lote.json)
pnpm --filter @radar/local-demo run ask -- "o que serve pra empresa de TI em SP até 500 mil?"
```

## Contrato da camada de chat (demo)

- **Input:** pergunta do usuário + resumo do catálogo filtrado (números PNCP, modalidade, UF, valor, objeto, aderência se já triada).
- **Retrieval (agora):** keyword + recência do lote em cache; (depois) embeddings sobre o catálogo.
- **Resposta:** texto + citações por `numeroControlePNCP`; se não souber, admite.
- **Proibido:** enviar estratégia comercial / classe crítica ao LLM (P-54).
- **Go/no-go definitivo:** continua em `Triagem.avaliar` + decisão humana (HITL). O chat só navega e explica.

UI React de chat fica fora deste pacote (próximo passo no BFF).

## Escopo de “contratos”

Fonte = **PNCP** (contratação pública Lei 14.133): pregão, dispensa, inexigibilidade, concorrência, credenciamento, etc. Não cobre contrato privado B2B.
