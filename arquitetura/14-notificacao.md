# A14 · Notificação: Canais, E-mail e Digest

> Especificação de implementação do bounded context **Notificação** (documento 13, §§2–3 · tipo: Generic). Entrega alertas por canal conforme preferência e criticidade — e-mail imediato ou agrupado em digest. Consome o evento `alerta.gerado` publicado pelo Matching (arquitetura/03, §3). Estágio: **Concepção** — código abaixo é exemplo ilustrativo.
>
> Convenções de código: Clean Architecture conforme [arquitetura/10](10-padroes-e-estrutura-de-codigo.md); ports sem tecnologia no nome; todo use case recebe `AbortSignal` (arquitetura/10 §1). Use cases listados em [docs/14 §4](../docs/14-casos-de-uso.md).

## 1. Posição no context map

O contexto de Notificação é **a última etapa da esteira do MVP** (arquitetura/03, §1): recebe `alerta.gerado` via fila e entrega ao usuário sem saber nada do conteúdo do edital.

```mermaid
flowchart LR
    MAT[Matching] -->|alerta.gerado · fila| NOT[Notificação]
    NOT -->|e-mail imediato / digest| U[Usuário]
    NOT -.publica notificacao.enviada.-> GOV[Governança]
    IDT[Identidade] -.tenantId · Shared Kernel.-> NOT
```

**Não faz:** decidir o que é relevante (é o Matching); acessar o texto do edital; interagir diretamente com a API do PNCP.

## 2. Modelo de domínio

### 2.1 Value objects

```ts
// domain/value-objects/canal.ts
export type CanalTipo = 'EMAIL' | 'WEBHOOK' | 'IN_APP';

export class Canal {
  private constructor(readonly tipo: CanalTipo) {}
  static criar(tipo: string): Canal {
    if (!['EMAIL', 'WEBHOOK', 'IN_APP'].includes(tipo))
      throw new CanalInvalidoError(tipo);
    return new Canal(tipo as CanalTipo);
  }
  get ehEmail(): boolean { return this.tipo === 'EMAIL'; }
}

// domain/value-objects/frequencia.ts
export type FrequenciaTipo = 'IMEDIATA' | 'DIARIA' | 'SEMANAL';

export class Frequencia {
  private constructor(readonly tipo: FrequenciaTipo) {}
  static criar(tipo: string): Frequencia {
    if (!['IMEDIATA', 'DIARIA', 'SEMANAL'].includes(tipo))
      throw new PreferenciaInvalidaError(`frequência inválida: ${tipo}`);
    return new Frequencia(tipo as FrequenciaTipo);
  }
  get ehImediata(): boolean { return this.tipo === 'IMEDIATA'; }
}

```

**Criticidade (P-81) não tem VO próprio aqui.** Um alerta é CRÍTICO se o prazo final estiver em até 3 dias corridos OU se a aderência for ≥ 0,80 — mas essa conta é feita **uma única vez**, no domínio do Matching (`Alerta.imediato`, A15 §2 — `AderenciaMatching.ehAlta` OU `PrazoCritico.critico`), e chega pronta no evento `alerta.gerado` (`payload.imediato`, §9). Notificação **consome** o fato em `NotificarAlertaInput.imediato` (§4.2); não recalcula. Até a RAD-313, existia aqui um VO `Criticidade` com limiares injetados que refazia a mesma conta a partir de `diasAtePrazo`/`aderencia` lidos por cross-context read — duas fontes de verdade independentes do mesmo P-81, achado do guardiao-arquitetura na RAD-303. Removido.

> **Linguagem ubíqua — "alta aderência":** o corte ≥ 0,80 é o de P-81 e vale para o alerta do Matching (A15 §2, `AderenciaMatching.ehAlta`). **Não** é a `Aderencia` da Triagem, cujo `ehAlta ≥ 0,7` sustenta a sugestão go/no-go (docs/10 §4, A17 §2) e é outro conceito (docs/13 §3, P-45) — não unificar os dois.

### 2.2 Agregado raiz — Notificação

