import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from '@tanstack/react-query';
import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { api, whenSessionEnds } from './api';
import { AcceptInvitationScreen, ForgotPasswordScreen, LoginScreen, ResetPasswordScreen, SetupScreen } from './screens/access';
import { WorkspaceScreen } from './screens/workspace';
import './styles.css';

type Screen = { kind: 'auto' } | { kind: 'setup' } | { kind: 'forgot' } | { kind: 'invitation'; token: string } | { kind: 'reset'; token: string };

function takeLinkFromFragment(): Screen {
  const fragment = new URLSearchParams(window.location.hash.slice(1));
  const invitation = fragment.get('invitation');
  const reset = fragment.get('reset');
  if (invitation || reset) window.history.replaceState(null, '', window.location.pathname);
  if (invitation) return { kind: 'invitation', token: invitation };
  if (reset) return { kind: 'reset', token: reset };
  return { kind: 'auto' };
}

const initialScreen = takeLinkFromFragment();
const client = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } });
whenSessionEnds(() => void client.invalidateQueries({ queryKey: ['me'] }));

function Root() {
  const queryClient = useQueryClient();
  const [screen, setScreen] = useState<Screen>(initialScreen);
  const linkScreen = screen.kind === 'invitation' || screen.kind === 'reset';
  const session = useQuery({ queryKey: ['me'], queryFn: api.me, retry: false, enabled: !linkScreen });

  const toLogin = () => {
    setScreen({ kind: 'auto' });
    void queryClient.invalidateQueries();
  };

  if (screen.kind === 'invitation') return <AcceptInvitationScreen token={screen.token} onDone={toLogin} onCancel={toLogin} />;
  if (screen.kind === 'reset') return <ResetPasswordScreen token={screen.token} onDone={toLogin} />;
  if (screen.kind === 'setup') return <SetupScreen onDone={toLogin} onCancel={toLogin} />;
  if (screen.kind === 'forgot') return <ForgotPasswordScreen onBack={toLogin} />;

  if (session.isLoading) return <div className="access"><p className="placeholder">Cargando…</p></div>;
  if (!session.data) {
    return <LoginScreen onDone={toLogin} onSetup={() => setScreen({ kind: 'setup' })} onForgot={() => setScreen({ kind: 'forgot' })} />;
  }

  return (
    <WorkspaceScreen
      onLogout={async () => {
        await api.logout().catch(() => undefined);
        queryClient.clear();
      }}
    />
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={client}>
      <Root />
    </QueryClientProvider>
  </StrictMode>,
);
