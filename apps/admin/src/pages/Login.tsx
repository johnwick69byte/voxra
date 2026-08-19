import { useState } from "react";
import { useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import { adminAPI } from "../services/api";

export default function Login() {
  const nav = useNavigate();
  const [email, setEmail] = useState("admin@voxora.app");
  const [password, setPassword] = useState("admin123456");
  const [loading, setLoading] = useState(false);

  const login = async () => {
    setLoading(true);
    try {
      const res = await adminAPI.login(email, password);
      localStorage.setItem("voxora_admin_token", res.data.token);
      nav("/");
    } catch {
      toast.error("Login failed — try bootstrap first");
    } finally {
      setLoading(false);
    }
  };

  const bootstrap = async () => {
    setLoading(true);
    try {
      await adminAPI.bootstrap(email, password, "Voxora Admin");
      toast.success("Admin created — logging in");
      await login();
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || "Bootstrap failed");
      setLoading(false);
    }
  };

  return (
    <div className="login-wrap">
      <div className="login-card">
        <h1>Voxora</h1>
        <p style={{ color: "var(--muted)", marginTop: 0 }}>Ops dashboard — instant calls only</p>
        <div className="field">
          <label>Email</label>
          <input value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="field">
          <label>Password</label>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        <div className="row" style={{ marginTop: 20 }}>
          <button className="btn" disabled={loading} onClick={login}>Sign in</button>
          <button className="btn ghost" disabled={loading} onClick={bootstrap}>Bootstrap first admin</button>
        </div>
      </div>
    </div>
  );
}