```ts
// domain/notificacao.ts
export class Notificacao {
  private constructor(
    readonly id: NotificacaoId,
    readonly tenantId: TenantId,       // Shared Kernel (docs/13 §5)
    readonly usuarioId: UsuarioId,
    readonly alertaId: AlertaId,
    readonly canal: Canal,
    private _status: 'PENDENTE' | 'ENVIADA' | 'FALHOU',
    readonly criadaEm: Date,
    private _enviadaEm?: Date,
  ) {}

  static criar(params: {
    tenantId: TenantId; usuarioId: UsuarioId; alertaId: AlertaId; canal: Canal;
  }): Notificacao {
    return new Notificacao(
      NotificacaoId.novo(), params.tenantId, params.usuarioId,
      params.alertaId, params.canal, 'PENDENTE', new Date(),
    );
  }

  marcarEnviada(): void {
    this._status = 'ENVIADA';
    this._enviadaEm = new Date();
  }
  marcarFalhou(): void { this._status = 'FALHOU'; }

  get status() { return this._status; }
  get enviadaEm() { return this._enviadaEm; }
}
```

### 2.3 Erros customizados

```ts
// domain/errors/index.ts
import { DomainError } from '../../shared/kernel/ts/domain-error';

export class CanalIndisponivelError extends DomainError {
  readonly code = 'CANAL_INDISPONIVEL';
  constructor(canal: string) { super(`canal indisponível: ${canal}`); }
}
export class PreferenciaInvalidaError extends DomainError {
  readonly code = 'PREFERENCIA_INVALIDA';
  constructor(detalhe: string) { super(`preferência inválida: ${detalhe}`); }
}
export class CanalInvalidoError extends DomainError {
  readonly code = 'CANAL_INVALIDO';
  constructor(tipo: string) { super(`tipo de canal desconhecido: ${tipo}`); }
}
```

## 3. Camada application — ports (interfaces)

```ts
// application/ports.ts

// Consulta alertas pendentes de envio para um usuário em uma janela de tempo
export interface AlertaRepository {
  porId(id: AlertaId, signal: AbortSignal): Promise<AlertaResumoDTO | null>;

  /**
   * Alertas ainda não notificados do usuário na janela (docs/11 §4).
   * Contrato:
   *  - EXCLUI alertas que já geraram NOTIFICACAO ENVIADA — é o que faz o alerta crítico,
   *    já entregue de imediato, não ocupar vaga no cap do digest (P-81);
   *  - ordena por prazo (mais próximo primeiro) e, em empate, por aderência desc;
   *  - `limite` é o cap da frequência, passado pelo use case — a política é da application,
   *    o repositório só respeita a borda (query limitada: fan-out de A04 S4 não pode virar
   *    um SELECT de milhares de linhas por usuário/ciclo);
   *  - o excedente volta AGREGADO por critério/órgão, nunca item a item.
   */
  pendentesDigest(
    params: { usuarioId: UsuarioId; aPartirDe: Date; limite: number },
    signal: AbortSignal,
  ): Promise<DigestPendentesDTO>;
}

// application/dtos.ts
export interface DigestPendentesDTO {
  selecionados: AlertaResumoDTO[];        // no máximo `limite`, já ordenados
  excedentes: ExcedenteAgrupadoDTO[];     // agrupamento do que passou do cap
  totalPendentes: number;                 // selecionados + excedentes
}

export interface ExcedenteAgrupadoDTO {
  criterioId: CriterioId;
  criterioNome: string;
  orgao: string;
  quantidade: number;
}

// Lê e persiste preferências de notificação do usuário
export interface PreferenciaRepository {
  porUsuario(id: UsuarioId, signal: AbortSignal): Promise<PreferenciaDTO | null>;
  salvar(p: PreferenciaDTO, signal: AbortSignal): Promise<void>;
}

// Persiste o registro de notificação para auditoria e idempotência
export interface NotificacaoRepository {
  salvar(n: Notificacao, signal: AbortSignal): Promise<void>;
  jaNotificado(alertaId: AlertaId, usuarioId: UsuarioId, signal: AbortSignal): Promise<boolean>;
}

// Entrega a mensagem pelo canal — tech-agnóstico (SES, webhook, in-app)
export interface Notifier {
  enviar(params: {
    canal: Canal; destinatario: string; assunto: string; corpo: string;
    signal: AbortSignal;
  }): Promise<void>;    // lança CanalIndisponivelError se o provedor falhar
}

export interface EventPublisher {
  publicar(evento: DomainEvent, signal: AbortSignal): Promise<void>;
}

/**
 * Gateway cross-contexto para Identidade/preferência (docs/13 §5 — Cliente-Fornecedor).
 * Resolve clienteFinalId → { usuarioId, email }. MVP: 1 usuário por clienteFinal (P-25).
 * Mesmo padrão do PerfilGateway da Triagem (P-83). Retorna null se o cliente não existir.
 */
export interface ClienteFinalGateway {
  porId(id: ClienteFinalId, signal: AbortSignal): Promise<ClienteFinalDTO | null>;
}
```

