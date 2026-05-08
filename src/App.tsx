import { lazy, Suspense } from "react";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SystemParamsProvider } from "@/contexts/SystemParamsContext";
import { AuthProvider } from "@/contexts/AuthContext";
import { LanguageProvider } from "@/i18n/LanguageContext";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import Index from "./pages/Index.tsx";
import AdminProtectedRoute from "@/components/AdminProtectedRoute";

const FarmersPage = lazy(() => import("./pages/FarmersPage.tsx"));
const GuidelinesPage = lazy(() => import("./pages/GuidelinesPage.tsx"));
const UnitDetailPage = lazy(() => import("./pages/UnitDetailPage.tsx"));
const ListingsPage = lazy(() => import("./pages/ListingsPage.tsx"));
const ListingDetailPage = lazy(() => import("./pages/ListingDetailPage.tsx"));
const AbundancePage = lazy(() => import("./pages/AbundancePage.tsx"));
const NotFound = lazy(() => import("./pages/NotFound.tsx"));
const AdminLoginPage = lazy(() => import("./pages/AdminLoginPage.tsx"));
const AdminPage = lazy(() => import("./pages/AdminPage.tsx"));

// Redirect component for external URLs
function ExternalRedirect({ url }: { url: string }) {
  window.location.href = url;
  return null;
}

const PageLoader = () => (
  <div className="flex items-center justify-center min-h-[50vh]">
    <div className="animate-pulse text-muted-foreground font-sans">Loading...</div>
  </div>
);

const App = () => (
  <LanguageProvider>
  <SystemParamsProvider>
    <AuthProvider>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <Header />
          <main className="min-h-screen">
            <Suspense fallback={<PageLoader />}>
              <Routes>
                <Route path="/" element={<Index />} />
                <Route path="/kmetje" element={<FarmersPage />} />
                <Route path="/smernice" element={<GuidelinesPage />} />
                <Route path="/enota/:unitId" element={<UnitDetailPage />} />
                <Route path="/ponudbe" element={<ListingsPage />} />
                <Route path="/ponudba/:pubkey/:listingId" element={<ListingDetailPage />} />
                <Route path="/ekonomija-obilja" element={<AbundancePage />} />
                {/* Admin (per-portal moderation) */}
                <Route path="/admin/login" element={<AdminLoginPage />} />
                <Route
                  path="/admin"
                  element={
                    <AdminProtectedRoute>
                      <AdminPage />
                    </AdminProtectedRoute>
                  }
                />
                {/* Redirect login/register/dashboard to shop.lanapays.us */}
                <Route path="/login" element={<ExternalRedirect url="https://shop.lanapays.us/login" />} />
                <Route path="/register" element={<ExternalRedirect url="https://shop.lanapays.us/register" />} />
                <Route path="/dashboard" element={<ExternalRedirect url="https://shop.lanapays.us/dashboard" />} />
                <Route path="*" element={<NotFound />} />
              </Routes>
            </Suspense>
          </main>
          <Footer />
        </BrowserRouter>
      </TooltipProvider>
    </AuthProvider>
  </SystemParamsProvider>
  </LanguageProvider>
);

export default App;
