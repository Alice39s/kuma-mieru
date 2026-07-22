import '@fontsource-variable/manrope';
import '@fontsource-variable/newsreader';
import { Activity } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Toaster } from 'sonner';
import { getAdminSession, getSetupStatus, type AdminSession } from '../admin/api';
import { LoginGate, SetupGate } from '../admin/auth-gates';
import { Workbench } from '../admin/workbench';
import '../admin/workbench.css';

type Gate = 'loading' | 'setup' | 'login' | 'workbench';

export const Component = () => {
  const [gate, setGate] = useState<Gate>('loading');
  const [session, setSession] = useState<AdminSession | null>(null);

  const discover = useCallback(async () => {
    setGate('loading');
    try {
      const setup = await getSetupStatus();
      if (setup.data.required) {
        setSession(null);
        setGate('setup');
        return;
      }
      try {
        const activeSession = await getAdminSession();
        setSession(activeSession);
        setGate('workbench');
      } catch {
        setSession(null);
        setGate('login');
      }
    } catch {
      setSession(null);
      setGate('login');
    }
  }, []);

  useEffect(() => {
    void discover();
  }, [discover]);

  return (
    <div className="admin-root">
      {gate === 'loading' ? (
        <div className="admin-loading">
          <span>
            <Activity size={22} />
          </span>
          <p>Reading control-plane state</p>
        </div>
      ) : null}
      {gate === 'setup' ? <SetupGate onComplete={() => setGate('login')} /> : null}
      {gate === 'login' ? <LoginGate onComplete={() => void discover()} /> : null}
      {gate === 'workbench' && session ? (
        <Workbench
          session={session}
          onSignedOut={() => {
            setSession(null);
            setGate('login');
          }}
        />
      ) : null}
      <Toaster position="bottom-right" richColors closeButton />
    </div>
  );
};
