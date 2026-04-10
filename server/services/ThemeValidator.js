/**
 * ThemeValidator.js - Serviço para validar e calcular métricas de contraste de temas
 * 
 * Implementa WCAG 2.1 para validação de acessibilidade
 */

class ThemeValidator {
  /**
   * Converte hexadecimal para RGB
   * @param {string} hex - Cor em formato #RRGGBB ou #RGB
   * @returns {Object} {r, g, b} ou null se inválido
   */
  static hexToRgb(hex) {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    if (result) {
      return {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16)
      };
    }
    
    // Suporta #RGB (3 dígitos)
    const shortResult = /^#?([a-f\d])([a-f\d])([a-f\d])$/i.exec(hex);
    if (shortResult) {
      return {
        r: parseInt(shortResult[1] + shortResult[1], 16),
        g: parseInt(shortResult[2] + shortResult[2], 16),
        b: parseInt(shortResult[3] + shortResult[3], 16)
      };
    }
    
    return null;
  }

  /**
   * Converte RGB para hexadecimal
   * @param {number} r, g, b
   * @returns {string} Cor em formato #RRGGBB
   */
  static rgbToHex(r, g, b) {
    return '#' + [r, g, b].map(x => {
      const hex = x.toString(16);
      return hex.length === 1 ? '0' + hex : hex;
    }).join('').toUpperCase();
  }

  /**
   * Valida formato de cor hexadecimal
   * @param {string} hex
   * @returns {boolean}
   */
  static isValidHex(hex) {
    if (!hex || typeof hex !== 'string') return false;
    return /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/.test(hex);
  }

  /**
   * Calcula luminância relativa (algoritmo WCAG)
   * @param {Object} rgb - {r, g, b}
   * @returns {number}
   */
  static getLuminance(rgb) {
    if (!rgb) return 0;
    const { r, g, b } = rgb;
    const [rs, gs, bs] = [r, g, b].map(x => {
      x = x / 255;
      return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
  }

  /**
   * Calcula razão de contraste entre duas cores (WCAG)
   * @param {string} hex1 - Primeira cor
   * @param {string} hex2 - Segunda cor
   * @returns {number} Razão de contraste (1-21)
   */
  static getContrastRatio(hex1, hex2) {
    const rgb1 = this.hexToRgb(hex1);
    const rgb2 = this.hexToRgb(hex2);
    
    if (!rgb1 || !rgb2) {
      console.warn(`Invalid hex color: ${hex1} or ${hex2}`);
      return 1;
    }

    const l1 = this.getLuminance(rgb1);
    const l2 = this.getLuminance(rgb2);
    
    const lighter = Math.max(l1, l2);
    const darker = Math.min(l1, l2);
    
    return (lighter + 0.05) / (darker + 0.05);
  }

  /**
   * Determina se contraste atende WCAG AA (4.5:1 para textos, 3:1 para UI)
   * @param {number} ratio
   * @param {string} level - 'AA' ou 'AAA'
   * @returns {boolean}
   */
  static isWCAGCompliant(ratio, level = 'AA') {
    if (level === 'AAA') return ratio >= 7; // Aprimorado
    return ratio >= 4.5; // AA - padrão
  }

  /**
   * Valida tema inteiro e retorna relatório de erros
   * @param {Object} colors - Objeto com cores {primary, secondary, background, ...}
   * @returns {Object} {isValid, errors, warnings, metrics}
   */
  /**
   * Valida tema inteiro e retorna relatório de erros
   * Versão simplificada: apenas checa se existe todas as 11 cores
   * @param {Object} colors - Objeto com cores {primary, secondary, background, ...}
   * @returns {Object} {isValid, errors, warnings, metrics}
   */
  static validateTheme(colors) {
    const errors = [];
    const warnings = [];

    // Cores obrigatórias
    const requiredColors = ['primary', 'secondary', 'background', 'surface', 'text', 'textSecondary', 'accent', 'border', 'success', 'warning', 'error'];
    
    // Verifica se cada cor existe e tem hex válido
    for (const colorKey of requiredColors) {
      const colorValue = colors[colorKey];
      
      if (!colorValue) {
        errors.push(`Cor '${colorKey}' faltando`);
        continue;
      }

      // Extrai hex de dois formatos possíveis: {hex: '#...'} ou '#...'
      const hex = typeof colorValue === 'string' ? colorValue : colorValue?.hex;
      
      if (!hex || !this.isValidHex(hex)) {
        errors.push(`Cor '${colorKey}' inválida: ${hex}`);
      }
    }

    // Se há erros, retorna early
    if (errors.length > 0) {
      return { isValid: false, errors, warnings, metrics: {} };
    }

    // Calcula contrastes (apenas para warnings, não falha validação)
    try {
      const primaryVsBackground = this.getContrastRatio(
        colors.primary.hex || colors.primary, 
        colors.background.hex || colors.background
      );
      const textVsBackground = this.getContrastRatio(
        colors.text.hex || colors.text,
        colors.background.hex || colors.background
      );

      if (textVsBackground < 4.5) {
        warnings.push(`Contraste texto/fundo baixo (${textVsBackground.toFixed(2)})`);
      }
    } catch (e) {
      // Ignora erros de contraste
    }

    return {
      isValid: true,
      errors: [],
      warnings,
      metrics: {}
    };
  }

  /**
   * Gera uma cor complementar
   * @param {string} hex
   * @returns {string} Cor complementar em hex
   */
  static getComplementaryColor(hex) {
    const rgb = this.hexToRgb(hex);
    if (!rgb) return null;

    const complementary = {
      r: 255 - rgb.r,
      g: 255 - rgb.g,
      b: 255 - rgb.b
    };

    return this.rgbToHex(complementary.r, complementary.g, complementary.b);
  }

  /**
   * Gera uma cor mais clara (reduz saturação)
   * @param {string} hex
   * @param {number} percent - 0-100
   * @returns {string} Cor mais clara em hex
   */
  static lightenColor(hex, percent = 20) {
    const rgb = this.hexToRgb(hex);
    if (!rgb) return null;

    const lightened = {
      r: Math.min(255, Math.round(rgb.r + (255 - rgb.r) * (percent / 100))),
      g: Math.min(255, Math.round(rgb.g + (255 - rgb.g) * (percent / 100))),
      b: Math.min(255, Math.round(rgb.b + (255 - rgb.b) * (percent / 100)))
    };

    return this.rgbToHex(lightened.r, lightened.g, lightened.b);
  }

  /**
   * Gera uma cor mais escura
   * @param {string} hex
   * @param {number} percent - 0-100
   * @returns {string} Cor mais escura em hex
   */
  static darkenColor(hex, percent = 20) {
    const rgb = this.hexToRgb(hex);
    if (!rgb) return null;

    const darkened = {
      r: Math.max(0, Math.round(rgb.r * (1 - percent / 100))),
      g: Math.max(0, Math.round(rgb.g * (1 - percent / 100))),
      b: Math.max(0, Math.round(rgb.b * (1 - percent / 100)))
    };

    return this.rgbToHex(darkened.r, darkened.g, darkened.b);
  }

  /**
   * Sugere uma paleta de cores a partir de uma cor primária
   * @param {string} primaryHex
   * @returns {Object} Paleta sugerida
   */
  static suggestPalette(primaryHex) {
    if (!this.isValidHex(primaryHex)) return null;

    return {
      primary: primaryHex,
      secondary: this.getComplementaryColor(primaryHex),
      background: '#FFFFFF',
      surface: '#F5F5F5',
      text: '#1A1A1A',
      textSecondary: '#666666',
      accent: this.lightenColor(primaryHex, 10),
      border: '#E0E0E0',
      success: '#4CAF50',
      warning: '#FFC107',
      error: '#F44336'
    };
  }
}

module.exports = ThemeValidator;