## 4. Use cases

### 4.1 `DefinirPreferenciasNotificacaoUseCase`

Trigger: usuário (docs/14 §4). Persiste os canais e a frequência escolhidos.

```ts
// application/use-cases/definir-preferencias-notificacao.ts
export class DefinirPreferenciasNotificacaoUseCase {
  constructor(private readonly preferencias: PreferenciaRepository) {}

  async executar(
    input: DefinirPreferenciasInput,
    signal?: AbortSignal,
  ): Promise<PreferenciaDTO> {
    const canais = input.canais.map(c => Canal.criar(c));     // valida no VO
    const frequencia = Frequencia.criar(input.frequencia);    // valida no VO

    const dto: PreferenciaDTO = {
      usuarioId: input.usuarioId,
      canais: canais.map(c => c.tipo),
      frequencia: frequencia.tipo,
    };
    await this.preferencias.salvar(dto, signal);
    return dto;
  }
}
```

### 4.2 `NotificarAlertaUseCase`

Trigger: evento `alerta.gerado` (fila). Recebe `clienteFinalId` (contrato canônico — A03 §3); resolve usuário/e-mail via `ClienteFinalGateway` (P-83). MVP: 1 usuário por clienteFinal (P-25). Idempotente por `alertaId + usuarioId`.

```ts
// application/use-cases/notificar-alerta.ts
export interface NotificarAlertaInput {
  alertaId: AlertaId;
  clienteFinalId: ClienteFinalId;
  tenantId: TenantId;
  /** Aderência alta OU prazo crítico (P-81) — decidido no Matching, publicado em `alerta.gerado`. */
  imediato: boolean;
}

export class NotificarAlertaUseCase {
  constructor(
    private readonly alertas: AlertaRepository,
    private readonly preferencias: PreferenciaRepository,
    private readonly notificacoes: NotificacaoRepository,
    private readonly notifier: Notifier,
    private readonly eventos: EventPublisher,
    private readonly ids: IdProvider,
    private readonly clienteFinalGateway: ClienteFinalGateway,
  ) {}

  async executar(input: NotificarAlertaInput, signal: AbortSignal): Promise<void> {
    // Resolve destinatário — clienteFinal pode ter sido removido entre matching e notificação
    const clienteFinal = await this.clienteFinalGateway.porId(input.clienteFinalId, signal);
    if (!clienteFinal) return;

    // Idempotência — não reprocessar o mesmo alerta (mensagem duplicada na fila)
    if (await this.notificacoes.jaNotificado(input.alertaId, clienteFinal.usuarioId, signal)) return;

    const [alerta, preferencia] = await Promise.all([
      this.alertas.porId(input.alertaId, signal),
      this.preferencias.porUsuario(clienteFinal.usuarioId, signal),
    ]);
    if (!alerta) return;  // edital removido/reconciliado — descarta silenciosamente

    // P-81: crítico = prazo ≤ 3 dias corridos OU aderência ≥ 0,80 — decidido no Matching
    // (Alerta.imediato), não recalculado aqui (RAD-313). `input.imediato` já vem pronto.
    //
    // Crítico OU preferência imediata → entrega agora; caso contrário, aguarda o digest.
    // Ao NÃO registrar Notificacao aqui, o alerta continua pendente e o digest o pega depois;
    // ao registrar (caminho crítico), ele sai do pool do digest — logo não consome cap (P-81).
    if (!input.imediato && preferencia?.frequencia !== 'IMEDIATA') return;

    const canal = Canal.criar(preferencia?.canais[0] ?? 'EMAIL');
    let notificacao = Notificacao.criar({
      id: NotificacaoId(this.ids.gerar()),
      tenantId: input.tenantId,
      usuarioId: clienteFinal.usuarioId,
      alertaId: input.alertaId,
      canal,
    });

    try {
      await this.notifier.enviar({
        canal,
        destinatario: clienteFinal.email,   // resolvido pelo gateway — nunca vem do evento
        assunto: `Novo alerta: ${alerta.objeto}`,
        corpo: montarCorpoAlerta(alerta),
        signal,
      });
      notificacao = notificacao.marcarEnviada();
    } catch {
      notificacao = notificacao.marcarFalhou();
      throw new CanalIndisponivelError(canal.tipo);  // propaga → retry na fila
    } finally {
      await this.notificacoes.salvar(notificacao, signal);
    }

    await this.eventos.publicar(new NotificacaoEnviada(notificacao), signal);
  }
}
```

