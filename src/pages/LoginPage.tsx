import { FormEvent, useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';

const PERMITTED_ROUTES = [
  { path: '/', permission: 'admin' },
  { path: '/kitchen', permission: 'kitchen' },
  { path: '/display', permission: 'display' },
];

function firstPermittedPath(perms: string[]): string {
  return PERMITTED_ROUTES.find(r => perms.includes(r.permission))?.path ?? '/';
}

export default function LoginPage() {
  const { login, isAuthenticated, permissions } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const from = (location.state as { from?: string } | null)?.from || '';

  // Se já está autenticado, vai para a primeira página permitida (ou para onde vinha)
  useEffect(() => {
    if (isAuthenticated) {
      const target = from && PERMITTED_ROUTES.some(r => r.path === from && permissions.includes(r.permission))
        ? from
        : firstPermittedPath(permissions);
      navigate(target, { replace: true });
    }
  }, [isAuthenticated, navigate, from, permissions]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const perms = await login(username, password);
      const target = from && PERMITTED_ROUTES.some(r => r.path === from && perms.includes(r.permission))
        ? from
        : firstPermittedPath(perms);
      navigate(target, { replace: true });
    } catch {
      setError('Usuario ou senha invalidos.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="h-screen w-screen flex items-center justify-center px-4 relative overflow-hidden">
      {/* Background desktop */}
      <div
        className="absolute inset-0 hidden sm:block bg-cover bg-center bg-no-repeat"
        style={{ backgroundImage: 'url(/login-bg.png)' }}
      />

      {/* Background mobile */}
      <div
        className="absolute inset-0 sm:hidden bg-cover bg-center bg-no-repeat"
        style={{ backgroundImage: 'url(/loginkdscelular.png)' }}
      />

      {/* Overlay escuro para melhor legibilidade */}
      <div className="absolute inset-0 bg-black/50 z-10" />
      
      {/* Conteúdo do formulário */}
      <section className="w-full max-w-md bg-card border border-border rounded-xl shadow-lg p-6 relative z-20">
        <h1 className="text-2xl font-bold text-foreground">Entrar no KDS</h1>
        <p className="text-sm text-muted-foreground mt-1">Use as credenciais do cliente para acessar o painel.</p>

        <form className="mt-6 space-y-4" onSubmit={onSubmit}>
          <div>
            <label className="block text-sm font-medium mb-1" htmlFor="username">Usuario</label>
            <input
              id="username"
              type="text"
              value={username}
              onChange={e => setUsername(e.target.value)}
              className="w-full h-10 rounded-md border border-input bg-background px-3"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1" htmlFor="password">Senha</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="w-full h-10 rounded-md border border-input bg-background px-3"
              required
            />
          </div>

          {error ? <p className="text-sm text-red-600">{error}</p> : null}

          <button
            type="submit"
            disabled={loading}
            className="w-full h-10 rounded-md bg-primary text-primary-foreground font-medium disabled:opacity-60"
          >
            {loading ? 'Processando...' : 'Entrar'}
          </button>
        </form>
      </section>
    </main>
  );
}
