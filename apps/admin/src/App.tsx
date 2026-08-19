import { Navigate, Route, Routes, NavLink, useNavigate } from "react-router-dom";
import { BrowserRouter } from "react-router-dom";
import Login from "./pages/Login";
import Overview from "./pages/Overview";
import LiveOps from "./pages/LiveOps";
import Creators from "./pages/Creators";
import Withdrawals from "./pages/Withdrawals";
import CallLogs from "./pages/CallLogs";
import Support from "./pages/Support";
import Broadcast from "./pages/Broadcast";
import Health from "./pages/Health";

function Shell({ children }: { children: React.ReactNode }) {
  const nav = useNavigate();
  const token = localStorage.getItem("voxora_admin_token");
  if (!token) return <Navigate to="/login" replace />;
  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="logo">Voxora</div>
        <NavLink to="/" end>Overview</NavLink>
        <NavLink to="/live">Live ops</NavLink>
        <NavLink to="/creators">Creators</NavLink>
        <NavLink to="/calls">Call logs</NavLink>
        <NavLink to="/withdrawals">Withdrawals</NavLink>
        <NavLink to="/support">Support</NavLink>
        <NavLink to="/broadcast">Broadcast</NavLink>
        <NavLink to="/health">Health</NavLink>
        <button
          className="btn ghost"
          style={{ marginTop: "auto", color: "#fff", borderColor: "rgba(255,255,255,0.2)" }}
          onClick={() => {
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
        <Route path="/live" element={<Shell><LiveOps /></Shell>} />
        <Route path="/creators" element={<Shell><Creators /></Shell>} />
        <Route path="/calls" element={<Shell><CallLogs /></Shell>} />
        <Route path="/withdrawals" element={<Shell><Withdrawals /></Shell>} />
        <Route path="/support" element={<Shell><Support /></Shell>} />
        <Route path="/broadcast" element={<Shell><Broadcast /></Shell>} />
        <Route path="/health" element={<Shell><Health /></Shell>} />
      </Routes>
    </BrowserRouter>
  );
}