### 4.3 `EnviarDigestUseCase`

Trigger: scheduler (diário ou semanal). Agrupa alertas pendentes do período e envia em uma única mensagem; aplica o cap anti-fadiga de P-81 (docs/11, §4).

O cap **depende da frequência** — 10 no digest diário, 25 no semanal, por usuário. Alertas críticos não chegam aqui: já foram entregues e registrados pelo `NotificarAlertaUseCase`, e o `pendentesDigest` só devolve o que ainda não foi notificado (§3).

```ts
// domain/value-objects/frequencia.ts (complemento)
// Cap por frequência — decisão de Produto P-81 (docs/11 §4).
export const CAP_DIGEST: Record<'DIARIA' | 'SEMANAL', number> = {
  DIARIA: 10,
  SEMANAL: 25,
};

// application/use-cases/enviar-digest.ts
export class EnviarDigestUseCase {
  constructor(
    private readonly alertas: AlertaRepository,
    private readonly preferencias: PreferenciaRepository,
    private readonly notificacoes: NotificacaoRepository,
    private readonly notifier: Notifier,
    private readonly eventos: EventPublisher,
    private readonly caps: Record<'DIARIA' | 'SEMANAL', number> = CAP_DIGEST,
  ) {}

  async executar(input: EnviarDigestInput, signal: AbortSignal): Promise<DigestDTO> {
    const preferencia = await this.preferencias.porUsuario(input.usuarioId, signal);

    // Usuário com preferência imediata ou sem preferência recebe por alerta individual
    if (!preferencia || preferencia.frequencia === 'IMEDIATA') {
      return { enviados: 0, agrupados: 0, total: 0 };
    }

    // A política (qual cap) é da application; o repositório só recebe o limite (§3)
    const limite = this.caps[preferencia.frequencia];

    const { selecionados, excedentes, totalPendentes } = await this.alertas.pendentesDigest(
      { usuarioId: input.usuarioId, aPartirDe: input.janela.inicio, limite },
      signal,
    );

    if (totalPendentes === 0) return { enviados: 0, agrupados: 0, total: 0 };

    const canal = Canal.criar(preferencia.canais[0] ?? 'EMAIL');
    const notificacao = Notificacao.criar({
      tenantId: input.tenantId, usuarioId: input.usuarioId,
      alertaId: selecionados[0].id,   // âncora do registro de auditoria
      canal,
    });

    try {
      await this.notifier.enviar({
        canal,
        destinatario: input.emailDestinatario,
        assunto: `${selecionados.length} novo(s) alerta(s) — Radar de Licitações`,
        corpo: montarCorpoDigest(selecionados, excedentes),
        signal,
      });
      notificacao.marcarEnviada();
    } catch (err) {
      notificacao.marcarFalhou();
      throw new CanalIndisponivelError(canal.tipo);
    } finally {
      await this.notificacoes.salvar(notificacao, signal);
    }

    await this.eventos.publicar(new NotificacaoEnviada(notificacao), signal);
    return {
      enviados: selecionados.length,
      agrupados: excedentes.reduce((n, e) => n + e.quantidade, 0),
      total: totalPendentes,
    };
  }
}
```

**Montagem do corpo do digest** (helper — sem lógica de negócio). Os selecionados chegam já ordenados por prazo e aderência (§3); o excedente vira linhas agregadas por critério/órgão, **nunca** e-mails individuais (docs/11, §4):

