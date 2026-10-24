import { Suspense, lazy } from "react";
import { Route, Routes } from "react-router-dom";
import { FullPageSpinner } from "../components/ui";
import { Layout } from "../components/Layout";
import { ProtectedRoute } from "../components/ProtectedRoute";
import { AboutPage, ContactPage, HomePage, NotFoundPage, PrivacyPage, RecyclingGuidePage, TermsPage } from "../pages/public";
import { AuthCallbackPage, ForgotPasswordPage, LoginPage, RegisterPage, ResetPasswordPage } from "../pages/auth";
import { ProfilePage, SettingsPage } from "../pages/account";
import { DashboardPage } from "../pages/dashboard";
import { CollectionDetailPage, CollectionsPage } from "../pages/collections";
import { ScannerPage } from "../pages/scanner";
import { GreenScorePage } from "../pages/greenscore";
import { RecyclerFormPage, RecyclersPage } from "../pages/recyclers";
import { InquiriesPage, NotificationsPage } from "../pages/inbox";
import { ListingDetailPage, ListingFormPage, MarketplacePage, MyListingsPage, SavedPage } from "../pages/market";

const AnalyticsPage = lazy(() => import("../pages/analytics").then((m) => ({ default: m.AnalyticsPage })));

export function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<HomePage />} />
        <Route path="about" element={<AboutPage />} />
        <Route path="recycling-guide" element={<RecyclingGuidePage />} />
        <Route path="contact" element={<ContactPage />} />
        <Route path="marketplace" element={<MarketplacePage />} />
        <Route path="marketplace/:id" element={<ListingDetailPage />} />
        <Route path="recyclers" element={<RecyclersPage />} />
        <Route path="privacy" element={<PrivacyPage />} />
        <Route path="terms" element={<TermsPage />} />
        <Route path="login" element={<LoginPage />} />
        <Route path="register" element={<RegisterPage />} />
        <Route path="forgot-password" element={<ForgotPasswordPage />} />
        <Route path="reset-password" element={<ResetPasswordPage />} />
        <Route path="auth/callback" element={<AuthCallbackPage />} />
        <Route element={<ProtectedRoute />}>
          <Route path="dashboard" element={<DashboardPage />} />
          <Route path="my-listings" element={<MyListingsPage />} />
          <Route path="my-listings/new" element={<ListingFormPage />} />
          <Route path="my-listings/:id/edit" element={<ListingFormPage />} />
          <Route path="recyclers/suggest" element={<RecyclerFormPage />} />
          <Route path="collections" element={<CollectionsPage />} />
          <Route path="collections/:id" element={<CollectionDetailPage />} />
          <Route path="scanner" element={<ScannerPage />} />
          <Route path="analytics" element={<Suspense fallback={<FullPageSpinner />}><AnalyticsPage /></Suspense>} />
          <Route path="greenscore" element={<GreenScorePage />} />
          <Route path="saved" element={<SavedPage />} />
          <Route path="inquiries" element={<InquiriesPage />} />
          <Route path="notifications" element={<NotificationsPage />} />
          <Route path="profile" element={<ProfilePage />} />
          <Route path="settings" element={<SettingsPage />} />
        </Route>
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
