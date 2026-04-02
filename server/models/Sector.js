const mongoose = require('mongoose');

/**
 * Setor do restaurante, sincronizado a partir da tabela `setores` do SQL Server.
 * O bridge popula esta coleção a cada ciclo de sincronização.
 */
const sectorSchema = new mongoose.Schema(
  {
    tenantId: { type: String, required: true, default: 'legacy', index: true },
    /** Código do setor vindo do SQL (coluna Codigo/SetorID). */
    sectorId: { type: String, required: true },
    /** Descrição/nome do setor vindo do SQL (coluna Descricao/Nome). */
    name: { type: String, required: true },
    /** Ordem de exibição (posição retornada pelo SQL). */
    sortOrder: { type: Number, default: 0 },
  },
  {
    versionKey: false,
    collection: 'sectors',
    timestamps: true,
  }
);

sectorSchema.index({ tenantId: 1, sectorId: 1 }, { unique: true });

module.exports = mongoose.model('Sector', sectorSchema);
