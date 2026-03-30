const mongoose = require('mongoose');

const restaurantSettingsSchema = new mongoose.Schema(
  {
    tenantId: { type: String, required: true, default: 'legacy', index: true },
    tradeName: { type: String, default: '' },
    legalName: { type: String, default: '' },
    cnpj: { type: String, default: '' },
    cep: { type: String, default: '' },
    street: { type: String, default: '' },
    number: { type: String, default: '' },
    city: { type: String, default: '' },
    complement: { type: String, default: '' },
    updatedBy: { type: String, default: null },
  },
  {
    collection: 'restaurant_settings',
    versionKey: false,
    timestamps: true,
  }
);

restaurantSettingsSchema.index({ tenantId: 1 }, { unique: true });

module.exports = mongoose.model('RestaurantSettings', restaurantSettingsSchema);
