import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './auth/AuthProvider';
import { AppShell } from './components/AppShell';
import { AuditPage, MembersPage, OverviewPage, SitesPage } from './pages/DataPages';
import { LoginPage } from './pages/LoginPage';
import { DeveloperPanel } from './platform/DeveloperPanel';
import { TenantsPage } from './platform/TenantsPage';
import { WorkspaceProvider } from './workspace/WorkspaceProvider';

export function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <WorkspaceProvider>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="plataforma" element={<DeveloperPanel />}>
              <Route index element={<TenantsPage />} />
            </Route>
            <Route element={<AppShell />}>
              <Route index element={<OverviewPage />} />
              <Route path="sites" element={<SitesPage />} />
              <Route path="membros" element={<MembersPage />} />
              <Route path="auditoria" element={<AuditPage />} />
            </Route>
          </Routes>
        </WorkspaceProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
