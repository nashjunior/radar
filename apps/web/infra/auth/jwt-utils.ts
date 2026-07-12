/** Utilitários de leitura de claims de um JWT (sem verificação de assinatura). */

/** Extrai o claim `email` do payload de um JWT. Retorna null se ausente ou inválido. */
export function extrairEmailDeJwt(token: string): string | null {
  try {
    const partes = token.split('.');
    if (partes.length < 2 || !partes[1]) return null;
    const decoded = JSON.parse(
      atob(partes[1].replace(/-/g, '+').replace(/_/g, '/')),
    ) as Record<string, unknown>;
    const email = decoded['email'];
    return typeof email === 'string' ? email : null;
  } catch {
    return null;
  }
}
