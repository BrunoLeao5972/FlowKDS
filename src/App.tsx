import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, useLocation } from "react-router-dom";
import { OrderProvider } from "@/contexts/OrderContext";
import { AppNav } from "@/components/AppNav";
import AdminPage from "./pages/AdminPage";
import { SettingsProvider } from '@/contexts/SettingsContext';
import { AuthProvider } from '@/contexts/AuthContext';
import KitchenPage from "./pages/KitchenPage";
import PublicDisplayPage from "./pages/PublicDisplayPage";
import LoginPage from "./pages/LoginPage";
import ProtectedRoute from "@/components/ProtectedRoute";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

function AppContent() {
  const location = useLocation();
  const isLoginPage = location.pathname === '/login';

  return (
    <>
      <Toaster />
      <Sonner />
      {!isLoginPage && <AppNav />}
      
      <div className={isLoginPage ? '' : 'pb-16'}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/" element={<ProtectedRoute permission="admin"><AdminPage /></ProtectedRoute>} />
          <Route path="/kitchen" element={<ProtectedRoute permission="kitchen"><KitchenPage /></ProtectedRoute>} />
          <Route path="/display" element={<ProtectedRoute permission="display"><PublicDisplayPage /></ProtectedRoute>} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </div>
      
      {!isLoginPage && (
        <footer className="fixed bottom-0 left-0 w-full border-t border-border bg-card text-center text-sm text-foreground py-2 z-40">
          <div className="max-w-7xl mx-auto px-4">Solução Sistemas - A sua cozinha ainda mais eficiente</div>
        </footer>
      )}
    </>
  );
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <BrowserRouter>
        <AuthProvider>
          <SettingsProvider>
            <OrderProvider>
              <AppContent />
            </OrderProvider>
          </SettingsProvider>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
