import { LegacyRecoveryApp } from "@/LegacyRecoveryApp";
import { CityRecoveryApp } from "@/features/city/CityRecoveryApp";
import { LegalPage } from "@/features/recovery/LegalPage";
import { AuthProvider, ProtectedApp } from "@/features/auth/AuthProvider";

function App() {
  const path = window.location.pathname.replace(/\/$/, "");
  if (path === "/terms" || path === "/privacy")
    return <LegalPage page={path === "/terms" ? "terms" : "privacy"} />;
  return <AuthProvider><ProtectedApp>{path === "/legacy" ? <LegacyRecoveryApp /> : <CityRecoveryApp />}</ProtectedApp></AuthProvider>;
}

export default App;
