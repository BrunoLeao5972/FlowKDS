export function isAnonymousCustomerName(customerName?: string) {
  const normalized = String(customerName || '').trim().toLowerCase();
  return !normalized || normalized === 'geral' || normalized === 'cliente sem cadastro' || normalized === 'cliente não cadastrado';
}

export function getDisplayCustomerName(customerName?: string) {
  return isAnonymousCustomerName(customerName) ? '' : String(customerName).trim();
}

const PANEL_MAX_CHARS = 25;

/**
 * Retorna o nome para exibição no card do Painel (PublicDisplayPage),
 * truncando em 25 caracteres para evitar invasão de outros cards.
 */
export function getPanelCustomerName(customerName?: string) {
  const name = getDisplayCustomerName(customerName);
  if (!name) return '';
  return name.length > PANEL_MAX_CHARS ? name.slice(0, PANEL_MAX_CHARS).trimEnd() + '…' : name;
}

export function getPrintableCustomerName(customerName?: string) {
  return isAnonymousCustomerName(customerName) ? 'Cliente não cadastrado' : String(customerName).trim();
}
