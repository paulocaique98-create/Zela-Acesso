import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './auth/AuthProvider';
import { AppShell } from './components/AppShell';
import { AuditPage, MembersPage, OverviewPage, SitesPage } from './pages/DataPages';
import { AccessPointsPage, BuildingsPage } from './pages/PhysicalPages';
import { PoliciesPage } from './pages/PolicyPages';
import { GroupsPage, PeoplePage, ZonesPage } from './pages/RegistryPages';
import { HolidaysPage, SchedulesPage } from './pages/SchedulePages';
import { LoginPage } from './pages/LoginPage';
import { Toaster } from './components/Toaster';
import { OrgSupportPage } from './pages/OrgSupportPage';
import { BiometricsPage } from './platform/BiometricsPage';
import { DeveloperPanel, OwnerOnly } from './platform/DeveloperPanel';
import { ErrorLogsPage } from './platform/ErrorLogsPage';
import { PlansPage } from './platform/PlansPage';
import { SettingsPage } from './platform/SettingsPage';
import { PlatformSupportPage } from './platform/SupportPage';
import { TenantModulesPage } from './platform/TenantModulesPage';
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
              <Route path="organizacoes/:id/modulos" element={<TenantModulesPage />} />
              <Route
                path="planos"
                element={
                  <OwnerOnly>
                    <PlansPage />
                  </OwnerOnly>
                }
              />
              <Route path="logs" element={<ErrorLogsPage />} />
              <Route path="biometria" element={<BiometricsPage />} />
              <Route path="suporte" element={<PlatformSupportPage />} />
              <Route path="configuracoes" element={<SettingsPage />} />
            </Route>
            <Route element={<AppShell />}>
              <Route index element={<OverviewPage />} />
              <Route path="sites" element={<SitesPage />} />
              <Route path="predios" element={<BuildingsPage />} />
              <Route path="zonas" element={<ZonesPage />} />
              <Route path="pontos" element={<AccessPointsPage />} />
              <Route path="pessoas" element={<PeoplePage />} />
              <Route path="grupos" element={<GroupsPage />} />
              <Route path="politicas" element={<PoliciesPage />} />
              <Route path="janelas" element={<SchedulesPage />} />
              <Route path="feriados" element={<HolidaysPage />} />
              <Route path="membros" element={<MembersPage />} />
              <Route path="auditoria" element={<AuditPage />} />
              <Route path="suporte" element={<OrgSupportPage />} />
            </Route>
          </Routes>
          <Toaster />
        </WorkspaceProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
