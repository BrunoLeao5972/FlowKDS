const mongoose = require('mongoose');

const restaurantSettingsSchema = new mongoose.Schema(
  {
    tenantId: { type: String, required: true, default: 'legacy' },
    tempoMedio: { type: Number, default: 15 },
    tempoAlerta: { type: Number, default: 20 },
    tempoCritico: { type: Number, default: 25 },
    tradeName: { type: String, default: '' },
    legalName: { type: String, default: '' },
    cnpj: { type: String, default: '' },
    cep: { type: String, default: '' },
    street: { type: String, default: '' },
    number: { type: String, default: '' },
    city: { type: String, default: '' },
    complement: { type: String, default: '' },
    orderNumberMode: { type: String, default: 'continuous' },
    customStartNumber: { type: Number, default: 100 },
    lastResetDate: { type: String, default: null },
    licenseFileName: { type: String, default: null },
    licenseContent: { type: String, default: null },
    newOrderSound: { type: String, default: '/Songs/Efeito Sonoro - Chegou Pedido.mp3' },
    readyOrderSound: { type: String, default: '/Songs/Efeito Sonoro - Pedido Pronto.mp3' },
    newOrderSoundEnabled: { type: Boolean, default: true },
    readyOrderSoundEnabled: { type: Boolean, default: true },
    printerName: { type: String, default: '' },
    printSize: { type: String, default: '80mm' },
    printScale: { type: Number, default: 115 },
    panelColor: { type: String, default: '#FF6B35' },
    animationsEnabled: { type: Boolean, default: true },
    updatedBy: { type: String, default: null },
    enabledServiceModes: [{ type: String, default: null }],
    panelEnabledServiceModes: [{ type: String, default: null }],
  },
  {
    collection: 'restaurant_settings',
    versionKey: false,
    timestamps: true,
  }
);

restaurantSettingsSchema.index({ tenantId: 1 }, { unique: true });

module.exports = mongoose.model('RestaurantSettings', restaurantSettingsSchema);