```ts
// application/helpers/montar-corpo-digest.ts
function montarCorpoDigest(
  alertas: AlertaResumoDTO[],
  excedentes: ExcedenteAgrupadoDTO[],
): string {
  const linhas = alertas.map(a =>
    `• ${a.objeto} · ${a.orgao} · Prazo: ${a.prazoProposta} · Aderência: ${(a.aderencia * 100).toFixed(0)}%`
  );
  if (excedentes.length === 0) return linhas.join('\n');

  const total = excedentes.reduce((n, e) => n + e.quantidade, 0);
  const grupos = excedentes.map(e =>
    `• ${e.quantidade} em "${e.criterioNome}" · ${e.orgao}`
  );
  return [
    ...linhas,
    `\n+ ${total} alerta(s) além do limite desta edição — agrupados abaixo, todos disponíveis no painel:`,
    ...grupos,
  ].join('\n');
}
```

## 5. Camada infra — adaptadores

### 5.1 Adapter de e-mail

```ts
// infra/email/ses-notifier.ts — adapta SES (AWS) à porta Notifier
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';

export class SesNotifier implements Notifier {
  constructor(private readonly ses: SESClient, private readonly remetente: string) {}

  async enviar(params: {
    canal: Canal; destinatario: string; assunto: string; corpo: string;
    signal?: AbortSignal;
  }): Promise<void> {
    if (!params.canal.ehEmail) throw new CanalIndisponivelError(params.canal.tipo);
    try {
      await this.ses.send(
        new SendEmailCommand({
          Source: this.remetente,
          Destination: { ToAddresses: [params.destinatario] },
          Message: {
            Subject: { Data: params.assunto, Charset: 'UTF-8' },
            Body: { Text: { Data: params.corpo, Charset: 'UTF-8' } },
          },
        }),
        { abortSignal: params.signal },
      );
    } catch (err) {
      // Falha de infra → CanalIndisponivelError; nunca vaza detalhe técnico (P-71)
      throw new CanalIndisponivelError('EMAIL');
    }
  }
}
```

### 5.2 Adapters de persistência

```ts
// infra/db/postgres-notificacao-repository.ts (esqueleto)
export class PostgresNotificacaoRepository implements NotificacaoRepository {
  async salvar(n: Notificacao, signal?: AbortSignal): Promise<void> {
    // INSERT INTO NOTIFICACAO ... ON CONFLICT (id) DO UPDATE
    // (idempotência de upsert — reprocessamento de mensagem da fila)
  }
  async jaNotificado(alertaId: AlertaId, usuarioId: UsuarioId): Promise<boolean> {
    // SELECT EXISTS (SELECT 1 FROM NOTIFICACAO WHERE alerta_id=? AND usuario_id=? AND status='ENVIADA')
  }
}

// infra/db/postgres-preferencia-repository.ts (esqueleto)
export class PostgresPreferenciaRepository implements PreferenciaRepository {
  async porUsuario(id: UsuarioId, signal?: AbortSignal): Promise<PreferenciaDTO | null> {
    // SELECT * FROM PREFERENCIA_NOTIFICACAO WHERE usuario_id=?
  }
  async salvar(p: PreferenciaDTO, signal?: AbortSignal): Promise<void> {
    // INSERT INTO PREFERENCIA_NOTIFICACAO ... ON CONFLICT (usuario_id) DO UPDATE
  }
}
```

## 6. Modelo físico — tabelas do contexto

Tabelas exclusivas do Notificação no banco do MVP (complementam o modelo de docs/12 §1):

```mermaid
erDiagram
    ALERTA ||--o{ NOTIFICACAO : origina
    USUARIO_PREFERENCIA ||--o{ NOTIFICACAO : guia

    NOTIFICACAO {
        uuid id PK
        uuid tenant_id
        uuid usuario_id FK
        uuid alerta_id FK
        varchar canal
        varchar status
        timestamptz criada_em
        timestamptz enviada_em
    }
    USUARIO_PREFERENCIA {
        uuid usuario_id PK
        varchar[] canais
        varchar frequencia
        timestamptz atualizada_em
    }
```

Índice crítico: `(alerta_id, usuario_id, status)` em `NOTIFICACAO` — consulta de idempotência no `jaNotificado`.

