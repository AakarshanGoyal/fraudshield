import { Navigate, Route, Routes } from 'react-router-dom';
import { homeFor, useAuth } from './auth/AuthContext';
import { RoleGuard } from './auth/RoleGuard';
import { Layout } from './components/Layout';
import { Spinner } from './components/ui';
import AlertDetailPage from './pages/analyst/AlertDetail';
import AlertQueue from './pages/analyst/AlertQueue';
import CardholderHome from './pages/cardholder/CardholderHome';
import Login from './pages/Login';
import Approvals from './pages/manager/Approvals';
import Audit from './pages/manager/Audit';
import ConfigPage from './pages/manager/Config';
import Dashboard from './pages/manager/Dashboard';
import Simulate from './pages/Simulate';

function Home() {
  const { user, loading } = useAuth();
  if (loading) return <Spinner />;
  return <Navigate to={user ? homeFor(user.role) : '/login'} replace />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route element={<Layout />}>
        <Route element={<RoleGuard roles={['CARDHOLDER']} />}>
          <Route path="/cardholder" element={<CardholderHome />} />
        </Route>
        <Route element={<RoleGuard roles={['ANALYST', 'MANAGER']} />}>
          <Route path="/analyst" element={<AlertQueue />} />
          <Route path="/analyst/alerts/:alertId" element={<AlertDetailPage />} />
          <Route path="/simulate" element={<Simulate />} />
        </Route>
        <Route element={<RoleGuard roles={['MANAGER']} />}>
          <Route path="/manager" element={<Dashboard />} />
          <Route path="/manager/approvals" element={<Approvals />} />
          <Route path="/manager/audit" element={<Audit />} />
          <Route path="/manager/config" element={<ConfigPage />} />
        </Route>
      </Route>
      <Route path="*" element={<Home />} />
    </Routes>
  );
}
