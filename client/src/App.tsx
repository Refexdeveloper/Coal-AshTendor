import { Route, Routes } from "react-router-dom";
import AdminPage from "@client/screens/admin";
import LoginPage from "@client/screens/login";
import MainLayout from "@client/screens/main-layout";
import NewTenderPage from "@client/screens/new-tender";
import NotificationsPage from "@client/screens/notifications";
import DashboardPage from "@client/screens/pipeline";
import PortalsPage from "@client/screens/portals";
import RegisterPage from "@client/screens/register";
import ReportsPage from "@client/screens/reports";
import TenderPage from "@client/screens/tender-detail";
import WorklistPage from "@client/screens/worklist";

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<MainLayout />}>
        <Route index element={<DashboardPage />} />
        <Route path="worklist" element={<WorklistPage />} />
        <Route path="register" element={<RegisterPage />} />
        <Route path="tenders/new" element={<NewTenderPage />} />
        <Route path="tenders/:id" element={<TenderPage />} />
        <Route path="reports" element={<ReportsPage />} />
        <Route path="notifications" element={<NotificationsPage />} />
        <Route path="portals" element={<PortalsPage />} />
        <Route path="admin" element={<AdminPage />} />
        <Route path="*" element={<p className="panel">That page does not exist.</p>} />
      </Route>
    </Routes>
  );
}
