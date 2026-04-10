/**
 * Theme.js - Modelo MongoDB para armazenar temas personalizados por restaurante/tenant
 * 
 * Estrutura:
 * - Uma coleção 'themes' que armazena temas por tenant
 * - Cada tema contém cores primária, secundária, fundo, cards, textos, etc.
 * - Suporta múltiplos temas por tenant (salvar presets)
 * - Validação básica de cores e contraste WCAG
 */

const mongoose = require('mongoose');

const ColorFieldSchema = new mongoose.Schema({
  label: String, // ex: "Cor Primária"
  hex: {
    type: String,
    match: /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/,
    required: true
  },
  rgb: {
    r: { type: Number, min: 0, max: 255 },
    g: { type: Number, min: 0, max: 255 },
    b: { type: Number, min: 0, max: 255 }
  }
}, { _id: false });

/**
 * Schema principal do Tema
 */
const ThemeSchema = new mongoose.Schema({
  // Chave de tenant (restaurante/cliente)
  // ⭐ String (não ObjectId) para suportar tenantId legado como "legacy"
  tenantId: {
    type: String,
    required: true,
    index: true
  },

  // Identificação do tema
  name: {
    type: String,
    required: true,
    trim: true,
    maxlength: 100
  },

  description: {
    type: String,
    trim: true,
    maxlength: 500
  },

  // Flag para indicar se é o tema ativo/default
  isActive: {
    type: Boolean,
    default: false
  },

  // Cores principais do sistema
  colors: {
    primary: {
      hex: { type: String, match: /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/, required: true },
      label: { type: String, default: 'Cor Primária' }
    },
    secondary: {
      hex: { type: String, match: /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/, required: true },
      label: { type: String, default: 'Cor Secundária' }
    },
    background: {
      hex: { type: String, match: /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/, required: true },
      label: { type: String, default: 'Fundo' }
    },
    surface: {
      hex: { type: String, match: /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/, required: true },
      label: { type: String, default: 'Cards/Superfície' }
    },
    text: {
      hex: { type: String, match: /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/, required: true },
      label: { type: String, default: 'Texto Principal' }
    },
    textSecondary: {
      hex: { type: String, match: /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/, required: true },
      label: { type: String, default: 'Texto Secundário' }
    },
    accent: {
      hex: { type: String, match: /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/, required: true },
      label: { type: String, default: 'Destaque/Urgente' }
    },
    border: {
      hex: { type: String, match: /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/, required: true },
      label: { type: String, default: 'Bordas' }
    },
    success: {
      hex: { type: String, match: /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/, required: true },
      label: { type: String, default: 'Sucesso' }
    },
    warning: {
      hex: { type: String, match: /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/, required: true },
      label: { type: String, default: 'Aviso' }
    },
    error: {
      hex: { type: String, match: /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/, required: true },
      label: { type: String, default: 'Erro' }
    }
  },

  // Metadata de contraste (calculado automaticamente)
  contrastMetrics: {
    primaryVsBackground: { type: Number, min: 1, max: 21 },
    textVsBackground: { type: Number, min: 1, max: 21 },
    textVsSurface: { type: Number, min: 1, max: 21 },
    wcagAACompliant: Boolean, // True se contraste >= 4.5:1 para textos
    wcagAAACompliant: Boolean // True se contraste >= 7:1 para textos
  },

  // Timestamps
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  updatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }
}, {
  collection: 'themes',
  timestamps: true
});

/**
 * Índices
 */
ThemeSchema.index({ tenantId: 1, isActive: 1 });
ThemeSchema.index({ tenantId: 1, name: 1 }, { unique: true });

/**
 * Métodos do Schema
 */

/**
 * Converte hex para RGB
 */
ThemeSchema.statics.hexToRgb = function(hex) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16)
  } : null;
};

/**
 * Calcula luminância relativa (algoritmo WCAG)
 */
ThemeSchema.statics.getLuminance = function(rgb) {
  const { r, g, b } = rgb;
  const [rs, gs, bs] = [r, g, b].map(x => {
    x = x / 255;
    return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
};

/**
 * Calcula razão de contraste entre duas cores
 */
ThemeSchema.statics.getContrastRatio = function(hex1, hex2) {
  const rgb1 = this.hexToRgb(hex1);
  const rgb2 = this.hexToRgb(hex2);
  
  if (!rgb1 || !rgb2) return null;

  const l1 = this.getLuminance(rgb1);
  const l2 = this.getLuminance(rgb2);
  
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  
  return (lighter + 0.05) / (darker + 0.05);
};

/**
 * Middleware: atualiza updatedAt e calcula contraste antes de salvar
 */
ThemeSchema.pre('save', async function(next) {
  try {
    // Atualiza updatedAt
    this.updatedAt = new Date();

    // Calcula métricas de contraste
    const Theme = this.constructor;
    const colors = this.colors;

    this.contrastMetrics = {
      primaryVsBackground: Theme.getContrastRatio(colors.primary.hex, colors.background.hex) || 0,
      textVsBackground: Theme.getContrastRatio(colors.text.hex, colors.background.hex) || 0,
      textVsSurface: Theme.getContrastRatio(colors.text.hex, colors.surface.hex) || 0,
      wcagAACompliant: (Theme.getContrastRatio(colors.text.hex, colors.background.hex) || 0) >= 4.5,
      wcagAAACompliant: (Theme.getContrastRatio(colors.text.hex, colors.background.hex) || 0) >= 7
    };

    next();
  } catch (error) {
    next(error);
  }
});

/**
 * Middleware: ao ativar um tema, desativa os outros do mesmo tenant
 */
ThemeSchema.pre('save', async function(next) {
  if (this.isActive && this.tenantId) {
    try {
      // Desativa todos os outros temas deste tenant
      await this.constructor.updateMany(
        { tenantId: this.tenantId, _id: { $ne: this._id } },
        { isActive: false }
      );
    } catch (error) {
      return next(error);
    }
  }
  next();
});

/**
 * Método para converter tema par ao formato CSS Variables
 */
ThemeSchema.methods.toCSSVariables = function() {
  return {
    '--color-primary': this.colors.primary.hex,
    '--color-secondary': this.colors.secondary.hex,
    '--color-background': this.colors.background.hex,
    '--color-surface': this.colors.surface.hex,
    '--color-text': this.colors.text.hex,
    '--color-text-secondary': this.colors.textSecondary.hex,
    '--color-accent': this.colors.accent.hex,
    '--color-border': this.colors.border.hex,
    '--color-success': this.colors.success.hex,
    '--color-warning': this.colors.warning.hex,
    '--color-error': this.colors.error.hex,
  };
};

/**
 * Método para obter tema em formato de objeto simples
 */
ThemeSchema.methods.toJSON = function() {
  const obj = this.toObject();
  return {
    id: obj._id,
    tenantId: obj.tenantId,
    name: obj.name,
    description: obj.description,
    isActive: obj.isActive,
    colors: obj.colors,
    contrastMetrics: obj.contrastMetrics,
    createdAt: obj.createdAt,
    updatedAt: obj.updatedAt
  };
};

module.exports = mongoose.model('Theme', ThemeSchema);
