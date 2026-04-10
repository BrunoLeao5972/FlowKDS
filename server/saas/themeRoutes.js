/**
 * themeRoutes.js - Rotas de API para gerenciamento de temas
 * 
 * GET    /themes              - Lista temas do tenant
 * GET    /themes/active       - Obtém tema ativo
 * GET    /themes/:id          - Obtém tema específico
 * POST   /themes              - Cria novo tema
 * PUT    /themes/:id          - Atualiza tema
 * DELETE /themes/:id          - Deleta tema
 * POST   /themes/:id/activate - Ativa um tema
 * POST   /themes/validate     - Valida cores (sem salvar)
 * GET    /themes/suggest/palette - Sugere paleta
 */

const express = require('express');
const router = express.Router();
const Theme = require('../models/Theme');
const ThemeValidator = require('../services/ThemeValidator');

// LEGACY_TENANT_ID: todos os temas compartilhados neste tenant padrão
// SEM validação JWT - temas são independentes de tokens expirados
const LEGACY_TENANT_ID = process.env.LEGACY_TENANT_ID || 'legacy';

/**
 * Middleware: Resolve tenantId SEM validar JWT
 * 
 * Temas são INDEPENDENTES de JWT - qualquer um pode acessar/salvar
 * Usa sempre LEGACY_TENANT_ID (compartilhado entre todos os usuários)
 * 
 * NÃO depende de:
 * - JWT expirados
 * - Bearer tokens válidos
 * - Autenticação de qualquer tipo
 * 
 * Prioridade:
 * 1. Se há req.tenant (do tenantMiddleware) → usa tenantId dele
 * 2. Se há req.authUser (usuário logado) → usa tenantId dele
 * 3. Fallback: LEGACY_TENANT_ID para todos
 */
router.use((req, res, next) => {
  // Tenta obter tenantId de alguma fonte, mas NUNCA rejeita
  const tenantIdFromAuthUser = req.authUser?.tenantId;
  const tenantIdFromTenant = req.tenant?._id;
  
  // Define req.user.tenantId com prioridade
  req.user = {
    id: req.authUser?.id || 'anonymous',
    username: req.authUser?.username || 'anonymous',
    tenantId: tenantIdFromAuthUser || tenantIdFromTenant || LEGACY_TENANT_ID,
    isAdmin: req.authUser?.isAdmin || false
  };
  
  console.log('[Themes] ✓ Tenant resolvido para:', req.user.tenantId, '(Usuário:', req.user.username + ')');
  return next();
});

/**
 * Função auxiliar: Obtém tenantId do request
 * Nunca retorna undefined, sempre tem um valor
 */
const getTenantId = (req) => {
  return req.user?.tenantId || LEGACY_TENANT_ID;
};

/**
 * GET /themes
 * Lista todos os temas do tenant com paginação
 */
router.get('/', async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || 10);
    const skip = (page - 1) * limit;

    const [themes, total] = await Promise.all([
      Theme.find({ tenantId })
        .sort({ isActive: -1, updatedAt: -1 })
        .skip(skip)
        .limit(limit),
      Theme.countDocuments({ tenantId })
    ]);

    // Mapeia temas para formato correto com 'id' em vez de '_id'
    const themesFormatted = themes.map(t => t.toJSON());

    res.json({
      themes: themesFormatted,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Erro ao listar temas:', error);
    res.status(500).json({ error: 'Erro ao listar temas' });
  }
});

/**
 * GET /themes/active
 * Obtém o tema ativo do tenant
 * ⚠️ DEVE vir antes de /:id para ter prioridade
 * Sempre retorna um tema com ID válido (cria um padrão se necessário)
 */
router.get('/active', async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    
    // Tenta buscar tema ativo
    let theme = await Theme.findOne({ tenantId, isActive: true });

    // Se não houver ativo, busca o mais recente
    if (!theme) {
      theme = await Theme.findOne({ tenantId }).sort({ updatedAt: -1 });
    }

    // Se ainda não existir, CRIA um tema padrão no banco
    if (!theme) {
      const defaultTheme = new Theme({
        tenantId,
        name: 'Padrão do Sistema',
        colors: getDefaultTheme(),
        isActive: true,
        description: 'Tema padrão criado automaticamente'
      });
      theme = await defaultTheme.save();
    }

    // Retorna usando toJSON para garantir estrutura correta com 'id'
    res.json(theme.toJSON());
  } catch (error) {
    console.error('Erro ao obter tema ativo:', error);
    res.status(500).json({ error: 'Erro ao obter tema ativo' });
  }
});

/**
 * POST /themes/validate
 * Valida cores sem salvar
 * ⚠️ DEVE vir antes de /:id para ter prioridade
 */
router.post('/validate', (req, res) => {
  try {
    const { colors } = req.body;

    if (!colors) {
      return res.status(400).json({ error: 'Colors é obrigatório' });
    }

    const validation = ThemeValidator.validateTheme(colors);

    res.json(validation);
  } catch (error) {
    console.error('Erro ao validar tema:', error);
    res.status(500).json({ error: 'Erro ao validar tema' });
  }
});

/**
 * GET /themes/suggest/palette
 * Sugere uma paleta baseada em uma cor primária
 * ⚠️ DEVE vir antes de /:id para ter prioridade
 */
router.get('/suggest/palette', (req, res) => {
  try {
    const { primaryColor } = req.query;

    if (!primaryColor) {
      return res.status(400).json({ error: 'primaryColor é obrigatório' });
    }

    const palette = ThemeValidator.suggestPalette(primaryColor);

    if (!palette) {
      return res.status(400).json({ error: 'Cor primária inválida' });
    }

    res.json({ palette });
  } catch (error) {
    console.error('Erro ao sugerir paleta:', error);
    res.status(500).json({ error: 'Erro ao sugerir paleta' });
  }
});

