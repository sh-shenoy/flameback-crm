import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import './styles.css';
import { isConfigured } from './lib/supabase';
import { AuthProvider, useApp } from './auth';
import { ComingSoon, ToastProvider } from './components/ui';
import Shell from './components/Shell';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Leads from './pages/Leads';
import LeadPage from './pages/LeadPage';
import OutList from './pages/OutList';
import Upload from './pages/Upload';
import Tasks from './pages/Tasks';
import Connections from './pages/Connections';
import Help from './pages/Help';
import AdminHome from './pages/AdminHome';
import DailyLog from './pages/DailyLog';
import Prospects from './pages/Prospects';
import Clients from './pages/Clients';
import Admin from './pages/Admin';
import { PersonPage } from './pages/AdminOverview';
import Notifications from './pages/Notifications';
import Reports from './pages/Reports';
import CalendarPage from './pages/Calendar';

function Home() {
  const { isAdmin } = useApp();
  return isAdmin ? <AdminHome /> : <Dashboard />;
}

function Routed() {
  const { session } = useApp();
  if (!session) return <Login />;
  return (
    <Shell>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/leads" element={<Leads />} />
        <Route path="/leads/:id" element={<LeadPage />} />
        <Route path="/out" element={<OutList />} />
        <Route path="/upload" element={<Upload />} />
        <Route path="/team" element={<Navigate to="/admin?tab=team" replace />} />
        <Route path="/admin" element={<Admin />} />
        <Route path="/admin/people/:id" element={<PersonPage />} />
        <Route path="/notifications" element={<Notifications />} />
        <Route path="/reports" element={<Reports />} />
        <Route path="/clients" element={<Clients />} />
        <Route path="/prospects" element={<Prospects />} />
        <Route path="/onboarding" element={<Navigate to="/prospects" replace />} />
        <Route path="/reviews" element={<ComingSoon title="Reviews" what="Quarterly and annual client reviews with prep views." />} />
        <Route path="/tasks" element={<Tasks />} />
        <Route path="/connections" element={<Connections />} />
        <Route path="/help" element={<Help />} />
        <Route path="/log" element={<DailyLog />} />
        <Route path="/settings" element={<Navigate to="/connections" replace />} />
        <Route path="/calendar" element={<CalendarPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Shell>
  );
}

function NotConfigured() {
  return (
    <div className="boot">
      <div className="panel pad" style={{ maxWidth: 520 }}>
        <h2>Connect the database</h2>
        <p className="muted">Set <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> in <code>app/.env</code> (see <code>.env.example</code>), then restart.</p>
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isConfigured ? (
      <HashRouter>
        <ToastProvider>
          <AuthProvider>
            <Routed />
          </AuthProvider>
        </ToastProvider>
      </HashRouter>
    ) : <NotConfigured />}
  </StrictMode>,
);
