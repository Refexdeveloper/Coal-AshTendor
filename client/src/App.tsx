import { BrowserRouter, Route, Routes } from "react-router-dom";
import AdminPage from "@client/pages/admin/Admin";
import LoginPage from "@client/pages/Login";
import AppLayout from "@client/layout/AppLayout";
import NewTenderPage from "@client/pages/tenders/NewTender";
import NotificationsPage from "@client/pages/Notifications";
import EmailLogsPage from "@client/pages/EmailLogs";
import DashboardPage from "@client/pages/Dashboard";
import PortalsPage from "@client/pages/portals/Portals";
import RegisterPage from "@client/pages/Register";
import ReportsPage from "@client/pages/Reports";
import TenderPage from "@client/pages/tenders/TenderDetail";
import WorklistPage from "@client/pages/Worklist";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<AppLayout />}>
        <Route index element={<DashboardPage />} />
        <Route path="worklist" element={<WorklistPage />} />
        <Route path="register" element={<RegisterPage />} />
        <Route path="tenders/new" element={<NewTenderPage />} />
        <Route path="tenders/:id" element={<TenderPage />} />
        <Route path="reports" element={<ReportsPage />} />
        <Route path="notifications" element={<NotificationsPage />} />
        <Route path="email-logs" element={<EmailLogsPage />} />
        <Route path="portals" element={<PortalsPage />} />
        <Route path="admin" element={<AdminPage />} />
        <Route path="*" element={<p className="panel">That page does not exist.</p>} />
      </Route>
      </Routes>
    </BrowserRouter>
  );
}
