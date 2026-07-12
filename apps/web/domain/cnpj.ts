/** Regras de documento CNPJ (algoritmo de dígito verificador). */

/** Valida os dois dígitos verificadores do CNPJ. Aceita string com ou sem máscara. */
export function validarCnpjDv(cnpj: string): boolean {
  const d = cnpj.replace(/\D/g, '');
  if (d.length !== 14) return false;
  if (/^(\d)\1{13}$/.test(d)) return false;
  const calcDv = (len: number) => {
    let soma = 0;
    let peso = len - 7;
    for (let i = 0; i < len; i++) {
      soma += Number(d[i]) * peso--;
      if (peso < 2) peso = 9;
    }
    const r = soma % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return calcDv(12) === Number(d[12]) && calcDv(13) === Number(d[13]);
}
