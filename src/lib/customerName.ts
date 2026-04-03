export function isAnonymousCustomerName(customerName?: string) {
  const normalized = String(customerName || '').trim().toLowerCase();
  return !normalized || normalized === 'geral' || normalized === 'cliente sem cadastro' || normalized === 'cliente não cadastrado';
}

export function getDisplayCustomerName(customerName?: string) {
  return isAnonymousCustomerName(customerName) ? '' : String(customerName).trim();
}

export function getPrintableCustomerName(customerName?: string) {
  return isAnonymousCustomerName(customerName) ? 'Cliente não cadastrado' : String(customerName).trim();
}
