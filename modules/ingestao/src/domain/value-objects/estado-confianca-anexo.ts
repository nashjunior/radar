/** Estado de confiança de um anexo no fluxo trust-gating (P-104, AB14). */
export type EstadoConfiancaAnexo = 'pendente' | 'limpo' | 'rejeitado';

/** Todo anexo recém-armazenado nasce em quarentena até aprovação do scanner. */
export const ESTADO_INICIAL_ANEXO: EstadoConfiancaAnexo = 'pendente';
