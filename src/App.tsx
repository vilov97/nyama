import { BrowserRouter, Link, Route, Routes } from "react-router-dom";
import { AuthProvider } from "./auth/AuthProvider";
import { RequireAuth, RequireRole } from "./auth/RequireRole";
import HomePage from "./pages/HomePage";
import LoginPage from "./pages/LoginPage";
import SignupPage from "./pages/SignupPage";
import ForgotPasswordPage from "./pages/ForgotPasswordPage";
import MfaEnrollPage from "./pages/MfaEnrollPage";
import ForbiddenPage from "./pages/ForbiddenPage";
import CustomerApp from "./pages/CustomerApp";
import RiderApp from "./pages/RiderApp";
import KitchenApp from "./pages/KitchenApp";
import ManagerApp from "./pages/ManagerApp";
import AdminApp from "./pages/AdminApp";

/**
 * Route map (UX layer — RLS enforces the same rules server-side, audit §5.5):
 *   /                 public homepage            /login /signup /forgot-password (public)
 *   /mfa-enroll       any signed-in user         /app customer · /ride rider
 *   /manager          manager+admin              /admin admin only
 */
export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/signup" element={<SignupPage />} />
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/403" element={<ForbiddenPage />} />
          <Route
            path="/mfa-enroll"
            element={
              <RequireAuth>
                <MfaEnrollPage />
              </RequireAuth>
            }
          />
          <Route
            path="/app"
            element={
              <RequireRole allow={["customer"]}>
                <CustomerApp />
              </RequireRole>
            }
          />
          <Route
            path="/ride"
            element={
              <RequireRole allow={["rider"]}>
                <RiderApp />
              </RequireRole>
            }
          />
          <Route
            path="/kitchen"
            element={
              <RequireRole allow={["kitchen", "manager", "admin"]}>
                <KitchenApp />
              </RequireRole>
            }
          />
          <Route
            path="/manager"
            element={
              <RequireRole allow={["manager", "admin"]}>
                <ManagerApp />
              </RequireRole>
            }
          />
          <Route
            path="/admin"
            element={
              <RequireRole allow={["admin"]}>
                <AdminApp />
              </RequireRole>
            }
          />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}

function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-white px-4 text-center">
      <p className="mb-2 text-[0.6rem] font-bold uppercase tracking-[0.15em] text-neutral-400">
        404
      </p>
      <h1 className="mb-4 text-2xl font-light tracking-tighter text-neutral-900">
        This page doesn&apos;t exist
      </h1>
      <Link
        to="/"
        className="inline-block bg-[#ffe500] px-8 py-3 text-xs font-bold uppercase tracking-wider text-neutral-900 no-underline transition-all hover:bg-neutral-900 hover:text-white"
      >
        Back to home
      </Link>
    </div>
  );
}
