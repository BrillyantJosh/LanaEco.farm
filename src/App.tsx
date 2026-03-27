import { lazy, Suspense } from "react";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SystemParamsProvider } from "@/contexts/SystemParamsContext";
import { AuthProvider } from "@/contexts/AuthContext";
import ProtectedRoute from "@/components/ProtectedRoute";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import Index from "./pages/Index.tsx";

const FarmersPage = lazy(() => import("./pages/FarmersPage.tsx"));
const FarmerDetailPage = lazy(() => import("./pages/FarmerDetailPage.tsx"));
const ProductsPage = lazy(() => import("./pages/ProductsPage.tsx"));
const GuidelinesPage = lazy(() => import("./pages/GuidelinesPage.tsx"));
const LoginPage = lazy(() => import("./pages/LoginPage.tsx"));
const DashboardPage = lazy(() => import("./pages/DashboardPage.tsx"));
const UnitDetailPage = lazy(() => import("./pages/UnitDetailPage.tsx"));
const RegisterPage = lazy(() => import("./pages/RegisterPage.tsx"));
const ListingsPage = lazy(() => import("./pages/ListingsPage.tsx"));
const ListingDetailPage = lazy(() => import("./pages/ListingDetailPage.tsx"));
const NotFound = lazy(() => import("./pages/NotFound.tsx"));

const PageLoader = () => (
  <div className="flex items-center justify-center min-h-[50vh]">
    <div className="animate-pulse text-muted-foreground font-sans">Loading...</div>
  </div>
);

const App = () => (
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
                <Route path="/kmetje/:id" element={<FarmerDetailPage />} />
                <Route path="/izdelki" element={<ProductsPage />} />
                <Route path="/smernice" element={<GuidelinesPage />} />
                <Route path="/enota/:unitId" element={<UnitDetailPage />} />
                <Route path="/ponudbe" element={<ListingsPage />} />
                <Route path="/ponudba/:pubkey/:listingId" element={<ListingDetailPage />} />
                <Route path="/login" element={<LoginPage />} />
                <Route path="/register" element={<RegisterPage />} />
                <Route
                  path="/dashboard"
                  element={
                    <ProtectedRoute>
                      <DashboardPage />
                    </ProtectedRoute>
                  }
                />
                <Route path="*" element={<NotFound />} />
              </Routes>
            </Suspense>
          </main>
          <Footer />
        </BrowserRouter>
      </TooltipProvider>
    </AuthProvider>
  </SystemParamsProvider>
);

export default App;
