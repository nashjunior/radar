import JSZip from 'jszip';
import { ExtracaoZipInseguroError } from '../../../domain/errors/index.js';

// ---------------------------------------------------------------------------
// Tetos de segurança contra zip bomb (arq/02 §6.2). NUNCA baseados no tamanho
// declarado no header do zip: `uncompressedSize`/`compressedSize` são metadado
// escrito pelo próprio atacante — o JSZip só compara o real contra o declarado
// DEPOIS de inflar o stream inteiro (achado real via PoC na revisão de
// segurança: um header mentiroso passa incólume por qualquer checagem que
// confie nesse campo). A guarda de verdade mede bytes conforme eles saem do
// inflate de fato e interrompe o worker no meio — ver `lerEntradaComTeto`.
// ---------------------------------------------------------------------------

const MAX_ENTRADAS = 200;
const MAX_TAMANHO_DESCOMPACTADO_POR_ARQUIVO = 200 * 1024 * 1024; // 200 MB
const MAX_TAMANHO_DESCOMPACTADO_TOTAL = 500 * 1024 * 1024; // 500 MB
export const MAX_PROFUNDIDADE_ANINHAMENTO = 3;

/**
 * Zip slip: nunca confiar no caminho interno de uma entrada (dado não confiável,
 * docs/05). Rejeita travessia de diretório e caminhos absolutos — mesmo que este
 * extrator nunca escreva em disco, a validação é a barreira contra reuso futuro
 * do nome da entrada.
 */
function validarCaminhoSeguro(nome: string): void {
  if (nome.startsWith('/') || nome.startsWith('\\') || /^[a-zA-Z]:/.test(nome) || nome.split(/[/\\]/).includes('..')) {
    // Nome de entrada é dado não confiável (até 65535 bytes, conteúdo livre no
    // formato zip) — trunca antes de compor a mensagem (evita log bloat/injection).
    throw new ExtracaoZipInseguroError(`entrada com caminho inseguro: '${nome.slice(0, 200)}'`);
  }
}

export interface EntradaZipInfo {
  nome: string;
  dir: boolean;
}

/**
 * Valida a lista de entradas — nº de entradas e caminho de cada uma. São os
 * únicos aspectos estruturalmente confiáveis de um zip não descompactado (o
 * nº de entradas vem da própria estrutura do diretório central, não de um
 * campo isolado que o atacante possa declarar livremente); tamanho/razão de
 * compressão declarados NÃO entram aqui — ver cabeçalho do arquivo.
 */
export function validarEntradasContraTetos(entradas: readonly EntradaZipInfo[]): void {
  if (entradas.length > MAX_ENTRADAS) {
    throw new ExtracaoZipInseguroError(`número de entradas (${entradas.length}) excede o limite (${MAX_ENTRADAS})`);
  }
  for (const entrada of entradas) {
    validarCaminhoSeguro(entrada.nome);
  }
}

/**
 * Carrega um ZIP e aplica as guardas estruturais (zip slip + nº de entradas)
 * ANTES de descompactar qualquer conteúdo — fail-closed (arq/02 §6.2). O teto
 * de tamanho/zip bomb é aplicado depois, por `lerEntradaComTeto`, na leitura
 * real de cada entrada (nunca no metadado declarado do header).
 */
export async function carregarZipComGuardas(bytes: Uint8Array, signal: AbortSignal): Promise<JSZip> {
  signal.throwIfAborted();

  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(bytes);
  } catch {
    throw new ExtracaoZipInseguroError('zip corrompido ou ilegível');
  }

  const entradas: EntradaZipInfo[] = Object.keys(zip.files).map((nome) => ({
    nome,
    dir: zip.files[nome]!.dir,
  }));

  validarEntradasContraTetos(entradas);
  return zip;
}

/**
 * Orçamento de bytes descompactados compartilhado por toda uma extração
 * (inclusive entradas de zips aninhados) — teto total contra zip bomb
 * (arq/02 §6.2). Um único orçamento nasce no topo de `extrair()` e desce por
 * toda a recursão, para que a soma de várias entradas "pequenas o bastante
 * individualmente" não escape do limite total.
 */
export class OrcamentoDescompactacao {
  private restante: number;

