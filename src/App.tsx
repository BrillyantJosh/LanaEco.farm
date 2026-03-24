import { lazy, Suspense } from "react";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import Index from "./pages/Index.tsx";

const FarmersPage = lazy(() => import("./pages/FarmersPage.tsx"));
const FarmerDetailPage = lazy(() => import("./pages/FarmerDetailPage.tsx"));
const ProductsPage = lazy(() => import("./pages/ProductsPage.tsx"));
const GuidelinesPage = lazy(() => import("./pages/GuidelinesPage.tsx"));
const NotFound = lazy(() => import("./pages/NotFound.tsx"));

const PageLoader = () => (
  <div className="flex items-center justify-center min-h-[50vh]">
    <div className="animate-pulse text-muted-foreground font-sans">Nalaganje...</div>
  </div>
);

const App = () => (
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
            <Route path="*" element={<NotFound />} />
          </Routes>
        </Suspense>
      </main>
      <Footer />
    </BrowserRouter>
  </TooltipProvider>
);

export default App;
