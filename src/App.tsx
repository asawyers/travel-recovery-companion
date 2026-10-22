import { LegacyRecoveryApp } from "@/LegacyRecoveryApp";
import { CityRecoveryApp } from "@/features/city/CityRecoveryApp";
import { LegalPage } from "@/features/recovery/LegalPage";

function App() {
  const path = window.location.pathname.replace(/\/$/, "");
  if (path === "/terms" || path === "/privacy")
    return <LegalPage page={path === "/terms" ? "terms" : "privacy"} />;
  if (path === "/legacy") return <LegacyRecoveryApp />;
  return <CityRecoveryApp />;
}

export default App;
