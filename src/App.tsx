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
import { ThemeProvider } from '@/contexts/ThemeContext';
import KitchenPage from "./pages/KitchenPage";
import PublicDisplayPage from "./pages/PublicDisplayPage";
import LoginPage from "./pages/LoginPage";
import ProtectedRoute from "@/components/ProtectedRoute";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

function AppContent() {
  const location = useLocation();
  const isLoginPage = location.pathname === '/login';
  const isDisplayPage = location.pathname === '/display';
  const isFullscreen = isLoginPage || isDisplayPage;

  return (
    <>
      <Toaster />
      <Sonner />
      {!isFullscreen && <AppNav />}
      
      <div className={isFullscreen ? '' : 'pb-16'}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/" element={<ProtectedRoute permission="admin"><AdminPage /></ProtectedRoute>} />
          <Route path="/kitchen" element={<ProtectedRoute permission="kitchen"><KitchenPage /></ProtectedRoute>} />
          <Route path="/display" element={<ProtectedRoute permission="display"><PublicDisplayPage /></ProtectedRoute>} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </div>
      
      {!isLoginPage && (
        <footer className="fixed bottom-0 left-0 w-full py-2 text-center text-sm text-foreground z-40">
          <div className="max-w-7xl mx-auto px-4">Solução Sistemas - A sua cozinha ainda mais eficiente</div>
        </footer>
      )}
    </>
  );
}

const App = () => (
  // Ordem dos providers:
  // 1) Auth define sessão/token
  // 2) Settings usa preferências locais/remotas
  // 3) Theme carrega temas do servidor
  // 4) Order consome auth+settings+theme para API, socket e impressão
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <BrowserRouter>
        <AuthProvider>
          <SettingsProvider>
            <ThemeProvider>
              <OrderProvider>
                <AppContent />
              </OrderProvider>
            </ThemeProvider>
          </SettingsProvider>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