## 7. Anti-fadiga e agrupamento (docs/11, §4 · P-81)

Os números abaixo são **decisão de Produto fechada** (Produto/Priscila, 2026-07-11, RAD-200 → docs/98 P-81). Esta seção só diz onde cada um vive no código — não reabre a decisão.

| Mecanismo | Onde é implementado | Detalhe |
|-----------|---------------------|---------|
| **Entrega imediata por criticidade** | `Alerta.imediato` (Matching, A15 §2) + `NotificarAlertaUseCase` | Crítico = prazo final em até **3 dias corridos** **OU** aderência **≥ 0,80** (condição **OU**), decidido no Matching e consumido via `input.imediato` (RAD-313). Entrega na hora, mesmo com preferência de digest |
| **Cap por frequência** | `EnviarDigestUseCase` (`CAP_DIGEST`) | **10** itens no digest diário, **25** no semanal, por usuário |
| **Crítico fora do cap** | `AlertaRepository.pendentesDigest` | O crítico já entregue tem `NOTIFICACAO ENVIADA` e é excluído do pool do digest — não espera o digest nem ocupa vaga no cap |
| **Ordenação** | `pendentesDigest` (borda) + contrato do §3 | Prazo mais próximo primeiro; empate desempata por aderência desc |
| **Excedente agrupado** | `montarCorpoDigest` + `ExcedenteAgrupadoDTO` | O que passa do cap volta agregado por **critério/órgão** (contagem) e fica acessível no painel; nunca vira e-mail individual |
| **Frequência configurável** | `DefinirPreferenciasNotificacaoUseCase` | Padrão **DIÁRIA**; usuário pode mudar para SEMANAL ou IMEDIATA |
| **Idempotência de entrega** | `NotificacaoRepository.jaNotificado` | Não reenvia o mesmo alerta em retry da fila |

**Ordem de preservação sob pressão.** Quando o volume estoura (fan-out de matching — A04 §4 S4, A06 §ALERTA), a degradação é **nesta ordem, de baixo para cima** — corta-se sempre o de baixo primeiro:

1. **Alerta crítico** (prazo ≤ 3 dias ou aderência ≥ 0,80) — nunca é degradado para digest, nunca é cortado por cap, nunca é agrupado. É o último a cair; se ele não sai, o produto falhou.
2. **Top-cap do digest** (10 diário / 25 semanal), ordenado por prazo → aderência: o usuário sempre vê o mais urgente e mais aderente em detalhe.
3. **Excedente**: perde o detalhe, vira contagem agrupada por critério/órgão no corpo do digest + acesso no painel.
4. **Nada** vira e-mail individual não-crítico. Sob pressão, o sistema aumenta o agrupamento — nunca o número de mensagens.

A consequência arquitetural é que a query do digest é **limitada por construção** (`limite` no `pendentesDigest`, §3): 5.000 alertas pendentes para um usuário produzem uma leitura de 10 linhas + um agregado, não 5.000 linhas em memória.

## 8. Canais no MVP e evolução

No MVP apenas **e-mail** é implementado. A abstração `Notifier` + `Canal` já suporta novos adaptadores sem mudar os use cases:

| Canal | MVP | Next/Later |
|-------|-----|------------|
| `EMAIL` | `SesNotifier` | — |
| `WEBHOOK` | — `[A VALIDAR]` → P-82 | Adapter via HTTP |
| `IN_APP` | — | Push / SSE |

## 9. Mapeamento de erro na borda

Segue o padrão de arquitetura/10 §6. Na entrypoint do consumidor de fila (worker):

```ts
// infra/queue/notificacao-worker.ts

/** Contrato canônico de `alerta.gerado` (A03 §3). Sem usuarioId nem emailDestinatario. */
interface AlertaGeradoMsg {
  alertaId: string;
  tenantId: string;
  clienteFinalId: string;   // Matching conhece o dono do critério, não o destinatário
  imediato: boolean;        // Alerta.imediato do Matching (P-81) — repassado, não recalculado (RAD-313)
}

export class NotificacaoWorker {
  async processar(msg: AlertaGeradoMsg, signal: AbortSignal): Promise<void> {
    try {
      await notificarAlertaUC.executar(
        {
          alertaId: AlertaId(msg.alertaId),
          tenantId: TenantId(msg.tenantId),
          clienteFinalId: ClienteFinalId(msg.clienteFinalId),
          imediato: msg.imediato,
        },
        signal,
      );
    } catch (err) {
      if (err instanceof CanalIndisponivelError) {
        // Canal instável → NACK com retry (max 3×, depois DLQ) — degradação graciosa
        throw err;
      }
      // DomainError inesperado → DLQ imediato (não há retry útil)
      await dlq.encaminhar(msg, err);
    }
  }
}
```

