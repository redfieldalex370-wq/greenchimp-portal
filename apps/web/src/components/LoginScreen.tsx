import { FormEvent, useState } from 'react';

export function LoginScreen({
  onLogin
}: {
  onLogin: (username: string, password: string) => Promise<void>;
}) {
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('cambia-esta-clave');
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
        <p className="login-copy">Atiende WhatsApp sin compartir las llaves del servidor con el navegador.</p>

        <form onSubmit={submit} className="login-form">
          <label>
            Usuario o correo
            <input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" />
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

        <p className="demo-note">El repositorio inicia en modo demostración. Cambia las credenciales en <code>.env</code>.</p>
      </section>
    </main>
  );
}
