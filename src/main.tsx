import { createRoot } from "react-dom/client";
import { ThemeProvider } from "next-themes";
import App from "./App.tsx";
import "./index.css";
import "./styles/theme.css";

createRoot(document.getElementById("root")!).render(
	<ThemeProvider attribute="class" defaultTheme="system">
		<App />
	</ThemeProvider>,
);