## 10. Como respeita as decisões anteriores

- **Eventos como Published Language (docs/13, §5):** consome `alerta.gerado` e publica `notificacao.enviada` — nenhum acoplamento direto ao Matching.
- **Shared Kernel `tenantId` (docs/13, §5):** presente em `Notificacao` e em toda query.
- **AbortSignal em todo use case (arquitetura/10, §1):** todos os 3 use cases propagam o sinal.
- **Port sem tecnologia no nome (arquitetura/10, §8):** `Notifier`, `PreferenciaRepository` — nunca `SesClient` ou `PostgresRepository`.
- **Idempotência na fila (arquitetura/03, §3):** `jaNotificado` antes de enviar.
- **Anti-fadiga e digest (docs/11, §4 · P-81):** criticidade por prazo **ou** aderência decidida no Matching (`Alerta.imediato`) e consumida via `input.imediato` no `NotificarAlertaUseCase` (RAD-313, sem recálculo cross-contexto); cap por frequência (10/25), ordenação prazo→aderência e excedente agrupado no `EnviarDigestUseCase` — com a ordem de preservação sob pressão do §7.

## 11. Pendências

- Provedor de e-mail transacional (SES vs. SendGrid vs. Postmark) e DPA de sub-operador (docs/02, §9). `[A VALIDAR]` → P-80
- **P-81 — RESOLVIDO (Produto/Priscila, 2026-07-11, RAD-200; alinhamento arquitetural: RAD-206).** Criticidade = prazo ≤ 3 dias corridos **ou** aderência ≥ 0,80; digest padrão diário, configurável para semanal; cap 10 (diário) / 25 (semanal) por usuário; excedente agrupado por critério/órgão; crítico não espera digest nem conta no cap. Refletido nos §§2.1, 3, 4.2, 4.3, 7, 10. Cap por frequência (10, 25) é **config injetada** (`CAP_DIGEST`) no composition root de Notificação.
- **RAD-313 — correção de onde o P-81 é implementado (segue achado do guardiao-arquitetura na RAD-303).** A RAD-207 havia implementado os limiares de criticidade (3 dias, 0,80) **duas vezes**: no Matching (`AderenciaMatching.ehAlta`) e, redundantemente, em Notificação (`LimiaresCriticidade` + VO `Criticidade`, lendo `diasAtePrazo`/`aderencia` crus via cross-context read) — duas fontes de verdade independentes do mesmo P-81, risco de drift se o limiar mudasse num lugar e não no outro. A partir da RAD-313, o cálculo vive **só** no Matching (`Alerta.imediato`, A15 §2); Notificação consome o fato publicado em `alerta.gerado` (`payload.imediato`) via `NotificarAlertaInput.imediato` — não tem mais VO nem config própria para isso. `AlertaRepository.porId` (cross-context read) permanece, mas só para montar o corpo do e-mail (objeto/órgão/prazo/aderência) — desenhar o read-model de produção dessa leitura é outra frente, cruzada com `revisar-ddd` (Published Language vs. Open-Host).
- Canal webhook e in-app: escopo e adapter no *Next*. `[A VALIDAR]` → P-82
- **Contrato `alerta.gerado` alinhado (2026-07-05):** o evento carrega `clienteFinalId` (escopo), **não** `usuarioId`/`emailDestinatario` — o destinatário (usuário + e-mail) é **resolvido aqui** a partir de `clienteFinalId` via leitura cross-contexto de Identidade/preferência (Gateway; MVP 1:1, P-25). O worker (§9) e o `NotificarAlertaUseCase` precisam refletir isso — ver contrato autoritativo em [arquitetura/03](03-desenho-da-solucao.md), §3 e RAD-24.

Rastreadas em [../docs/98](../docs/98-decisoes-e-pendencias.md).