  constructor(limiteTotal: number = MAX_TAMANHO_DESCOMPACTADO_TOTAL) {
    this.restante = limiteTotal;
  }

  consumir(bytes: number): void {
    this.restante -= bytes;
  }

  excedido(): boolean {
    return this.restante < 0;
  }
}

/** Subconjunto do `StreamHelper` interno do JSZip usado por `internalStream`.
 * Não tipado no `.d.ts` público do pacote, mas estável (`lib/stream/StreamHelper.js`);
 * `pause()` propaga até o worker de inflate e realmente para a descompactação —
 * diferente de `Readable.destroy()` no stream Node (`nodeStream()`), que só
 * para de ENTREGAR chunks e deixa o worker interno rodando até o fim (testado
 * empiricamente na revisão de segurança deste PR). */
interface StreamHelperInterno {
  on(evento: 'data', ouvinte: (dado: Uint8Array) => void): StreamHelperInterno;
  on(evento: 'end', ouvinte: () => void): StreamHelperInterno;
  on(evento: 'error', ouvinte: (erro: unknown) => void): StreamHelperInterno;
  resume(): StreamHelperInterno;
  pause(): StreamHelperInterno;
}

function streamInternoDaEntrada(entry: JSZip.JSZipObject): StreamHelperInterno {
  return (entry as unknown as { internalStream(tipo: 'uint8array'): StreamHelperInterno }).internalStream(
    'uint8array',
  );
}

function concatenar(pedacos: readonly Uint8Array[], tamanhoTotal: number): Uint8Array {
  const resultado = new Uint8Array(tamanhoTotal);
  let offset = 0;
  for (const pedaco of pedacos) {
    resultado.set(pedaco, offset);
    offset += pedaco.length;
  }
  return resultado;
}

/**
 * Lê uma entrada do zip com descompactação real, sob teto de bytes — nunca
 * confia no tamanho declarado no header (arq/02 §6.2). Ao exceder o teto por
 * arquivo OU o orçamento total, chama `pause()` no `StreamHelper` interno do
 * JSZip, que interrompe de fato o worker de inflate (não só a entrega de
 * chunks) antes de produzir o restante do bomb.
 */
export async function lerEntradaComTeto(
  entry: JSZip.JSZipObject,
  orcamento: OrcamentoDescompactacao,
  signal: AbortSignal,
): Promise<Uint8Array> {
  signal.throwIfAborted();

  return new Promise<Uint8Array>((resolve, reject) => {
    const helper = streamInternoDaEntrada(entry);
    const pedacos: Uint8Array[] = [];
    let total = 0;
    let liquidado = false;

    const falhar = (erro: unknown): void => {
      if (liquidado) return;
      liquidado = true;
      helper.pause();
      reject(erro);
    };

    const onAbort = (): void => falhar(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });

    helper
      .on('data', (chunk) => {
        if (liquidado) return;

        total += chunk.length;
        orcamento.consumir(chunk.length);

        if (total > MAX_TAMANHO_DESCOMPACTADO_POR_ARQUIVO) {
          falhar(
            new ExtracaoZipInseguroError(
              `entrada '${entry.name.slice(0, 200)}' excede o tamanho descompactado máximo por arquivo (zip bomb detectado na descompactação real)`,
            ),
          );
          return;
        }
        if (orcamento.excedido()) {
          falhar(new ExtracaoZipInseguroError('orçamento total de descompactação excedido (possível zip bomb)'));
          return;
        }

        pedacos.push(chunk);
      })
      .on('end', () => {
        if (liquidado) return;
        liquidado = true;
        signal.removeEventListener('abort', onAbort);
        resolve(concatenar(pedacos, total));
      })
      .on('error', (erro) => falhar(erro))
      .resume();
  });
}

/** Sniff por magic bytes — mesma lógica do `pncp-http-gateway`, aplicada aqui às
 * entradas internas de um zip (que não têm mime resolvido externamente). */
export function ehPdf(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 5 &&
    bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 && bytes[4] === 0x2d
  );
}

export function ehZip(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 4 &&
    bytes[0] === 0x50 && bytes[1] === 0x4b &&
    (bytes[2] === 0x03 || bytes[2] === 0x05 || bytes[2] === 0x07) &&
    (bytes[3] === 0x04 || bytes[3] === 0x06 || bytes[3] === 0x08)
  );
}
