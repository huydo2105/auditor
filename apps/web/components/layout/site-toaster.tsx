"use client";

import { useEffect, useState } from "react";
import { Toaster } from "sonner";

type Theme = "light" | "dark";

export function SiteToaster() {
  const [theme, setTheme] = useState<Theme>("light");

  useEffect(() => {
    const syncTheme = () => setTheme(document.documentElement.dataset.theme === "dark" ? "dark" : "light");
    syncTheme();
    const observer = new MutationObserver(syncTheme);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);

  return <Toaster
    position="bottom-right"
    theme={theme}
    closeButton
    richColors
    offset={{ bottom: "24px", right: "24px", left: "24px" }}
    mobileOffset={{ bottom: "16px", right: "16px", left: "16px" }}
  />;
}
