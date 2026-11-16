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
import Settings from './pages/Settings';
import Admin from './pages/Admin';
import { PersonPage } from './pages/AdminOverview';
import Notifications from './pages/Notifications';
import Reports from './pages/Reports';
import CalendarPage from './pages/Calendar';

function Routed() {
  const { session } = useApp();
  if (!session) return <Login />;
  return (
    <Shell>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/leads" element={<Leads />} />
        <Route path="/leads/:id" element={<LeadPage />} />
        <Route path="/out" element={<OutList />} />
        <Route path="/upload" element={<Upload />} />
        <Route path="/team" element={<Navigate to="/admin?tab=team" replace />} />
        <Route path="/admin" element={<Admin />} />
        <Route path="/admin/people/:id" element={<PersonPage />} />
        <Route path="/notifications" element={<Notifications />} />
        <Route path="/reports" element={<Reports />} />
        <Route path="/clients" element={<ComingSoon title="Clients" what="Your book of funded clients, households, holdings and returns." />} />
        <Route path="/onboarding" element={<ComingSoon title="Onboarding" what="RIA onboards in the Flameback app, PMS through Silver Bullet. Committed leads will appear here with their onboarding status." />} />
        <Route path="/reviews" element={<ComingSoon title="Reviews" what="Quarterly and annual client reviews with prep views." />} />
        <Route path="/tasks" element={<Tasks />} />
        <Route path="/settings" element={<Settings />} />
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
