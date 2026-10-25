import { Route, Routes } from "react-router-dom";
import { SiteChrome } from "./components/SiteChrome";
import LandingPage from "./pages/LandingPage";
import DeleteAccountPage from "./pages/DeleteAccountPage";
import PrivacyPage from "./pages/PrivacyPage";
import TermsPage from "./pages/TermsPage";
import ContactPage from "./pages/ContactPage";
import CancellationRefundPolicyPage from "./pages/CancellationRefundPolicyPage";

export default function App() {
  return (
    <SiteChrome>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/privacy" element={<PrivacyPage />} />
        <Route path="/terms" element={<TermsPage />} />
        <Route path="/delete-account" element={<DeleteAccountPage />} />
        <Route path="/contact" element={<ContactPage />} />
        <Route path="/cancellation-refund-policy" element={<CancellationRefundPolicyPage />} />
      </Routes>
    </SiteChrome>
  );
}
