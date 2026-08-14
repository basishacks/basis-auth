import { BrowserRouter, Route, Routes } from "react-router-dom";
import { useEffect, useState } from "react";
import { LoginCard, Status, StatusError } from "./components/LoginCard";
import { ToastProvider } from "./components/ui/toast";

const delay = (ms: number) => new Promise(res => setTimeout(res, ms));

export function App() {



  const [hold, setHold] = useState(true);
  const [_status, setStatus] = useState<Status>({loading: true, page: "none", login: undefined});

  const animate = (page: string, error?: StatusError, loginContent?: any) => {
    setStatus({loading: false, error, page: "none"});
    setTimeout(() => {
      setStatus({loading: false, error, page, login: loginContent});
    }, 500)
  }

  const resetToLogin = async () => {
    const res = await fetch("/oauth/interaction", { headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error("Could not restart login");
    const loginContent = await res.json();
    await delay(500);
    setStatus({ loading: false, page: "none", login: undefined });
    animate(loginContent.prompt, undefined, loginContent);
  };
  
  useEffect(() => {

    

    (async () => {


      const raw = document.cookie
        .split("; ")
        .find((c) => c.startsWith("basis_bridge_error="))
        ?.split("=")[1];

      if (raw) {

        const error = JSON.parse(atob(decodeURIComponent(raw)));
        await delay(300);
        animate( "content", error)
        console.log(error)
        // clear it so it doesn't linger
        document.cookie = "basis_bridge_error=; path=/oauth; max-age=0";

        return;
      }


      const res = await fetch("/oauth/interaction", { headers: { Accept: "application/json" } });
      const loginContent = await res.json()
      await delay(300);

      animate(loginContent.prompt, undefined, loginContent)
    })();
    
  }, []);

  return (
    <ToastProvider>
      <main className="flex min-h-screen items-center justify-center">
        <LoginCard stat={_status} onLogout={resetToLogin}></LoginCard>
      </main>
    </ToastProvider>
  );
}
