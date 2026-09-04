import { FormEvent, useState } from 'react';

export function LoginScreen({
  onLogin
}: {
  onLogin: (username: string, password: string) => Promise<void>;
}) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError('');
    setLoading(true);
    try {
      await onLogin(username, password);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No fue posible iniciar sesión.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="login-shell">
      <section className="login-card">
        <div className="brand-mark brand-mark--large">GC</div>
        <p className="eyebrow">GREEN CHIMP · INTERNO</p>
        <h1>Portal de conversaciones</h1>

        <form onSubmit={submit} className="login-form">
          <label>
            Correo electrónico
            <input type="email" value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" required />
          </label>
          <label>
            Contraseña
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
            />
          </label>
          {error && <div className="form-error">{error}</div>}
          <button className="primary-button" disabled={loading}>
            {loading ? 'Entrando…' : 'Entrar al portal'}
          </button>
        </form>

        <p className="demo-note">El acceso y los permisos se administran desde Green Chimp.</p>
      </section>
    </main>
  );
}
