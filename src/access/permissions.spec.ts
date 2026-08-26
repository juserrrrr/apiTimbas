import { ALL_PERMISSIONS, DASHBOARD_PERMISSIONS, PERMISSION_CATEGORIES, isKnownPermission, sanitizeDashboardPermissions, sanitizePermissions } from './permissions';

describe('catálogo de permissões', () => {
  it('não tem chave repetida', () => {
    expect(new Set(ALL_PERMISSIONS).size).toBe(ALL_PERMISSIONS.length);
  });

  it('descreve toda permissão com rótulo e explicação', () => {
    for (const category of PERMISSION_CATEGORIES) {
      for (const permission of category.permissions) {
        expect(permission.label.length).toBeGreaterThan(2);
        expect(permission.hint.length).toBeGreaterThan(5);
      }
    }
  });
});

describe('sanitizePermissions', () => {
  it('tira chave inventada e repetida', () => {
    expect(sanitizePermissions(['catalog.manage', 'catalog.manage', 'voar.livre'])).toEqual(['catalog.manage']);
  });

  it('devolve vazio quando nada bate', () => {
    expect(sanitizePermissions(['nada', ''])).toEqual([]);
  });

  it('reconhece só o que existe no catálogo', () => {
    expect(isKnownPermission('groups.manage')).toBe(true);
    expect(isKnownPermission('groups.destroy')).toBe(false);
  });
});

describe('sanitizeDashboardPermissions', () => {
  it('impede permissões administrativas no acesso inicial', () => {
    expect(sanitizeDashboardPermissions(['dashboard.home', 'users.manage', 'dashboard.home'])).toEqual(['dashboard.home']);
    expect(DASHBOARD_PERMISSIONS).toContain('dashboard.settings');
  });
});
