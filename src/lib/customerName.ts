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

function isMesaOuCartao(serviceMode?: string | null) {
  const normalized = String(serviceMode || '').trim().toLowerCase();
  return normalized === 'mesa' || normalized === 'cartao';
}

export function getResponsibleDisplayName(options: {
  serviceMode?: string | null;
  attendant?: string | null;
  sellerName?: string | null;
}) {
  const serviceMode = String(options.serviceMode || '').trim().toLowerCase();
  const attendant = String(options.attendant || '').trim();
  const sellerName = String(options.sellerName || '').trim();

  if (serviceMode === 'mesa') {
    return sellerName || (attendant ? `Mesa ${attendant}` : '');
  }

  if (serviceMode === 'cartao') {
    return sellerName || (attendant ? `Cartão ${attendant}` : '');
  }

  if (serviceMode === 'apartamento') {
    return sellerName || (attendant ? `Apto ${attendant}` : '');
  }

  if (serviceMode === 'servico') {
    return attendant ? `Serviço ${attendant}` : '';
  }

  if (serviceMode === 'balcao' || serviceMode === 'delivery' || serviceMode === 'encomenda') {
    return attendant ? `Atendente: ${attendant}` : '';
  }

  return sellerName || attendant;
}

export function getPrintableTicketIdentity(options: {
  customerName?: string | null;
  serviceMode?: string | null;
  attendant?: string | null;
  sellerName?: string | null;
}) {
  const customerName = getPrintableCustomerName(options.customerName || '');

  if (isMesaOuCartao(options.serviceMode)) {
    const responsibleName = getResponsibleDisplayName(options);
    if (responsibleName) {
      return {
        label: 'Responsável',
        name: responsibleName,
      };
    }
  }

  return {
    label: 'Cliente',
    name: customerName,
  };
}
