import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import Index from "./pages/Index.tsx";
import FarmersPage from "./pages/FarmersPage.tsx";
import FarmerDetailPage from "./pages/FarmerDetailPage.tsx";
import ProductsPage from "./pages/ProductsPage.tsx";
import GuidelinesPage from "./pages/GuidelinesPage.tsx";
import NotFound from "./pages/NotFound.tsx";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Header />
        <main className="min-h-screen">
          <Routes>
            <Route path="/" element={<Index />} />
            <Route path="/kmetje" element={<FarmersPage />} />
            <Route path="/kmetje/:id" element={<FarmerDetailPage />} />
            <Route path="/izdelki" element={<ProductsPage />} />
            <Route path="/smernice" element={<GuidelinesPage />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </main>
        <Footer />
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
