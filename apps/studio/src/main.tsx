import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from '@tanstack/react-query';
import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { api } from './api';
import { LoginScreen, SetupScreen } from './screens/access';
import { WorkspaceScreen } from './screens/workspace';
import './styles.css';

const client = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } });

function Root() {
  const queryClient = useQueryClient();
  const [screen, setScreen] = useState<'auto' | 'setup'>('auto');
  const session = useQuery({ queryKey: ['me'], queryFn: api.me, retry: false });

  if (session.isLoading) return <div className="access"><p className="placeholder">Cargando…</p></div>;

  const refresh = () => {
    setScreen('auto');
    void queryClient.invalidateQueries();
  };

  if (screen === 'setup') return <SetupScreen onDone={refresh} onCancel={() => setScreen('auto')} />;
  if (!session.data) return <LoginScreen onDone={refresh} onSetup={() => setScreen('setup')} />;

  return (
    <WorkspaceScreen
      onLogout={async () => {
        await api.logout();
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
