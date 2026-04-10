import * as React from "react";
import { Sun, Moon } from "lucide-react";
import { useTheme } from "@/contexts/ThemeContext";
import { Button } from "@/components/ui/button";

export default function ThemeToggle() {
  const { isDarkMode, toggleDarkMode } = useTheme();

  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={isDarkMode ? "Ativar modo claro" : "Ativar modo escuro"}
      onClick={toggleDarkMode}
      title={isDarkMode ? "Modo claro" : "Modo escuro"}
    >
      {isDarkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
    </Button>
  );
}
