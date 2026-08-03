import { BrowserRouter, Route, Routes } from "react-router-dom";
import { HomePage } from "@/pages/home-page";
import { InteractionPage } from "@/pages/interaction-page";
import { NotFoundPage } from "@/pages/not-found-page";
import { SignedOutPage } from "@/pages/signed-out-page";

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/oauth/interaction/:uid" element={<InteractionPage />} />
        <Route path="/signed-out" element={<SignedOutPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </BrowserRouter>
  );
}