/**
 * GET /themes/:id
 * Obtém tema específico
 * ⚠️ DEVE vir DEPOIS das rotas específicas (/active, /suggest/palette, /validate)
 */
router.get('/:id', async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    const theme = await Theme.findOne({
      _id: req.params.id,
      tenantId
    });

    if (!theme) {
      return res.status(404).json({ error: 'Tema não encontrado' });
    }

    res.json(theme.toJSON());
  } catch (error) {
    console.error('Erro ao obter tema:', error);
    res.status(500).json({ error: 'Erro ao obter tema' });
  }
});

/**
 * POST /themes
 * Cria novo tema
 */
router.post('/', async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    const { name, description, colors, isActive } = req.body;

    console.log('\n=== POST /saas/themes ===');
    console.log('tenantId:', tenantId);
    console.log('name:', name);
    console.log('description:', description);
    console.log('isActive:', isActive);
    console.log('colors:', JSON.stringify(colors, null, 2));

    // Valida colors
    const validation = ThemeValidator.validateTheme(colors);
    console.log('validation result:', validation);
    
    if (!validation.isValid) {
      console.log('❌ Validação falhou:', validation.errors);
      return res.status(400).json({
        error: 'Cores inválidas',
        details: validation.errors
      });
    }

    console.log('✓ Validação passou, criando tema...');
    const theme = new Theme({
      tenantId,
      name: name || 'Novo Tema',
      description,
      colors,
      isActive: isActive || false,
      createdBy: req.user?.id
    });

    await theme.save();
    console.log('✓ Tema salvo com sucesso:', theme._id);

    res.status(201).json({
      message: 'Tema criado com sucesso',
      theme: theme.toJSON(),
      validation
    });
  } catch (error) {
    console.error('❌ Erro ao criar tema:', error.message);
    console.error(error.stack);
    
    if (error.code === 11000) { // Erro de duplicação de índice único
      return res.status(400).json({ error: 'Já existe um tema com esse nome' });
    }

    res.status(500).json({ error: 'Erro ao criar tema', message: error.message });
  }
});

/**
 * PUT /themes/:id
 * Atualiza tema
 */
router.put('/:id', async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    const { name, description, colors, isActive } = req.body;

    // Valida colors se fornecidas
    if (colors) {
      const validation = ThemeValidator.validateTheme(colors);
      if (!validation.isValid) {
        return res.status(400).json({
          error: 'Cores inválidas',
          details: validation.errors
        });
      }
    }

    const updateData = {
      updatedBy: req.user?.id,
      updatedAt: new Date()
    };

    if (name) updateData.name = name;
    if (description !== undefined) updateData.description = description;
    if (colors) updateData.colors = colors;
    if (isActive !== undefined) updateData.isActive = isActive;

    const theme = await Theme.findOneAndUpdate(
      { _id: req.params.id, tenantId },
      updateData,
      { new: true, runValidators: true }
    );

    if (!theme) {
      return res.status(404).json({ error: 'Tema não encontrado' });
    }

    res.json({
      message: 'Tema atualizado com sucesso',
      theme: theme.toJSON()
    });
  } catch (error) {
    console.error('Erro ao atualizar tema:', error);
    res.status(500).json({ error: 'Erro ao atualizar tema' });
  }
});

/**
 * DELETE /themes/:id
 * Deleta tema
 */
router.delete('/:id', async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    
    const theme = await Theme.findOneAndDelete({
      _id: req.params.id,
      tenantId
    });

    if (!theme) {
      return res.status(404).json({ error: 'Tema não encontrado' });
    }

    // Se era o tema ativo, ativa o mais recente
    if (theme.isActive) {
      const nextActive = await Theme.findOne({ tenantId }).sort({ updatedAt: -1 });
      if (nextActive) {
        await Theme.updateOne({ _id: nextActive._id }, { isActive: true });
      }
    }

    res.json({ message: 'Tema deletado com sucesso' });
  } catch (error) {
    console.error('Erro ao deletar tema:', error);
    res.status(500).json({ error: 'Erro ao deletar tema' });
  }
});

/**
 * POST /themes/:id/activate
 * Ativa um tema
 */
router.post('/:id/activate', async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    
    // Atualiza o tema (middleware pré-save cuida de desativar outros)
    const theme = await Theme.findOneAndUpdate(
      { _id: req.params.id, tenantId },
      { isActive: true, updatedAt: new Date() },
      { new: true }
    );

    if (!theme) {
      return res.status(404).json({ error: 'Tema não encontrado' });
    }

    res.json({
      message: 'Tema ativado com sucesso',
      theme: theme.toJSON()
    });
  } catch (error) {
    console.error('Erro ao ativar tema:', error);
    res.status(500).json({ error: 'Erro ao ativar tema' });
  }
});

/**
 * Tema padrão do sistema
 */
function getDefaultTheme() {
  return {
    primary: { hex: '#FF6B35' },
    secondary: { hex: '#457B9D' },
    background: { hex: '#FFFFFF' },
    surface: { hex: '#F5F5F5' },
    text: { hex: '#1A1A1A' },
    textSecondary: { hex: '#666666' },
    accent: { hex: '#E63946' },
    border: { hex: '#E0E0E0' },
    success: { hex: '#4CAF50' },
    warning: { hex: '#FFC107' },
    error: { hex: '#F44336' }
  };
}

module.exports = router;
