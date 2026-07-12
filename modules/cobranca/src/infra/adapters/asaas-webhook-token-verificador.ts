import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * Compara o header `asaas-access-token` contra o CONJUNTO de segredos válidos
 * (vigente + anterior, RAD-261 — janela de rotação do Secrets Manager, P-08) em
 * TEMPO CONSTANTE — a compensação exigida quando o provedor não oferece HMAC no
 * raw body (P-107 (5), aceite RAD-239/RAD-253).
 *
 * `timingSafeEqual` lança se os buffers têm tamanho diferente, o que reintroduz um
 * oráculo de tempo pelo COMPRIMENTO do token recebido; hasheamos os dois lados
 * primeiro (saída sempre de 32 bytes) para eliminar essa variação sem abrir mão da
 * comparação byte-a-byte constante.
 *
 * Todo `segredo` não vazio da lista é comparado — nunca para no primeiro match
 * (sem `.some()`/early-return dentro do loop), para não reintroduzir um oráculo de
 * tempo pela POSIÇÃO do segredo que validou.
 */
export function tokenWebhookAsaasValido(recebido: string | undefined | null, segredos: readonly string[]): boolean {
  if (!recebido) return false;
  const recebidoHash = hash(recebido);
  let valido = false;
  for (const segredo of segredos) {
    if (!segredo) continue;
    if (timingSafeEqual(recebidoHash, hash(segredo))) valido = true;
  }
  return valido;
}

function hash(valor: string): Buffer {
  return createHash('sha256').update(valor, 'utf8').digest();
}
