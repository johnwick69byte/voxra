import { Navigate, Route, Routes, NavLink, useNavigate } from "react-router-dom";
import { BrowserRouter } from "react-router-dom";
import Login from "./pages/Login";
import Overview from "./pages/Overview";
import LiveOps from "./pages/LiveOps";
import Creators from "./pages/Creators";
import Withdrawals from "./pages/Withdrawals";
import WithdrawalIncreases from "./pages/WithdrawalIncreases";
import Financial from "./pages/Financial";
import CallLogs from "./pages/CallLogs";
import MissedCalls from "./pages/MissedCalls";
import Support from "./pages/Support";
import Broadcast from "./pages/Broadcast";
import Health from "./pages/Health";
import Audit from "./pages/Audit";

function Shell({ children }: { children: React.ReactNode }) {
  const nav = useNavigate();
  const token =
    localStorage.getItem("simpletalk_admin_token") ||
    localStorage.getItem("voxora_admin_token");
  if (!token) return <Navigate to="/login" replace />;
  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="logo">Simple Talk</div>
        <NavLink to="/" end>Overview</NavLink>
        <NavLink to="/financial">Financial</NavLink>
        <NavLink to="/live">Live ops</NavLink>
        <NavLink to="/creators">Creators</NavLink>
        <NavLink to="/calls">Call logs</NavLink>
        <NavLink to="/missed">Missed calls</NavLink>
        <NavLink to="/withdrawals">Withdrawals</NavLink>
        <NavLink to="/withdrawal-increases">Limit requests</NavLink>
        <NavLink to="/support">Support</NavLink>
        <NavLink to="/broadcast">Broadcast</NavLink>
        <NavLink to="/audit">Audit</NavLink>
        <NavLink to="/health">Health</NavLink>
        <button
          className="btn ghost"
          style={{ marginTop: "auto", color: "#fff", borderColor: "rgba(255,255,255,0.2)" }}
          onClick={() => {
            localStorage.removeItem("simpletalk_admin_token");
            localStorage.removeItem("voxora_admin_token");
            nav("/login");
          }}
        >
          Log out
        </button>
      </aside>
      <main className="main">{children}</main>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/" element={<Shell><Overview /></Shell>} />
        <Route path="/financial" element={<Shell><Financial /></Shell>} />
        <Route path="/live" element={<Shell><LiveOps /></Shell>} />
        <Route path="/creators" element={<Shell><Creators /></Shell>} />
        <Route path="/calls" element={<Shell><CallLogs /></Shell>} />
        <Route path="/missed" element={<Shell><MissedCalls /></Shell>} />
        <Route path="/withdrawals" element={<Shell><Withdrawals /></Shell>} />
        <Route path="/withdrawal-increases" element={<Shell><WithdrawalIncreases /></Shell>} />
        <Route path="/support" element={<Shell><Support /></Shell>} />
        <Route path="/broadcast" element={<Shell><Broadcast /></Shell>} />
        <Route path="/audit" element={<Shell><Audit /></Shell>} />
        <Route path="/health" element={<Shell><Health /></Shell>} />
      </Routes>
    </BrowserRouter>
  );
}
